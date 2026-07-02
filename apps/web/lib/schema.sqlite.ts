/**
 * Drizzle ORM schema definitions for all database tables.
 *
 * Better Auth tables (user, session, account, verification, twoFactor) are
 * defined here as reference-only — they are excluded from drizzle-kit migrations
 * via tablesFilter in drizzle.config.ts. They exist so we can use them in
 * JOINs and get proper FK types.
 *
 * Column names match the existing DB exactly (mixed snake_case/camelCase).
 */

import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ─── Better Auth Tables (reference-only, not managed by drizzle-kit) ─────────

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified").notNull().default(0),
  name: text("name"),
  image: text("image"),
  createdAt: integer("createdAt").notNull(),
  updatedAt: integer("updatedAt").notNull(),
  twoFactorEnabled: integer("twoFactorEnabled").notNull().default(0),
  plan: text("plan").default("free"),
  stripeCustomerId: text("stripeCustomerId"),
  stripeSubscriptionId: text("stripeSubscriptionId"),
  subscriptionStatus: text("subscriptionStatus").default("inactive"),
  isAdmin: integer("isAdmin").notNull().default(0),
  // Legacy, unenforced-on-its-own flag — superseded by the Better Auth admin
  // plugin's banned/banExpires below (session.create.before hook rejects
  // sign-in for banned users). Kept for display/back-compat; no new code
  // should gate on it. See lib/auth.ts admin() plugin comment.
  disabled: integer("disabled").notNull().default(0),
  // Better Auth admin plugin (ban semantics) — role is this app's admin gate
  // bridge (synced to "admin" wherever isAdmin=1); banned/banReason/banExpires
  // are enforced natively by the plugin's session-create hook.
  role: text("role").default("user"),
  banned: integer("banned").default(0),
  banReason: text("banReason"),
  banExpires: integer("banExpires"),
  // Coomander (#151): Telegram destination + opt-in flag for the ops agent.
  telegramChatId: text("telegramChatId"),
  coomanderEnabled: integer("coomanderEnabled").notNull().default(0),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("createdAt").notNull(),
  updatedAt: integer("updatedAt").notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
}, (table) => [
  index("idx_session_userId").on(table.userId),
  index("idx_session_token").on(table.token),
]);

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  expiresAt: integer("expiresAt"),
  password: text("password"),
  createdAt: integer("createdAt").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updatedAt").notNull().default(sql`(unixepoch())`),
  accessTokenExpiresAt: integer("accessTokenExpiresAt"),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt"),
  scope: text("scope"),
}, (table) => [
  uniqueIndex("account_providerId_accountId_unique").on(table.providerId, table.accountId),
  index("idx_account_userId").on(table.userId),
]);

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt").notNull(),
  createdAt: integer("createdAt"),
  updatedAt: integer("updatedAt"),
}, (table) => [
  index("idx_verification_identifier").on(table.identifier),
]);

export const twoFactor = sqliteTable("twoFactor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backupCodes").notNull(),
  userId: text("userId").notNull().unique().references(() => user.id, { onDelete: "cascade" }),
});

// ─── App Tables (managed by drizzle-kit migrations) ──────────────────────────

export const adminLogs = sqliteTable("admin_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  admin_id: text("admin_id").notNull().references(() => user.id),
  action: text("action").notNull(),
  target_type: text("target_type"),
  target_id: text("target_id"),
  details: text("details"),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_admin_logs_admin_id").on(table.admin_id),
  index("idx_admin_logs_created_at").on(table.created_at),
]);

export const planOverrides = sqliteTable("plan_overrides", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  user_id: text("user_id").notNull().unique().references(() => user.id),
  plan: text("plan").notNull().default("pro"),
  reason: text("reason"),
  granted_by: text("granted_by").notNull().references(() => user.id),
  expires_at: text("expires_at"),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_plan_overrides_user_id").on(table.user_id),
]);

export const newsletterSubscribers = sqliteTable("newsletter_subscribers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name"),
  status: text("status").default("active"),
  source: text("source").default("website"),
  unsubscribed_at: text("unsubscribed_at"),
  tags: text("tags").default("[]"),
  unsubscribe_token: text("unsubscribe_token"),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_ns_unsubscribe_token").on(table.unsubscribe_token),
]);

