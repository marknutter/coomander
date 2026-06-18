import { NextRequest, NextResponse } from "next/server";
import { getRawAdapter } from "@/lib/db-raw";
import { BadRequestError, errorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const email = (searchParams.get("email") ?? "").trim().toLowerCase();

    if (!email) {
      throw new BadRequestError("Email is required");
    }

    const adapter = getRawAdapter();

    const entry = await adapter.queryFirst<{
      id: number; referral_code: string; referral_count: number; status: string; created_at: string;
    }>(
      "SELECT id, referral_code, referral_count, status, created_at FROM waitlist WHERE email = ?",
      email
    );

    if (!entry) {
      return NextResponse.json({ onWaitlist: false });
    }

    const position = await adapter.queryFirst<{ pos: number }>(
      "SELECT COUNT(*) as pos FROM waitlist WHERE id <= ? AND status = 'waiting'",
      entry.id
    );

    const totalWaiting = await adapter.queryFirst<{ total: number }>(
      "SELECT COUNT(*) as total FROM waitlist WHERE status = 'waiting'"
    );

    return NextResponse.json({
      onWaitlist: true,
      position: entry.status === "waiting" ? position?.pos ?? 0 : null,
      totalWaiting: totalWaiting?.total ?? 0,
      referralCode: entry.referral_code,
      referralCount: entry.referral_count,
      status: entry.status,
      joinedAt: entry.created_at,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
