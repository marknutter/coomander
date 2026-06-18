import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { queryFirst } from "@/lib/db-helpers";
import { platforms } from "@/lib/schema";

// ─── Types ───────────────────────────────────────────────────────────

export interface InstagramAccountInfo {
  id: string;
  igUserId: string;
  username: string;
  accountType: string;
  mediaCount: number;
}

export interface InstagramMedia {
  id: string;
  caption: string | null;
  timestamp: string;
  likeCount: number;
  commentsCount: number;
  mediaType: string;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  permalink: string;
}

export interface InstagramMediaPage {
  data: InstagramMedia[];
  nextCursor: string | null;
}

export interface InstagramPostInsights {
  views: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saved: number;
  totalInteractions: number;
}

export interface InstagramAccountInsights {
  reach: number;
  profileViews: number;
}

export interface InstagramDemographicEntry {
  key: string;
  value: number;
}

export interface InstagramDemographics {
  ageGender: InstagramDemographicEntry[];
  countries: InstagramDemographicEntry[];
  cities: InstagramDemographicEntry[];
}

interface IGApiError {
  error: {
    message: string;
    type: string;
    code: number;
  };
}

// ─── Error classes ───────────────────────────────────────────────────

export class InstagramAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstagramAuthError";
  }
}

export class InstagramRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstagramRateLimitError";
  }
}

export class InstagramApiError extends Error {
  code: number;
  constructor(message: string, code: number) {
    super(message);
    this.name = "InstagramApiError";
    this.code = code;
  }
}

// ─── Constants ───────────────────────────────────────────────────────

export const IG_API_BASE = "https://graph.instagram.com/v21.0";
export const IG_OAUTH_BASE = "https://api.instagram.com";
export const IG_GRAPH_BASE = "https://graph.instagram.com";
export const PLATFORM_NAME = "instagram";

// ─── Core fetch ──────────────────────────────────────────────────────

async function igFetch<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok || (data as IGApiError).error) {
    const err = (data as IGApiError).error;
    const code = err?.code ?? response.status;
    const message = err?.message ?? `Instagram API error: ${response.status}`;

    if (code === 190) {
      throw new InstagramAuthError(message);
    }

    if (response.status === 429 || code === 4) {
      throw new InstagramRateLimitError(message);
    }

    throw new InstagramApiError(message, code);
  }

  return data as T;
}

// ─── Token management ────────────────────────────────────────────────

export async function getToken(userId: string): Promise<string> {
  const db = getDb();
  const row = await queryFirst(
    db
      .select()
      .from(platforms)
      .where(and(eq(platforms.user_id, userId), eq(platforms.platform, PLATFORM_NAME)))
      .limit(1)
  );

  const token = row?.access_token ?? null;
  if (!token) {
    throw new InstagramAuthError(
      "No Instagram token found. Connect your account first.",
    );
  }
  return token;
}

export async function getConnectedAccount(
  userId: string,
): Promise<{ username: string | null; accountId: string; expiresAt: string | null } | null> {
  const db = getDb();
  const row = await queryFirst(
    db
      .select()
      .from(platforms)
      .where(and(eq(platforms.user_id, userId), eq(platforms.platform, PLATFORM_NAME)))
      .limit(1),
  );
  if (!row || !row.access_token) return null;
  return {
    username: row.username,
    accountId: row.account_id,
    expiresAt: row.token_expires_at,
  };
}

