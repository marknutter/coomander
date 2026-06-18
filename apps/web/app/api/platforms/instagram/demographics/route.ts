export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { queryFirst } from "@/lib/db-helpers";
import { UnauthorizedError, errorResponse } from "@/lib/errors";
import { demographics } from "@/lib/schema";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const db = getDb();
    const userId = session.user.id;

    const latest = await queryFirst(
      db
        .select({ snapshot_date: demographics.snapshot_date })
        .from(demographics)
        .where(
          and(eq(demographics.user_id, userId), eq(demographics.platform, "instagram")),
        )
        .orderBy(desc(demographics.snapshot_date))
        .limit(1),
    );

    if (!latest) {
      return NextResponse.json({ snapshotDate: null, ageGender: [], countries: [], cities: [] });
    }

    const rows = await db
      .select()
      .from(demographics)
      .where(
        and(
          eq(demographics.user_id, userId),
          eq(demographics.platform, "instagram"),
          eq(demographics.snapshot_date, latest.snapshot_date),
        ),
      );

    const ageGender = rows
      .filter((r) => r.metric === "gender_age")
      .map((r) => ({ key: r.key, value: r.value }))
      .sort((a, b) => b.value - a.value);
    const countries = rows
      .filter((r) => r.metric === "country")
      .map((r) => ({ key: r.key, value: r.value }))
      .sort((a, b) => b.value - a.value);
    const cities = rows
      .filter((r) => r.metric === "city")
      .map((r) => ({ key: r.key, value: r.value }))
      .sort((a, b) => b.value - a.value);

    return NextResponse.json({
      snapshotDate: latest.snapshot_date,
      ageGender,
      countries,
      cities,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
