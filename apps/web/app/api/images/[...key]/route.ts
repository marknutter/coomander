import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { UnauthorizedError, NotFoundError, errorResponse } from "@/lib/errors";
import { downloadFile } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  // Catch-all: the R2 key contains slashes (`ai-images/<userId>/<date>/<uuid>.png`),
  // which a single `[key]` segment can't match — Next splits it into segments.
  params: Promise<{ key: string[] }>;
}

/** Content-Type derived from the stored key's extension (no DB metadata). */
function contentTypeForKey(key: string): string {
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

/**
 * GET /api/images/<key> — serve an AI-generated image (#222 follow-up).
 *
 * Auth-gated AND auth-scoped: the key must live under the requesting user's
 * `ai-images/<userId>/` prefix, so a user can never read another user's image
 * (cross-user keys → 404, which also doesn't leak whether the object exists).
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    // Reassemble the full R2 key from the catch-all segments (Next has already
    // URL-decoded each segment).
    const { key: segments } = await params;
    const key = (segments ?? []).join("/");

    // Defense-in-depth against path traversal on the local-fs backend (which
    // does `path.join(uploadsDir, key)`): reject any `..` / `.` segment even if
    // a directly-crafted request (e.g. percent-encoded `%2e%2e`) slips past URL
    // normalization. R2 / S3 treat keys as opaque, but the guard is cheap.
    if (
      (segments ?? []).some((s) => s === "." || s === ".." || s.includes("\\")) ||
      key.includes("..")
    ) {
      throw new NotFoundError("Image not found");
    }

    // Ownership is enforced purely from the key prefix — no DB lookup. Reject
    // anything that isn't this user's own ai-images namespace.
    const ownerPrefix = `ai-images/${session.user.id}/`;
    if (!key.startsWith(ownerPrefix)) {
      throw new NotFoundError("Image not found");
    }

    let buffer: Buffer;
    try {
      buffer = await downloadFile(key);
    } catch {
      // Missing object (or backend read failure) → 404 rather than a 500 leak.
      throw new NotFoundError("Image not found");
    }

    const uint8 = new Uint8Array(buffer);
    return new NextResponse(uint8, {
      headers: {
        "Content-Type": contentTypeForKey(key),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