export const blogPosts = sqliteTable("blog_posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  content: text("content").notNull(),
  status: text("status").default("draft"),
  author_id: text("author_id").references(() => user.id),
  published_at: text("published_at"),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updated_at: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  payload: text("payload").notNull().default("{}"),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("maxAttempts").notNull().default(3),
  lastError: text("lastError"),
  scheduledAt: integer("scheduledAt").notNull().default(sql`(unixepoch())`),
  startedAt: integer("startedAt"),
  completedAt: integer("completedAt"),
  createdAt: integer("createdAt").notNull().default(sql`(unixepoch())`),
}, (table) => [
  index("idx_jobs_status_scheduled").on(table.status, table.scheduledAt),
  index("idx_jobs_type").on(table.type),
]);

export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  key: text("key").notNull().unique(),
  filename: text("filename").notNull(),
  contentType: text("contentType").notNull().default("application/octet-stream"),
  size: integer("size").notNull().default(0),
  storageBackend: text("storageBackend").notNull().default("local"),
  createdAt: integer("createdAt").notNull().default(sql`(unixepoch())`),
}, (table) => [
  index("idx_files_userId").on(table.userId),
  index("idx_files_key").on(table.key),
]);

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("info"),
  title: text("title").notNull(),
  message: text("message").notNull().default(""),
  read: integer("read").notNull().default(0),
  createdAt: integer("createdAt").notNull().default(sql`(unixepoch())`),
}, (table) => [
  index("idx_notifications_userId").on(table.userId),
  index("idx_notifications_userId_read").on(table.userId, table.read),
]);

export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: text("events").notNull().default("[]"),
  active: integer("active").notNull().default(1),
  createdAt: integer("createdAt").notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updatedAt").notNull().default(sql`(unixepoch())`),
}, (table) => [
  index("idx_webhooks_userId").on(table.userId),
]);

export const webhookDeliveries = sqliteTable("webhook_deliveries", {
  id: text("id").primaryKey(),
  webhookId: text("webhookId").notNull().references(() => webhooks.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  payload: text("payload").notNull().default("{}"),
  responseStatus: integer("responseStatus"),
  responseBody: text("responseBody"),
  success: integer("success").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("lastError"),
  createdAt: integer("createdAt").notNull().default(sql`(unixepoch())`),
  completedAt: integer("completedAt"),
}, (table) => [
  index("idx_webhook_deliveries_webhookId").on(table.webhookId),
  index("idx_webhook_deliveries_createdAt").on(table.createdAt),
]);

export const roles = sqliteTable("roles", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  permissions: text("permissions").notNull().default("[]"),
  is_system: integer("is_system").notNull().default(0),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updated_at: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export const userRoles = sqliteTable("user_roles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  role_id: text("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  assigned_by: text("assigned_by").references(() => user.id, { onDelete: "set null" }),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_user_roles_user_id").on(table.user_id),
  index("idx_user_roles_role_id").on(table.role_id),
  uniqueIndex("user_roles_user_id_role_id_unique").on(table.user_id, table.role_id),
]);

export const waitlist = sqliteTable("waitlist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  referral_code: text("referral_code").notNull().unique(),
  referred_by: text("referred_by"),
  referral_count: integer("referral_count").notNull().default(0),
  status: text("status").notNull().default("waiting"),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  invited_at: text("invited_at"),
}, (table) => [
  index("idx_waitlist_email").on(table.email),
  index("idx_waitlist_status").on(table.status),
  index("idx_waitlist_referral_code").on(table.referral_code),
]);

export const inviteCodes = sqliteTable("invite_codes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  email: text("email"),
  used_by: text("used_by").references(() => user.id),
  created_by: text("created_by").notNull().references(() => user.id),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  used_at: text("used_at"),
  expires_at: text("expires_at"),
}, (table) => [
  index("idx_invite_codes_code").on(table.code),
  index("idx_invite_codes_email").on(table.email),
]);

export const emailEvents = sqliteTable("email_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email_id: text("email_id"),
  campaign_id: text("campaign_id"),
  subscriber_email: text("subscriber_email"),
  event_type: text("event_type").notNull(),
  link_url: text("link_url"),
  metadata: text("metadata").default("{}"),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_ee_campaign_id").on(table.campaign_id),
  index("idx_ee_subscriber_email").on(table.subscriber_email),
  index("idx_ee_event_type").on(table.event_type),
]);

