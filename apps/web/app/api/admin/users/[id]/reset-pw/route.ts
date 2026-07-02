export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { logAdminAction } from "@/lib/admin";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { auth } from "@/lib/auth";
import { user } from "@/lib/schema";
import { queryFirst } from "@/lib/db-helpers";

const APP_URL = process.env.APP_URL || "https://YOUR_DOMAIN";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requirePermission(req, PERMISSIONS.ADMIN_USERS);
  if (error) return error;

  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  }

  const row = await queryFirst(
    getDb()
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(eq(user.id, id))
  );

  if (!row) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  try {
    // Drive Better Auth's own password-reset flow rather than hand-rolling a
    // verification row. The route previously inserted a row as
    // identifier="reset-password:${email}" / value=token — but Better Auth's
    // reset endpoint looks up identifier="reset-password:${token}" and reads
    // value as the userId, the exact inverse — so the emailed link was always
    // dead (silent failure: admin saw success, user got a broken link).
    // requestPasswordReset() generates the token in Better Auth's own format,
    // stores it correctly, and invokes the configured
    // emailAndPassword.sendResetPassword callback (wired in lib/auth.ts) to
    // deliver the email. The `redirectTo` origin must be a trusted origin
    // (BETTER_AUTH_URL / APP_URL). Better Auth issues `/reset-password/:token`
    // then redirects to `redirectTo?token=…`, which the existing
    // /reset-password page reads.
    await auth.api.requestPasswordReset({
      body: {
        email: row.email,
        redirectTo: `${APP_URL}/reset-password`,
      },
    });
  } catch (err) {
    console.error("[admin] Failed to send password reset email:", err);
    return NextResponse.json({ error: "Failed to send reset email" }, { status: 500 });
  }

  const adminId = session.user.id;
  await logAdminAction(adminId, "password_reset_sent", "user", id);

  return NextResponse.json({ data: { success: true } });
}
