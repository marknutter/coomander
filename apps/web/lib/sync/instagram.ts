import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { queryFirst } from "@/lib/db-helpers";
import {
  accountSnapshots,
  demographics,
  postInsights,
  posts,
} from "@/lib/schema";
import {
  getAccountInfo,
  getAccountInsights,
  getDemographics,
  getMedia,
  getPostInsights,
  InstagramAuthError,
  markTokenExpired,
} from "@/lib/platforms/instagram";
import { onNewInstagramPost } from "@/lib/coomander/autoDrop";

const PLATFORM = "instagram";

function todayDate(): string {
  return new Date().toISOString().split("T")[0];
}

// ─── Posts + Per-Post Insights ───────────────────────────────────────

export interface SyncPostsResult {
  postsUpserted: number;
  insightsUpserted: number;
  pagesProcessed: number;
}

export async function syncInstagramPosts(
  userId: string,
  maxPages = 10,
): Promise<SyncPostsResult> {
  const db = getDb();
  let cursor: string | undefined;
  let postsUpserted = 0;
  let insightsUpserted = 0;
  let pagesProcessed = 0;
  const today = todayDate();

  for (let page = 0; page < maxPages; page++) {
    const mediaPage = await getMedia(userId, cursor);
    pagesProcessed++;

    for (const media of mediaPage.data) {
      const existing = await queryFirst(
        db
          .select()
          .from(posts)
          .where(
            and(
              eq(posts.user_id, userId),
              eq(posts.platform, PLATFORM),
              eq(posts.platform_post_id, media.id),
            ),
          )
          .limit(1),
      );

      let postId: number;
      if (existing) {
        postId = existing.id;
        await db
          .update(posts)
          .set({
            caption: media.caption,
            media_type: media.mediaType,
            media_url: media.mediaUrl,
            thumbnail_url: media.thumbnailUrl,
            permalink: media.permalink,
            published_at: media.timestamp,
          })
          .where(eq(posts.id, postId));
      } else {
        const inserted = await db
          .insert(posts)
          .values({
            user_id: userId,
            platform_post_id: media.id,
            platform: PLATFORM,
            caption: media.caption,
            media_type: media.mediaType,
            media_url: media.mediaUrl,
            thumbnail_url: media.thumbnailUrl,
            permalink: media.permalink,
            published_at: media.timestamp,
          })
          .returning({ id: posts.id });
        postId = inserted[0].id;

        // Coomander auto-drop (#152): attribute the new post to a content beat
        // and confirm over Telegram. Best-effort — never breaks the sync.
        await onNewInstagramPost(userId, {
          mediaId: media.id,
          mediaType: media.mediaType,
          caption: media.caption,
          permalink: media.permalink,
        });
      }

      postsUpserted++;

      try {
        const insights = await getPostInsights(userId, media.id);

        const existingInsight = await queryFirst(
          db
            .select()
            .from(postInsights)
            .where(
              and(
                eq(postInsights.post_id, postId),
                eq(postInsights.snapshot_date, today),
              ),
            )
            .limit(1),
        );

        if (existingInsight) {
          await db
            .update(postInsights)
            .set({
              impressions: insights.views,
              reach: insights.reach,
              engagement: insights.totalInteractions,
              saves: insights.saved,
              likes: insights.likes,
              comments: insights.comments,
              shares: insights.shares,
            })
            .where(eq(postInsights.id, existingInsight.id));
        } else {
          await db.insert(postInsights).values({
            user_id: userId,
            post_id: postId,
            snapshot_date: today,
            impressions: insights.views,
            reach: insights.reach,
            engagement: insights.totalInteractions,
            saves: insights.saved,
            likes: insights.likes,
            comments: insights.comments,
            shares: insights.shares,
          });
        }

        insightsUpserted++;
      } catch (err) {
        // Some media types don't support all insight metrics — skip per-post failures.
        console.warn(
          "[ig-sync] insight fetch failed for post",
          { userId, mediaId: media.id, err: (err as Error).message },
        );
      }
    }

    if (!mediaPage.nextCursor) break;
    cursor = mediaPage.nextCursor;
  }

  return { postsUpserted, insightsUpserted, pagesProcessed };
}