export const emailCampaigns = sqliteTable("email_campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  preview_text: text("preview_text").default(""),
  html_content: text("html_content").notNull(),
  status: text("status").notNull().default("draft"),
  audience_filter: text("audience_filter").default("{}"),
  recipient_count: integer("recipient_count").default(0),
  sent_count: integer("sent_count").default(0),
  batches_total: integer("batches_total").default(0),
  batches_done: integer("batches_done").default(0),
  batches_failed: integer("batches_failed").default(0),
  scheduled_at: text("scheduled_at"),
  sent_at: text("sent_at"),
  resend_broadcast_id: text("resend_broadcast_id"),
  created_by: text("created_by").notNull().references(() => user.id),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updated_at: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_campaigns_status").on(table.status),
  index("idx_campaigns_created_at").on(table.created_at),
]);

// Per-batch idempotency for the send engine (migration 027, sync #222 fix):
// advanceBatchProgress records a row here (campaign_id, batch_id) before
// incrementing email_campaigns.batches_done, so a Cloudflare Queues
// at-least-once REDELIVERY of an already-processed batch can't double-count
// batches_done (and prematurely finalize the campaign as 'sent'). Rows are
// cleared per-campaign at the start of every fresh send/resend so batch ids
// (positional within that send attempt) never collide across attempts.
export const campaignSendBatches = sqliteTable("campaign_send_batches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  campaign_id: text("campaign_id").notNull(),
  batch_id: text("batch_id").notNull(),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_csb_campaign_batch_unique").on(table.campaign_id, table.batch_id),
]);

export const _migrations = sqliteTable("_migrations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  applied_at: text("applied_at").default(sql`CURRENT_TIMESTAMP`),
});

// ─── Instagram / Multi-Platform Analysis Tables ──────────────────────────────
// All scoped per-user via user_id FK with ON DELETE CASCADE.

export const platforms = sqliteTable("platforms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  account_id: text("account_id").notNull(),
  username: text("username"),
  access_token: text("access_token"),
  refresh_token: text("refresh_token"),
  token_expires_at: text("token_expires_at"),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updated_at: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("platforms_user_platform_unique").on(table.user_id, table.platform),
  index("idx_platforms_user_id").on(table.user_id),
]);

export const posts = sqliteTable("posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  platform_post_id: text("platform_post_id").notNull(),
  platform: text("platform").notNull(),
  caption: text("caption"),
  media_type: text("media_type"),
  media_url: text("media_url"),
  thumbnail_url: text("thumbnail_url"),
  permalink: text("permalink"),
  published_at: text("published_at"),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("posts_user_platform_post_unique").on(table.user_id, table.platform, table.platform_post_id),
  index("idx_posts_user_id").on(table.user_id),
  index("idx_posts_user_published").on(table.user_id, table.published_at),
]);

export const postAnalysis = sqliteTable("post_analysis", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  post_id: integer("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  setting: text("setting"),
  lighting: text("lighting"),
  face_visible: integer("face_visible", { mode: "boolean" }),
  text_overlay: integer("text_overlay", { mode: "boolean" }),
  visual_style: text("visual_style"),
  caption_length: integer("caption_length"),
  hook_type: text("hook_type"),
  cta_present: integer("cta_present", { mode: "boolean" }),
  cta_type: text("cta_type"),
  caption_tone: text("caption_tone"),
  emoji_count: integer("emoji_count"),
  hashtag_count: integer("hashtag_count"),
  transcript: text("transcript"),
  spoken_hook: text("spoken_hook"),
  key_frame_analysis: text("key_frame_analysis"),
  raw_analysis: text("raw_analysis"),
  analyzed_at: text("analyzed_at").default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("post_analysis_post_unique").on(table.post_id),
  index("idx_post_analysis_user_id").on(table.user_id),
]);

