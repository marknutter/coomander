export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { UnauthorizedError, errorResponse } from "@/lib/errors";
import { posts } from "@/lib/schema";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 25) || 25, 100);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);

    const db = getDb();
    const rows = await db
      .select()
      .from(posts)
      .where(
        and(eq(posts.user_id, session.user.id), eq(posts.platform, "instagram")),
      )
      .orderBy(desc(posts.published_at))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({ posts: rows, limit, offset });
  } catch (error) {
    return errorResponse(error);
  }
}
