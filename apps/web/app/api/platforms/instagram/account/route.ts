export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { queryFirst } from "@/lib/db-helpers";
import { UnauthorizedError, errorResponse } from "@/lib/errors";
import { accountSnapshots } from "@/lib/schema";
import { getConnectedAccount } from "@/lib/platforms/instagram";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const userId = session.user.id;
    const connection = await getConnectedAccount(userId);

    const db = getDb();
    const snapshot = await queryFirst(
      db
        .select()
        .from(accountSnapshots)
        .where(
          and(
            eq(accountSnapshots.user_id, userId),
            eq(accountSnapshots.platform, "instagram"),
          ),
        )
        .orderBy(desc(accountSnapshots.snapshot_date))
        .limit(1),
    );

    return NextResponse.json({
      connected: !!connection,
      username: connection?.username ?? null,
      accountId: connection?.accountId ?? null,
      snapshot: snapshot ?? null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