export const postInsights = sqliteTable("post_insights", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  post_id: integer("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  snapshot_date: text("snapshot_date").notNull(),
  impressions: integer("impressions"),
  reach: integer("reach"),
  engagement: integer("engagement"),
  saves: integer("saves"),
  likes: integer("likes"),
  comments: integer("comments"),
  shares: integer("shares"),
  score: integer("score"),
  upvote_ratio: real("upvote_ratio"),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("post_insights_post_date_unique").on(table.post_id, table.snapshot_date),
  index("idx_post_insights_user_id").on(table.user_id),
]);

export const accountSnapshots = sqliteTable("account_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  snapshot_date: text("snapshot_date").notNull(),
  follower_count: integer("follower_count"),
  media_count: integer("media_count"),
  reach: integer("reach"),
  impressions: integer("impressions"),
  profile_views: integer("profile_views"),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("account_snapshots_user_platform_date_unique").on(table.user_id, table.platform, table.snapshot_date),
  index("idx_account_snapshots_user_id").on(table.user_id),
]);

export const demographics = sqliteTable("demographics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  snapshot_date: text("snapshot_date").notNull(),
  metric: text("metric").notNull(),
  key: text("key").notNull(),
  value: real("value").notNull(),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("demographics_unique").on(table.user_id, table.platform, table.snapshot_date, table.metric, table.key),
  index("idx_demographics_user_id").on(table.user_id),
]);

export const contentInsights = sqliteTable("content_insights", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  report_json: text("report_json").notNull(),
  posts_analyzed: integer("posts_analyzed").notNull(),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_content_insights_user_id").on(table.user_id),
]);

// ─── Type exports for IG analysis tables ─────────────────────────────────────

export type Platform = typeof platforms.$inferSelect;
export type NewPlatform = typeof platforms.$inferInsert;

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;

export type PostAnalysis = typeof postAnalysis.$inferSelect;
export type NewPostAnalysis = typeof postAnalysis.$inferInsert;

export type PostInsight = typeof postInsights.$inferSelect;
export type NewPostInsight = typeof postInsights.$inferInsert;

export type AccountSnapshot = typeof accountSnapshots.$inferSelect;
export type NewAccountSnapshot = typeof accountSnapshots.$inferInsert;

export type Demographic = typeof demographics.$inferSelect;
export type NewDemographic = typeof demographics.$inferInsert;

export type ContentInsight = typeof contentInsights.$inferSelect;
export type NewContentInsight = typeof contentInsights.$inferInsert;

// ─── Coomander — AI ops agent infrastructure (#151) ──────────────────────────
// Pure infra port from ~/Code/geology. Domain model is #152. All tables are
// user_id-scoped. See migrations/016_coomander_infra.sql and
// docs/strategy/coomander-direction.md.

export const coomanderSettings = sqliteTable("coomander_settings", {
  user_id: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  // tight (default) | moderate | light — see coomander-direction.md § Nag frequency
  nag_frequency: text("nag_frequency").notNull().default("tight"),
  // light_companion (default) | full_companion | operational
  persona_mode: text("persona_mode").notNull().default("light_companion"),
  ping_times_json: text("ping_times_json"),
  // IANA timezone for the creator's local day boundary (#183). NULL -> DEFAULT_TIMEZONE.
  timezone: text("timezone"),
  companion_consent_at: integer("companion_consent_at"),
  ops_seeded_at: integer("ops_seeded_at"),
  defaults_banner_dismissed_at: integer("defaults_banner_dismissed_at"),
  created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
  updated_at: integer("updated_at").notNull().default(sql`(unixepoch())`),
});

// One-time codes to link a creator's Telegram chat to their account (#185).
export const coomanderLinkCodes = sqliteTable("coomander_link_codes", {
  code: text("code").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  expires_at: integer("expires_at").notNull(),
  created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
});

// RETENTION POLICY: NO TTL, NO deletion sweep, EVER. This is the long-term
// companion-memory substrate — full-companion persona depends on an indefinite
// log of the creator's conversational history. Any deletion is a manual
// operator action (user request / GDPR), never code.
export const coomanderMessageLog = sqliteTable("coomander_message_log", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(), // 'inbound' | 'outbound'
  telegram_update_id: integer("telegram_update_id"),
  text: text("text").notNull(),
  tool_call_json: text("tool_call_json"),
  persona_mode: text("persona_mode").notNull().default("light_companion"),
  created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  index("idx_coomander_message_log_user_created").on(table.user_id, table.created_at),
]);