export async function storeToken(
  userId: string,
  token: string,
  expiresInSeconds?: number,
): Promise<InstagramAccountInfo> {
  // Verify the token works and get account info
  const account = await igFetch<{
    user_id: string;
    username: string;
    account_type: string;
    media_count: number;
    id: string;
  }>(
    `${IG_API_BASE}/me?fields=user_id,username,account_type,media_count&access_token=${token}`,
  );

  const now = new Date().toISOString();
  const expiresAt = expiresInSeconds
    ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
    : null;

  const db = getDb();
  const existing = await queryFirst(
    db
      .select()
      .from(platforms)
      .where(and(eq(platforms.user_id, userId), eq(platforms.platform, PLATFORM_NAME)))
      .limit(1),
  );

  if (existing) {
    await db
      .update(platforms)
      .set({
        account_id: account.user_id,
        username: account.username,
        access_token: token,
        token_expires_at: expiresAt,
        updated_at: now,
      })
      .where(eq(platforms.id, existing.id));
  } else {
    await db.insert(platforms).values({
      user_id: userId,
      platform: PLATFORM_NAME,
      account_id: account.user_id,
      username: account.username,
      access_token: token,
      token_expires_at: expiresAt,
      created_at: now,
      updated_at: now,
    });
  }

  return {
    id: account.id,
    igUserId: account.user_id,
    username: account.username,
    accountType: account.account_type,
    mediaCount: account.media_count,
  };
}

export async function markTokenExpired(userId: string): Promise<void> {
  const db = getDb();
  await db
    .update(platforms)
    .set({ access_token: null, token_expires_at: new Date().toISOString() })
    .where(and(eq(platforms.user_id, userId), eq(platforms.platform, PLATFORM_NAME)));
}

// ─── OAuth helpers ───────────────────────────────────────────────────

export interface ShortLivedTokenResponse {
  access_token: string;
  user_id: number;
  permissions?: string[];
}

