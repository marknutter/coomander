import { NextResponse } from "next/server";
import crypto from "crypto";
import { logAdminAction } from "@/lib/admin";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getRawAdapter } from "@/lib/db-raw";
import { isPg } from "@/lib/db-dialect";
import { BadRequestError, errorResponse } from "@/lib/errors";
import { sendWaitlistInviteEmail } from "@/lib/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { session, error } = await requirePermission(request, PERMISSIONS.ADMIN_WAITLIST);
    if (error) return error;

    const body = await request.json();
    const emails: string[] = (body.emails ?? []).map((e: string) => e.trim().toLowerCase()).filter(Boolean);

    if (emails.length === 0) {
      throw new BadRequestError("At least one email address is required");
    }

    if (emails.length > 100) {
      throw new BadRequestError("Maximum 100 invites per batch");
    }

    const adapter = getRawAdapter();
    const now = isPg() ? "now()::text" : "datetime('now')";
    const results: Array<{ email: string; code: string; status: string }> = [];

    for (const email of emails) {
      const code = crypto.randomBytes(8).toString("hex");

      try {
        await adapter.run(
          "INSERT INTO invite_codes (code, email, created_by) VALUES (?, ?, ?)",
          code, email, session.user.id
        );
        await adapter.run(
          `UPDATE waitlist SET status = 'invited', invited_at = ${now} WHERE email = ? AND status = 'waiting'`,
          email
        );

        // Send invite email (fire-and-forget)
        sendWaitlistInviteEmail(email, code).catch((err) => {
          console.error(`[waitlist] Failed to send invite email to ${email}:`, err);
        });

        results.push({ email, code, status: "sent" });
      } catch (err) {
        results.push({ email, code: "", status: `failed: ${(err as Error).message}` });
      }
    }

    await logAdminAction(
      session.user.id,
      "waitlist.invite",
      "waitlist",
      undefined,
      { count: results.filter((r) => r.status === "sent").length, emails }
    );

    return NextResponse.json({
      results,
      sent: results.filter((r) => r.status === "sent").length,
      failed: results.filter((r) => r.status !== "sent").length,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