export const coomanderUsage = sqliteTable("coomander_usage", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  slot_or_inbound: text("slot_or_inbound").notNull(),
  input_tokens: integer("input_tokens").notNull().default(0),
  output_tokens: integer("output_tokens").notNull().default(0),
  model: text("model").notNull(),
  created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  index("idx_coomander_usage_user_id").on(table.user_id),
]);

export const coomanderDayState = sqliteTable("coomander_day_state", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  date: text("date").notNull(), // YYYY-MM-DD in the user's local tz
  morning_ping_sent_at: integer("morning_ping_sent_at"),
  midday_ping_sent_at: integer("midday_ping_sent_at"),
  evening_recap_at: integer("evening_recap_at"),
  day_quality: text("day_quality"), // 'good' | 'bad' | null
}, (table) => [
  uniqueIndex("coomander_day_state_user_date_unique").on(table.user_id, table.date),
  index("idx_coomander_day_state_user_id").on(table.user_id),
]);

export const coomanderDedup = sqliteTable("coomander_dedup", {
  telegram_update_id: integer("telegram_update_id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  processed_at: integer("processed_at").notNull().default(sql`(unixepoch())`),
});

export type CoomanderSettings = typeof coomanderSettings.$inferSelect;
export type NewCoomanderSettings = typeof coomanderSettings.$inferInsert;

export type CoomanderMessageLog = typeof coomanderMessageLog.$inferSelect;
export type NewCoomanderMessageLog = typeof coomanderMessageLog.$inferInsert;

export type CoomanderUsage = typeof coomanderUsage.$inferSelect;
export type NewCoomanderUsage = typeof coomanderUsage.$inferInsert;

export type CoomanderDayState = typeof coomanderDayState.$inferSelect;
export type NewCoomanderDayState = typeof coomanderDayState.$inferInsert;

export type CoomanderDedup = typeof coomanderDedup.$inferSelect;
export type NewCoomanderDedup = typeof coomanderDedup.$inferInsert;

// ─── Coomander ops domain model (#152) ───────────────────────────────────────
// OF-only creator-economy primitives. See migrations/017_coomander_domain.sql.

export const cadencePillars = sqliteTable("cadence_pillars", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").$type<"content" | "wall" | "procurement" | "engagement" | "admin">().notNull(),
  display_order: integer("display_order").notNull().default(0),
  source: text("source").notNull().default("custom"),
  archived_at: integer("archived_at"),
  created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
  updated_at: integer("updated_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  index("idx_cadence_pillars_user_id").on(table.user_id),
]);

export const cadenceBeats = sqliteTable("cadence_beats", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  pillar_id: text("pillar_id").notNull().references(() => cadencePillars.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  cadence_kind: text("cadence_kind").$type<"daily" | "weekly" | "window" | "daily_vlog_buffer">().notNull(),
  target_count: integer("target_count").notNull().default(1),
  buffer_goal_days: integer("buffer_goal_days"),
  window_start: text("window_start"),
  window_end: text("window_end"),
  priority: text("priority").$type<"low" | "med" | "high">().notNull().default("med"),
  platform_specific: text("platform_specific").$type<"ig" | "tiktok" | "fb" | "snap" | "of" | null>(),
  subtype: text("subtype"),
  active: integer("active").notNull().default(1),
  source: text("source").notNull().default("custom"),
  archived_at: integer("archived_at"),
  notes: text("notes"),
  created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
  updated_at: integer("updated_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  index("idx_cadence_beats_user_id").on(table.user_id),
  index("idx_cadence_beats_pillar_id").on(table.pillar_id),
]);

export type ContentStateValue =
  | "drafted" | "shot" | "approved" | "uploaded_to_edit" | "edited" | "scheduled" | "shipped";

export const contentStates = sqliteTable("content_states", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  beat_id: text("beat_id").references(() => cadenceBeats.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  current_state: text("current_state").$type<ContentStateValue>().notNull().default("drafted"),
  state_history_json: text("state_history_json").notNull().default("[]"),
  drive_url: text("drive_url"),
  edited_url: text("edited_url"),
  notes: text("notes"),
  created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
  updated_at: integer("updated_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  index("idx_content_states_user_id").on(table.user_id),
  index("idx_content_states_user_state").on(table.user_id, table.current_state),
  index("idx_content_states_beat_id").on(table.beat_id),
]);

export const drops = sqliteTable("drops", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  beat_id: text("beat_id").notNull().references(() => cadenceBeats.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"shipped" | "purchased" | "completed" | "captured">().notNull(),
  source: text("source").$type<"auto_ig" | "auto_of" | "telegram" | "manual_ui">().notNull(),
  platform: text("platform").$type<"ig" | "tiktok" | "fb" | "snap" | "of" | null>(),
  external_ref: text("external_ref"),
  content_state_id: text("content_state_id").references(() => contentStates.id, { onDelete: "set null" }),
  payload_json: text("payload_json").notNull().default("{}"),
  dropped_at: integer("dropped_at").notNull().default(sql`(unixepoch())`),
  created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  index("idx_drops_user_id").on(table.user_id),
  index("idx_drops_user_beat_dropped").on(table.user_id, table.beat_id, table.dropped_at),
]);

export const procurementItems = sqliteTable("procurement_items", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  beat_id: text("beat_id").references(() => cadenceBeats.id, { onDelete: "set null" }),
  category: text("category").$type<"shoot_prep" | "business_admin">().notNull(),
  label: text("label").notNull(),
  status: text("status").$type<"needed" | "ordered" | "received" | "canceled">().notNull().default("needed"),
  needed_by: text("needed_by"),
  estimated_cost_cents: integer("estimated_cost_cents"),
  actual_cost_cents: integer("actual_cost_cents"),
  source: text("source").notNull().default("custom"),
  notes: text("notes"),
  created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
  updated_at: integer("updated_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  index("idx_procurement_user_id").on(table.user_id),
  index("idx_procurement_user_category").on(table.user_id, table.category),
]);

export type CadencePillar = typeof cadencePillars.$inferSelect;
export type NewCadencePillar = typeof cadencePillars.$inferInsert;
export type CadenceBeat = typeof cadenceBeats.$inferSelect;
export type NewCadenceBeat = typeof cadenceBeats.$inferInsert;
export type ContentState = typeof contentStates.$inferSelect;
export type NewContentState = typeof contentStates.$inferInsert;
export type Drop = typeof drops.$inferSelect;
export type NewDrop = typeof drops.$inferInsert;
export type ProcurementItem = typeof procurementItems.$inferSelect;
export type NewProcurementItem = typeof procurementItems.$inferInsert;

// ─── Coomander weekly review (#154) ──────────────────────────────────────────
export const weeklyReviews = sqliteTable("weekly_reviews", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  week_ending: text("week_ending").notNull(),
  review_json: text("review_json").notNull(),
  telegram_message_id: integer("telegram_message_id"),
  drift_question_message_ids_json: text("drift_question_message_ids_json").notNull().default("[]"),
  created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
}, (table) => [
  uniqueIndex("weekly_reviews_user_week_unique").on(table.user_id, table.week_ending),
  index("idx_weekly_reviews_user_id").on(table.user_id),
]);

export type WeeklyReviewRow = typeof weeklyReviews.$inferSelect;
export type NewWeeklyReviewRow = typeof weeklyReviews.$inferInsert;

// ─── AI Gateway: app settings + encrypted provider keys (#203) ───────────────
// app_settings: app-wide key/value store (e.g. the active default chat model).
// provider_keys: one encrypted API key per provider (lib/provider-keys.ts).
// The plaintext key is NEVER stored — encrypted_key holds AES-GCM ciphertext.
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updated_at: integer("updated_at").notNull().default(sql`(unixepoch())`),
  updated_by: text("updated_by").references(() => user.id, { onDelete: "set null" }),
});

export const providerKeys = sqliteTable("provider_keys", {
  provider: text("provider").primaryKey(),
  encrypted_key: text("encrypted_key").notNull(),
  key_hint: text("key_hint"),
  created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
  updated_at: integer("updated_at").notNull().default(sql`(unixepoch())`),
  updated_by: text("updated_by").references(() => user.id, { onDelete: "set null" }),
});

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;
export type ProviderKeyRow = typeof providerKeys.$inferSelect;
export type NewProviderKeyRow = typeof providerKeys.$inferInsert;
