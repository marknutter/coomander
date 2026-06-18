import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { eq, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { files } from "@/lib/schema";
import { UnauthorizedError, BadRequestError, errorResponse } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { uploadFile, getFileUrl, getStorageBackendName } from "@/lib/storage";
import { queryFirst } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const rows = await getDb()
      .select()
      .from(files)
      .where(eq(files.userId, session.user.id))
      .orderBy(desc(files.createdAt));

    return NextResponse.json({ files: rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const limited = rateLimit.check(request);
  if (limited) return limited;

  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) throw new BadRequestError("No file provided");

    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_SIZE) throw new BadRequestError("File too large (max 10MB)");

    // Allowlist safe content types
    const ALLOWED_TYPES = new Set([
      "image/jpeg", "image/png", "image/gif", "image/webp",
      "application/pdf",
      "text/plain", "text/csv",
      "application/json",
      "application/zip", "application/gzip",
    ]);
    if (!ALLOWED_TYPES.has(file.type)) {
      throw new BadRequestError("File type not allowed");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadFile(buffer, file.name, file.type);

    const db = getDb();
    const id = crypto.randomUUID();
    await db.insert(files).values({
      id,
      userId: session.user.id,
      key: result.key,
      filename: file.name,
      contentType: result.contentType,
      size: result.size,
      storageBackend: getStorageBackendName(),
    });

    const fileRecord = await queryFirst(db.select().from(files).where(eq(files.id, id)));

    return NextResponse.json(
      { file: fileRecord, url: getFileUrl(result.key) },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