export interface LongLivedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export async function exchangeCodeForToken(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<ShortLivedTokenResponse> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: params.redirectUri,
    code: params.code,
  });

  const response = await fetch(`${IG_OAUTH_BASE}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await response.json()) as ShortLivedTokenResponse & {
    error_message?: string;
    error_type?: string;
  };
  if (!response.ok || !data.access_token) {
    throw new InstagramApiError(
      data.error_message || `Code exchange failed (${response.status})`,
      response.status,
    );
  }
  return data;
}

export async function upgradeToLongLivedToken(params: {
  clientSecret: string;
  shortLivedToken: string;
}): Promise<LongLivedTokenResponse> {
  const url = `${IG_GRAPH_BASE}/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(
    params.clientSecret,
  )}&access_token=${encodeURIComponent(params.shortLivedToken)}`;
  return igFetch<LongLivedTokenResponse>(url);
}

// ─── API methods ─────────────────────────────────────────────────────

export async function getAccountInfo(userId: string): Promise<InstagramAccountInfo> {
  const token = await getToken(userId);
  const result = await igFetch<{
    user_id: string;
    username: string;
    account_type: string;
    media_count: number;
    id: string;
  }>(
    `${IG_API_BASE}/me?fields=user_id,username,account_type,media_count&access_token=${token}`,
  );

  return {
    id: result.id,
    igUserId: result.user_id,
    username: result.username,
    accountType: result.account_type,
    mediaCount: result.media_count,
  };
}

export async function getMedia(userId: string, cursor?: string): Promise<InstagramMediaPage> {
  const token = await getToken(userId);

  let url = `${IG_API_BASE}/me/media?fields=id,caption,timestamp,like_count,comments_count,media_type,media_url,thumbnail_url,permalink&limit=25&access_token=${token}`;
  if (cursor) url += `&after=${cursor}`;

  const result = await igFetch<{
    data: Array<{
      id: string;
      caption?: string;
      timestamp: string;
      like_count: number;
      comments_count: number;
      media_type: string;
      media_url?: string;
      thumbnail_url?: string;
      permalink: string;
    }>;
    paging?: { cursors?: { after?: string } };
  }>(url);

  return {
    data: result.data.map((item) => ({
      id: item.id,
      caption: item.caption ?? null,
      timestamp: item.timestamp,
      likeCount: item.like_count,
      commentsCount: item.comments_count,
      mediaType: item.media_type,
      mediaUrl: item.media_url ?? null,
      thumbnailUrl: item.thumbnail_url ?? null,
      permalink: item.permalink,
    })),
    nextCursor: result.paging?.cursors?.after ?? null,
  };
}

export async function getPostInsights(
  userId: string,
  mediaId: string,
): Promise<InstagramPostInsights> {
  const token = await getToken(userId);
  const result = await igFetch<{
    data: Array<{ name: string; values: Array<{ value: number }> }>;
  }>(
    `${IG_API_BASE}/${mediaId}/insights?metric=views,reach,likes,comments,shares,saved,total_interactions&access_token=${token}`,
  );

  const metrics: Record<string, number> = {};
  for (const metric of result.data) {
    metrics[metric.name] = metric.values[0]?.value ?? 0;
  }

  return {
    views: metrics.views ?? 0,
    reach: metrics.reach ?? 0,
    likes: metrics.likes ?? 0,
    comments: metrics.comments ?? 0,
    shares: metrics.shares ?? 0,
    saved: metrics.saved ?? 0,
    totalInteractions: metrics.total_interactions ?? 0,
  };
}

export async function getAccountInsights(
  userId: string,
  since: Date,
  until: Date,
): Promise<InstagramAccountInsights> {
  const token = await getToken(userId);
  const sinceUnix = Math.floor(since.getTime() / 1000);
  const untilUnix = Math.floor(until.getTime() / 1000);

  const result = await igFetch<{
    data: Array<{ name: string; total_value: { value: number } }>;
  }>(
    `${IG_API_BASE}/me/insights?metric=reach,profile_views&metric_type=total_value&period=day&since=${sinceUnix}&until=${untilUnix}&access_token=${token}`,
  );

  const metrics: Record<string, number> = {};
  for (const metric of result.data) {
    metrics[metric.name] = metric.total_value?.value ?? 0;
  }

  return {
    reach: metrics.reach ?? 0,
    profileViews: metrics.profile_views ?? 0,
  };
}

export async function getDemographics(userId: string): Promise<InstagramDemographics> {
  const token = await getToken(userId);

  type Breakdown = {
    data: Array<{
      name: string;
      total_value: {
        breakdowns: Array<{
          dimension_keys: string[];
          results: Array<{ dimension_values: string[]; value: number }>;
        }>;
      };
    }>;
  };

  const ageGenderResult = await igFetch<Breakdown>(
    `${IG_API_BASE}/me/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&timeframe=last_30_days&breakdown=age,gender&access_token=${token}`,
  );
  const ageGender: InstagramDemographicEntry[] = [];
  const ageGenderData = ageGenderResult.data[0]?.total_value?.breakdowns[0]?.results ?? [];
  for (const entry of ageGenderData) {
    const [age, gender] = entry.dimension_values;
    ageGender.push({ key: `${gender}.${age}`, value: entry.value });
  }

  const countryResult = await igFetch<Breakdown>(
    `${IG_API_BASE}/me/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&timeframe=last_30_days&breakdown=country&access_token=${token}`,
  );
  const countries: InstagramDemographicEntry[] = [];
  const countryData = countryResult.data[0]?.total_value?.breakdowns[0]?.results ?? [];
  for (const entry of countryData) {
    countries.push({ key: entry.dimension_values[0], value: entry.value });
  }

  const cityResult = await igFetch<Breakdown>(
    `${IG_API_BASE}/me/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&timeframe=last_30_days&breakdown=city&access_token=${token}`,
  );
  const cities: InstagramDemographicEntry[] = [];
  const cityData = cityResult.data[0]?.total_value?.breakdowns[0]?.results ?? [];
  for (const entry of cityData) {
    cities.push({ key: entry.dimension_values[0], value: entry.value });
  }

  return {
    ageGender: ageGender.sort((a, b) => b.value - a.value),
    countries: countries.sort((a, b) => b.value - a.value),
    cities: cities.sort((a, b) => b.value - a.value),
  };
}
