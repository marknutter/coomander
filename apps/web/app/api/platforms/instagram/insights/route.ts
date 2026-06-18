export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { UnauthorizedError, errorResponse } from "@/lib/errors";
import { postInsights, posts } from "@/lib/schema";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const db = getDb();
    const rows = await db
      .select({
        id: postInsights.id,
        postId: postInsights.post_id,
        snapshotDate: postInsights.snapshot_date,
        impressions: postInsights.impressions,
        reach: postInsights.reach,
        engagement: postInsights.engagement,
        saves: postInsights.saves,
        likes: postInsights.likes,
        comments: postInsights.comments,
        shares: postInsights.shares,
        platformPostId: posts.platform_post_id,
        permalink: posts.permalink,
      })
      .from(postInsights)
      .innerJoin(posts, eq(postInsights.post_id, posts.id))
      .where(
        and(
          eq(postInsights.user_id, session.user.id),
          eq(posts.platform, "instagram"),
        ),
      )
      .orderBy(desc(postInsights.snapshot_date))
      .limit(500);

    return NextResponse.json({ insights: rows });
  } catch (error) {
    return errorResponse(error);
  }
}
