import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { user } from "@/lib/schema";
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
        createdAt: user.createdAt,
        plan: user.plan,
      })
      .from(user)
      .where(eq(user.id, session.user.id))
  );

  if (!row) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const exportData = {
    account: {
      email: row.email,
      emailVerified: !!row.emailVerified,
      plan: row.plan || "free",
      createdAt: row.createdAt,
    },
    exportedAt: new Date().toISOString(),
  };

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="coomander-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
