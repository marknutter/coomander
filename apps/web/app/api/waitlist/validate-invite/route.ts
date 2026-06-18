import { NextRequest, NextResponse } from "next/server";
import { getRawDb } from "@/lib/db";
import { BadRequestError, errorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = (searchParams.get("code") ?? "").trim();

    if (!code) {
      throw new BadRequestError("Invite code is required");
    }

    const db = getRawDb();

    const invite = db.prepare(
      "SELECT id, email, used_by, expires_at FROM invite_codes WHERE code = ?"
    ).get(code) as
      | { id: number; email: string | null; used_by: string | null; expires_at: string | null }
      | undefined;

    if (!invite) {
      return NextResponse.json({ valid: false, reason: "Invalid invite code" });
    }

    if (invite.used_by) {
      return NextResponse.json({ valid: false, reason: "This invite code has already been used" });
    }

    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return NextResponse.json({ valid: false, reason: "This invite code has expired" });
    }

    return NextResponse.json({
      valid: true,
      lockedToEmail: invite.email ?? null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
