import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { files } from "@/lib/schema";
import { UnauthorizedError, NotFoundError, errorResponse } from "@/lib/errors";
import { downloadFile, deleteFile } from "@/lib/storage";
import { queryFirst } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ key: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const { key } = await params;
    const file = await queryFirst(
      getDb()
        .select()
        .from(files)
        .where(and(eq(files.key, key), eq(files.userId, session.user.id)))
    );

    if (!file) throw new NotFoundError("File not found");

    const buffer = await downloadFile(key);
    const uint8 = new Uint8Array(buffer);

    // Sanitize filename for Content-Disposition header
    const safeFilename = file.filename.replace(/["\r\n]/g, "_");

    return new NextResponse(uint8, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `inline; filename="${safeFilename}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const { key } = await params;
    const file = await queryFirst(
      getDb()
        .select()
        .from(files)
        .where(and(eq(files.key, key), eq(files.userId, session.user.id)))
    );

    if (!file) throw new NotFoundError("File not found");

    await deleteFile(key);
    await getDb().delete(files).where(eq(files.id, file.id));

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