// ─── Account Snapshots ───────────────────────────────────────────────

export interface SyncAccountResult {
  snapshotsUpserted: number;
}

export async function syncInstagramAccount(userId: string): Promise<SyncAccountResult> {
  const db = getDb();
  const today = todayDate();
  const accountInfo = await getAccountInfo(userId);

  const since = new Date();
  since.setDate(since.getDate() - 7);
  const until = new Date();

  const insights = await getAccountInsights(userId, since, until);

  const existing = await queryFirst(
    db
      .select()
      .from(accountSnapshots)
      .where(
        and(
          eq(accountSnapshots.user_id, userId),
          eq(accountSnapshots.platform, PLATFORM),
          eq(accountSnapshots.snapshot_date, today),
        ),
      )
      .limit(1),
  );

  if (existing) {
    await db
      .update(accountSnapshots)
      .set({
        media_count: accountInfo.mediaCount,
        reach: insights.reach,
        profile_views: insights.profileViews,
      })
      .where(eq(accountSnapshots.id, existing.id));
  } else {
    await db.insert(accountSnapshots).values({
      user_id: userId,
      platform: PLATFORM,
      snapshot_date: today,
      media_count: accountInfo.mediaCount,
      reach: insights.reach,
      profile_views: insights.profileViews,
    });
  }

  return { snapshotsUpserted: 1 };
}

// ─── Demographics ────────────────────────────────────────────────────

export interface SyncDemographicsResult {
  entriesUpserted: number;
}

export async function syncInstagramDemographics(
  userId: string,
): Promise<SyncDemographicsResult> {
  const db = getDb();
  const today = todayDate();
  let entriesUpserted = 0;

  try {
    const demo = await getDemographics(userId);

    const allEntries: Array<{ metric: string; key: string; value: number }> = [
      ...demo.ageGender.map((e) => ({ metric: "gender_age", ...e })),
      ...demo.countries.map((e) => ({ metric: "country", ...e })),
      ...demo.cities.map((e) => ({ metric: "city", ...e })),
    ];

    for (const entry of allEntries) {
      const existing = await queryFirst(
        db
          .select()
          .from(demographics)
          .where(
            and(
              eq(demographics.user_id, userId),
              eq(demographics.platform, PLATFORM),
              eq(demographics.snapshot_date, today),
              eq(demographics.metric, entry.metric),
              eq(demographics.key, entry.key),
            ),
          )
          .limit(1),
      );

      if (existing) {
        await db
          .update(demographics)
          .set({ value: entry.value })
          .where(eq(demographics.id, existing.id));
      } else {
        await db.insert(demographics).values({
          user_id: userId,
          platform: PLATFORM,
          snapshot_date: today,
          metric: entry.metric,
          key: entry.key,
          value: entry.value,
        });
      }

      entriesUpserted++;
    }
  } catch (err) {
    // Demographics require ≥100 followers; skip gracefully if unavailable.
    console.warn(
      "[ig-sync] demographics unavailable",
      { userId, err: (err as Error).message },
    );
  }

  return { entriesUpserted };
}

// ─── Full sync orchestrator ──────────────────────────────────────────

export interface SyncAllResult {
  posts: SyncPostsResult;
  account: SyncAccountResult;
  demographics: SyncDemographicsResult;
}

export async function syncAllInstagram(userId: string): Promise<SyncAllResult> {
  try {
    const postsResult = await syncInstagramPosts(userId);
    const accountResult = await syncInstagramAccount(userId);
    const demographicsResult = await syncInstagramDemographics(userId);
    return { posts: postsResult, account: accountResult, demographics: demographicsResult };
  } catch (err) {
    if (err instanceof InstagramAuthError) {
      await markTokenExpired(userId);
    }
    throw err;
  }
}
