import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { auth } from "@/lib/auth";
import { UnauthorizedError, BadRequestError, errorResponse } from "@/lib/errors";
import { _internal, getStorageBackendName, countStoredUnder } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Max accepted image size (generated images are small, but cap defensively). */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Per-user DAILY cap on stored AI images. This is the authoritative quota — the
 * agents worker tool's per-conversation cap is a soft first-line guard that a
 * user could bypass by opening new conversations, and this route is also
 * directly callable by any authenticated client, so the real ceiling has to
 * live here. Keys are date-partitioned (`ai-images/<userId>/<date>/…`) so we
 * can count today's objects with a single prefix list.
 */
const MAX_IMAGES_PER_USER_PER_DAY = 25;

/**
 * Sniff the real image format from the magic bytes so we store + serve the
 * correct Content-Type and extension. The agents worker's generate_image tool
 * calls Workers AI's flux-1-schnell, which returns JPEG — so don't trust a
 * declared type, derive it from the bytes. Defaults to png for unknown shapes.
 */
function sniffImage(buf: Buffer): { ext: string; contentType: string } {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", contentType: "image/jpeg" };
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return { ext: "png", contentType: "image/png" };
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { ext: "webp", contentType: "image/webp" };
  }
  if (buf.length >= 6 && buf.toString("ascii", 0, 3) === "GIF") {
    return { ext: "gif", contentType: "image/gif" };
  }
  return { ext: "png", contentType: "image/png" };
}

/**
 * POST /api/images — store an AI-generated image (#222 follow-up).
 *
 * Called by the agents worker's `generate_image` tool (apps/agents/src/tools.ts)
 * over the WEB service binding, forwarding the user's session cookie, with the
 * raw image bytes as the body. We store the bytes under an AUTH-SCOPED key
 * (`ai-images/<userId>/<date>/<uuid>`) so the matching GET route can enforce
 * ownership purely from the key prefix — no DB row needed. Returns `{ key }`.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const arrayBuffer = await request.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0) throw new BadRequestError("Empty image body");
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new BadRequestError("Image too large (max 10MB)");
    }

    const { ext, contentType } = sniffImage(buffer);

    // Enforce the per-user daily quota at this choke point. Keys are
    // date-partitioned so today's count is a single prefix list.
    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const dayPrefix = `ai-images/${session.user.id}/${day}/`;
    const usedToday = await countStoredUnder(dayPrefix);
    if (usedToday >= MAX_IMAGES_PER_USER_PER_DAY) {
      throw new BadRequestError(
        `Daily image generation limit reached (max ${MAX_IMAGES_PER_USER_PER_DAY} per day).`,
      );
    }

    // Generate the key ourselves so it carries the owner's user id in its
    // prefix — the GET route authorizes solely on this prefix.
    const key = `${dayPrefix}${crypto.randomUUID()}.${ext}`;

    // The public `uploadFile()` helper generates its OWN random key, which would
    // drop the auth-scoped prefix — so go through the backend directly with our
    // key. (`_internal.getBackend()` resolves the same R2 / S3 / local backend.)
    const backend = _internal.getBackend();

    // The local-filesystem dev backend writes to `data/uploads/<key>` and only
    // ensures the top-level dir — a slashed key needs its nested dirs created
    // first or `fs.writeFileSync` throws ENOENT. (R2 / S3 keys are flat strings,
    // so this only matters for local dev.)
    if (getStorageBackendName() === "local") {
      const dir = path.join(process.cwd(), "data", "uploads", path.dirname(key));
      fs.mkdirSync(dir, { recursive: true });
    }

    await backend.upload(key, buffer, contentType);

    return NextResponse.json({ key }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
