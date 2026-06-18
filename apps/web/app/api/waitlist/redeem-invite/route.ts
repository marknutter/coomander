import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRawDb } from "@/lib/db";
import { BadRequestError, UnauthorizedError, errorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id) throw new UnauthorizedError();

    const body = await request.json();
    const code = (body.code ?? "").trim();

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
      throw new BadRequestError("Invalid invite code");
    }

    if (invite.used_by) {
      throw new BadRequestError("This invite code has already been used");
    }

    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      throw new BadRequestError("This invite code has expired");
    }

    // If the invite is locked to a specific email, verify it matches
    if (invite.email && invite.email.toLowerCase() !== session.user.email.toLowerCase()) {
      throw new BadRequestError("This invite code is not valid for your email address");
    }

    // Mark invite as used
    db.prepare(
      "UPDATE invite_codes SET used_by = ?, used_at = datetime('now') WHERE id = ?"
    ).run(session.user.id, invite.id);

    // Update waitlist entry status if exists
    db.prepare(
      "UPDATE waitlist SET status = 'registered' WHERE email = ?"
    ).run(session.user.email.toLowerCase());

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
