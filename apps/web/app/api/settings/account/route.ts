import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { user, account } from "@/lib/schema";
import { queryFirst } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const db = getDb();

  const row = await queryFirst(
    db
      .select({
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image,
        createdAt: user.createdAt,
      })
      .from(user)
      .where(eq(user.id, session.user.id))
  );

  if (!row) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const acct = await queryFirst(
    db
      .select({ providerId: account.providerId })
      .from(account)
      .where(eq(account.userId, session.user.id))
      .limit(1)
  );

  return NextResponse.json({
    email: row.email,
    provider: acct?.providerId || "credential",
    emailVerified: !!row.emailVerified,
    image: row.image,
    createdAt: row.createdAt,
  });
}
