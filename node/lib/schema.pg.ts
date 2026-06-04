/**
 * Drizzle ORM schema definitions for PostgreSQL.
 *
 * Mirrors schema.sqlite.ts with PG-native types:
 * - integer booleans → boolean
 * - integer timestamps → integer (unix epoch) with PG defaults
 * - text with CURRENT_TIMESTAMP → text with now()::text
 * - integer autoincrement → serial
 *
 * Column names match the existing DB exactly (mixed snake_case/camelCase).
 */

import { pgTable, text, integer, boolean, real, serial, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─── Better Auth Tables (reference-only, not managed by drizzle-kit) ─────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  name: text("name"),
  image: text("image"),
  createdAt: integer("createdAt").notNull(),
  updatedAt: integer("updatedAt").notNull(),
  twoFactorEnabled: boolean("twoFactorEnabled").notNull().default(false),
  plan: text("plan").default("free"),
  stripeCustomerId: text("stripeCustomerId"),
  stripeSubscriptionId: text("stripeSubscriptionId"),
  subscriptionStatus: text("subscriptionStatus").default("inactive"),
  isAdmin: integer("isAdmin").notNull().default(0),
  disabled: integer("disabled").notNull().default(0),
  // Coomander (#151): Telegram destination + opt-in flag for the ops agent.
  telegramChatId: text("telegramChatId"),
  coomanderEnabled: integer("coomanderEnabled").notNull().default(0),
});

export const session = pgTable("session", {
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

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  expiresAt: integer("expiresAt"),
  password: text("password"),
  createdAt: integer("createdAt").notNull().default(sql`extract(epoch from now())::integer`),
  updatedAt: integer("updatedAt").notNull().default(sql`extract(epoch from now())::integer`),
  accessTokenExpiresAt: integer("accessTokenExpiresAt"),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt"),
  scope: text("scope"),
}, (table) => [
  uniqueIndex("account_providerId_accountId_unique").on(table.providerId, table.accountId),
  index("idx_account_userId").on(table.userId),
]);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt").notNull(),
  createdAt: integer("createdAt"),
  updatedAt: integer("updatedAt"),
}, (table) => [
  index("idx_verification_identifier").on(table.identifier),
]);

export const twoFactor = pgTable("twoFactor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backupCodes").notNull(),
  userId: text("userId").notNull().unique().references(() => user.id, { onDelete: "cascade" }),
});

// ─── App Tables (managed by drizzle-kit migrations) ──────────────────────────

export const adminLogs = pgTable("admin_logs", {
  id: serial("id").primaryKey(),
  admin_id: text("admin_id").notNull().references(() => user.id),
  action: text("action").notNull(),
  target_type: text("target_type"),
  target_id: text("target_id"),
  details: text("details"),
  created_at: text("created_at").default(sql`now()::text`),
}, (table) => [
  index("idx_admin_logs_admin_id").on(table.admin_id),
  index("idx_admin_logs_created_at").on(table.created_at),
]);

export const planOverrides = pgTable("plan_overrides", {
  id: serial("id").primaryKey(),
  user_id: text("user_id").notNull().unique().references(() => user.id),
  plan: text("plan").notNull().default("pro"),
  reason: text("reason"),
  granted_by: text("granted_by").notNull().references(() => user.id),
  expires_at: text("expires_at"),
  created_at: text("created_at").default(sql`now()::text`),
}, (table) => [
  index("idx_plan_overrides_user_id").on(table.user_id),
]);

export const newsletterSubscribers = pgTable("newsletter_subscribers", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  status: text("status").default("active"),
  source: text("source").default("website"),
  unsubscribed_at: text("unsubscribed_at"),
  tags: text("tags").default("[]"),
  unsubscribe_token: text("unsubscribe_token"),
  created_at: text("created_at").default(sql`now()::text`),
}, (table) => [
  uniqueIndex("idx_ns_unsubscribe_token").on(table.unsubscribe_token),
]);

export const blogPosts = pgTable("blog_posts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  content: text("content").notNull(),
  status: text("status").default("draft"),
  author_id: text("author_id").references(() => user.id),
  published_at: text("published_at"),
  created_at: text("created_at").default(sql`now()::text`),
  updated_at: text("updated_at").default(sql`now()::text`),
});

export const jobs = pgTable("jobs", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  payload: text("payload").notNull().default("{}"),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("maxAttempts").notNull().default(3),
  lastError: text("lastError"),
  scheduledAt: integer("scheduledAt").notNull().default(sql`extract(epoch from now())::integer`),
  startedAt: integer("startedAt"),
  completedAt: integer("completedAt"),
  createdAt: integer("createdAt").notNull().default(sql`extract(epoch from now())::integer`),
}, (table) => [
  index("idx_jobs_status_scheduled").on(table.status, table.scheduledAt),
  index("idx_jobs_type").on(table.type),
]);

export const files = pgTable("files", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  key: text("key").notNull().unique(),
  filename: text("filename").notNull(),
  contentType: text("contentType").notNull().default("application/octet-stream"),
  size: integer("size").notNull().default(0),
  storageBackend: text("storageBackend").notNull().default("local"),
  createdAt: integer("createdAt").notNull().default(sql`extract(epoch from now())::integer`),
}, (table) => [
  index("idx_files_userId").on(table.userId),
  index("idx_files_key").on(table.key),
]);

export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("info"),
  title: text("title").notNull(),
  message: text("message").notNull().default(""),
  read: integer("read").notNull().default(0),
  createdAt: integer("createdAt").notNull().default(sql`extract(epoch from now())::integer`),
}, (table) => [
  index("idx_notifications_userId").on(table.userId),
  index("idx_notifications_userId_read").on(table.userId, table.read),
]);

export const webhooks = pgTable("webhooks", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: text("events").notNull().default("[]"),
  active: integer("active").notNull().default(1),
  createdAt: integer("createdAt").notNull().default(sql`extract(epoch from now())::integer`),
  updatedAt: integer("updatedAt").notNull().default(sql`extract(epoch from now())::integer`),
}, (table) => [
  index("idx_webhooks_userId").on(table.userId),
]);

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: text("id").primaryKey(),
  webhookId: text("webhookId").notNull().references(() => webhooks.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  payload: text("payload").notNull().default("{}"),
  responseStatus: integer("responseStatus"),
  responseBody: text("responseBody"),
  success: integer("success").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("lastError"),
  createdAt: integer("createdAt").notNull().default(sql`extract(epoch from now())::integer`),
  completedAt: integer("completedAt"),
}, (table) => [
  index("idx_webhook_deliveries_webhookId").on(table.webhookId),
  index("idx_webhook_deliveries_createdAt").on(table.createdAt),
]);

export const roles = pgTable("roles", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  permissions: text("permissions").notNull().default("[]"),
  is_system: integer("is_system").notNull().default(0),
  created_at: text("created_at").default(sql`now()::text`),
  updated_at: text("updated_at").default(sql`now()::text`),
});

export const userRoles = pgTable("user_roles", {
  id: serial("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  role_id: text("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  assigned_by: text("assigned_by").references(() => user.id, { onDelete: "set null" }),
  created_at: text("created_at").default(sql`now()::text`),
}, (table) => [
  index("idx_user_roles_user_id").on(table.user_id),
  index("idx_user_roles_role_id").on(table.role_id),
  uniqueIndex("user_roles_user_id_role_id_unique").on(table.user_id, table.role_id),
]);

export const waitlist = pgTable("waitlist", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  referral_code: text("referral_code").notNull().unique(),
  referred_by: text("referred_by"),
  referral_count: integer("referral_count").notNull().default(0),
  status: text("status").notNull().default("waiting"),
  created_at: text("created_at").default(sql`now()::text`),
  invited_at: text("invited_at"),
}, (table) => [
  index("idx_waitlist_email").on(table.email),
  index("idx_waitlist_status").on(table.status),
  index("idx_waitlist_referral_code").on(table.referral_code),
]);

export const inviteCodes = pgTable("invite_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  email: text("email"),
  used_by: text("used_by").references(() => user.id),
  created_by: text("created_by").notNull().references(() => user.id),
  created_at: text("created_at").default(sql`now()::text`),
  used_at: text("used_at"),
  expires_at: text("expires_at"),
}, (table) => [
  index("idx_invite_codes_code").on(table.code),
  index("idx_invite_codes_email").on(table.email),
]);

export const emailEvents = pgTable("email_events", {
  id: serial("id").primaryKey(),
  email_id: text("email_id"),
  campaign_id: text("campaign_id"),
  subscriber_email: text("subscriber_email"),
  event_type: text("event_type").notNull(),
  link_url: text("link_url"),
  metadata: text("metadata").default("{}"),
  created_at: text("created_at").default(sql`now()::text`),
}, (table) => [
  index("idx_ee_campaign_id").on(table.campaign_id),
  index("idx_ee_subscriber_email").on(table.subscriber_email),
  index("idx_ee_event_type").on(table.event_type),
]);

export const emailCampaigns = pgTable("email_campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  preview_text: text("preview_text").default(""),
  html_content: text("html_content").notNull(),
  status: text("status").notNull().default("draft"),
  audience_filter: text("audience_filter").default("{}"),
  recipient_count: integer("recipient_count").default(0),
  sent_count: integer("sent_count").default(0),
  scheduled_at: text("scheduled_at"),
  sent_at: text("sent_at"),
  resend_broadcast_id: text("resend_broadcast_id"),
  created_by: text("created_by").notNull().references(() => user.id),
  created_at: text("created_at").default(sql`now()::text`),
  updated_at: text("updated_at").default(sql`now()::text`),
}, (table) => [
  index("idx_campaigns_status").on(table.status),
  index("idx_campaigns_created_at").on(table.created_at),
]);

export const _migrations = pgTable("_migrations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  applied_at: text("applied_at").default(sql`now()::text`),
});

// ─── Instagram / Multi-Platform Analysis Tables ──────────────────────────────

export const platforms = pgTable("platforms", {
  id: serial("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  account_id: text("account_id").notNull(),
  username: text("username"),
  access_token: text("access_token"),
  refresh_token: text("refresh_token"),
  token_expires_at: text("token_expires_at"),
  created_at: text("created_at").default(sql`now()::text`),
  updated_at: text("updated_at").default(sql`now()::text`),
}, (table) => [
  uniqueIndex("platforms_user_platform_unique").on(table.user_id, table.platform),
  index("idx_platforms_user_id").on(table.user_id),
]);

export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  platform_post_id: text("platform_post_id").notNull(),
  platform: text("platform").notNull(),
  caption: text("caption"),
  media_type: text("media_type"),
  media_url: text("media_url"),
  thumbnail_url: text("thumbnail_url"),
  permalink: text("permalink"),
  published_at: text("published_at"),
  created_at: text("created_at").default(sql`now()::text`),
}, (table) => [
  uniqueIndex("posts_user_platform_post_unique").on(table.user_id, table.platform, table.platform_post_id),
  index("idx_posts_user_id").on(table.user_id),
  index("idx_posts_user_published").on(table.user_id, table.published_at),
]);

export const postAnalysis = pgTable("post_analysis", {
  id: serial("id").primaryKey(),
  post_id: integer("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  setting: text("setting"),
  lighting: text("lighting"),
  face_visible: boolean("face_visible"),
  text_overlay: boolean("text_overlay"),
  visual_style: text("visual_style"),
  caption_length: integer("caption_length"),
  hook_type: text("hook_type"),
  cta_present: boolean("cta_present"),
  cta_type: text("cta_type"),
  caption_tone: text("caption_tone"),
  emoji_count: integer("emoji_count"),
  hashtag_count: integer("hashtag_count"),
  transcript: text("transcript"),
  spoken_hook: text("spoken_hook"),
  key_frame_analysis: text("key_frame_analysis"),
  raw_analysis: text("raw_analysis"),
  analyzed_at: text("analyzed_at").default(sql`now()::text`),
}, (table) => [
  uniqueIndex("post_analysis_post_unique").on(table.post_id),
  index("idx_post_analysis_user_id").on(table.user_id),
]);

export const postInsights = pgTable("post_insights", {
  id: serial("id").primaryKey(),
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
  created_at: text("created_at").default(sql`now()::text`),
}, (table) => [
  uniqueIndex("post_insights_post_date_unique").on(table.post_id, table.snapshot_date),
  index("idx_post_insights_user_id").on(table.user_id),
]);

export const accountSnapshots = pgTable("account_snapshots", {
  id: serial("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  snapshot_date: text("snapshot_date").notNull(),
  follower_count: integer("follower_count"),
  media_count: integer("media_count"),
  reach: integer("reach"),
  impressions: integer("impressions"),
  profile_views: integer("profile_views"),
  created_at: text("created_at").default(sql`now()::text`),
}, (table) => [
  uniqueIndex("account_snapshots_user_platform_date_unique").on(table.user_id, table.platform, table.snapshot_date),
  index("idx_account_snapshots_user_id").on(table.user_id),
]);

export const demographics = pgTable("demographics", {
  id: serial("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  snapshot_date: text("snapshot_date").notNull(),
  metric: text("metric").notNull(),
  key: text("key").notNull(),
  value: real("value").notNull(),
  created_at: text("created_at").default(sql`now()::text`),
}, (table) => [
  uniqueIndex("demographics_unique").on(table.user_id, table.platform, table.snapshot_date, table.metric, table.key),
  index("idx_demographics_user_id").on(table.user_id),
]);

export const contentInsights = pgTable("content_insights", {
  id: serial("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  report_json: text("report_json").notNull(),
  posts_analyzed: integer("posts_analyzed").notNull(),
  created_at: text("created_at").default(sql`now()::text`),
}, (table) => [
  index("idx_content_insights_user_id").on(table.user_id),
]);

// ─── Coomander — AI ops agent infrastructure (#151) ──────────────────────────
// Mirrors schema.sqlite.ts. See migrations/016_coomander_infra.sql.

export const coomanderSettings = pgTable("coomander_settings", {
  user_id: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  nag_frequency: text("nag_frequency").notNull().default("tight"),
  persona_mode: text("persona_mode").notNull().default("light_companion"),
  ping_times_json: text("ping_times_json"),
  companion_consent_at: integer("companion_consent_at"),
  created_at: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
  updated_at: integer("updated_at").notNull().default(sql`extract(epoch from now())::integer`),
});

// RETENTION POLICY: NO TTL, NO deletion sweep, EVER. Long-term companion-memory
// substrate. Deletion is a manual operator action only, never code.
export const coomanderMessageLog = pgTable("coomander_message_log", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(),
  telegram_update_id: integer("telegram_update_id"),
  text: text("text").notNull(),
  tool_call_json: text("tool_call_json"),
  persona_mode: text("persona_mode").notNull().default("light_companion"),
  created_at: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
}, (table) => [
  index("idx_coomander_message_log_user_created").on(table.user_id, table.created_at),
]);

export const coomanderUsage = pgTable("coomander_usage", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  slot_or_inbound: text("slot_or_inbound").notNull(),
  input_tokens: integer("input_tokens").notNull().default(0),
  output_tokens: integer("output_tokens").notNull().default(0),
  model: text("model").notNull(),
  created_at: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
}, (table) => [
  index("idx_coomander_usage_user_id").on(table.user_id),
]);

export const coomanderDayState = pgTable("coomander_day_state", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  morning_ping_sent_at: integer("morning_ping_sent_at"),
  midday_ping_sent_at: integer("midday_ping_sent_at"),
  evening_recap_at: integer("evening_recap_at"),
  day_quality: text("day_quality"),
}, (table) => [
  uniqueIndex("coomander_day_state_user_date_unique").on(table.user_id, table.date),
  index("idx_coomander_day_state_user_id").on(table.user_id),
]);

export const coomanderDedup = pgTable("coomander_dedup", {
  telegram_update_id: integer("telegram_update_id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  processed_at: integer("processed_at").notNull().default(sql`extract(epoch from now())::integer`),
});

// ─── Coomander ops domain model (#152) ───────────────────────────────────────
// Mirrors schema.sqlite.ts. See migrations/017_coomander_domain.sql.

export const cadencePillars = pgTable("cadence_pillars", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").$type<"content" | "wall" | "procurement" | "engagement" | "admin">().notNull(),
  display_order: integer("display_order").notNull().default(0),
  archived_at: integer("archived_at"),
  created_at: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
  updated_at: integer("updated_at").notNull().default(sql`extract(epoch from now())::integer`),
}, (table) => [
  index("idx_cadence_pillars_user_id").on(table.user_id),
]);

export const cadenceBeats = pgTable("cadence_beats", {
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
  archived_at: integer("archived_at"),
  notes: text("notes"),
  created_at: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
  updated_at: integer("updated_at").notNull().default(sql`extract(epoch from now())::integer`),
}, (table) => [
  index("idx_cadence_beats_user_id").on(table.user_id),
  index("idx_cadence_beats_pillar_id").on(table.pillar_id),
]);

export type ContentStateValue =
  | "drafted" | "shot" | "approved" | "uploaded_to_edit" | "edited" | "scheduled" | "shipped";

export const contentStates = pgTable("content_states", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  beat_id: text("beat_id").references(() => cadenceBeats.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  current_state: text("current_state").$type<ContentStateValue>().notNull().default("drafted"),
  state_history_json: text("state_history_json").notNull().default("[]"),
  drive_url: text("drive_url"),
  edited_url: text("edited_url"),
  notes: text("notes"),
  created_at: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
  updated_at: integer("updated_at").notNull().default(sql`extract(epoch from now())::integer`),
}, (table) => [
  index("idx_content_states_user_id").on(table.user_id),
  index("idx_content_states_user_state").on(table.user_id, table.current_state),
  index("idx_content_states_beat_id").on(table.beat_id),
]);

export const drops = pgTable("drops", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  beat_id: text("beat_id").notNull().references(() => cadenceBeats.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"shipped" | "purchased" | "completed" | "captured">().notNull(),
  source: text("source").$type<"auto_ig" | "auto_of" | "telegram" | "manual_ui">().notNull(),
  platform: text("platform").$type<"ig" | "tiktok" | "fb" | "snap" | "of" | null>(),
  external_ref: text("external_ref"),
  content_state_id: text("content_state_id").references(() => contentStates.id, { onDelete: "set null" }),
  payload_json: text("payload_json").notNull().default("{}"),
  dropped_at: integer("dropped_at").notNull().default(sql`extract(epoch from now())::integer`),
  created_at: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
}, (table) => [
  index("idx_drops_user_id").on(table.user_id),
  index("idx_drops_user_beat_dropped").on(table.user_id, table.beat_id, table.dropped_at),
]);

export const procurementItems = pgTable("procurement_items", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  beat_id: text("beat_id").references(() => cadenceBeats.id, { onDelete: "set null" }),
  category: text("category").$type<"shoot_prep" | "business_admin">().notNull(),
  label: text("label").notNull(),
  status: text("status").$type<"needed" | "ordered" | "received" | "canceled">().notNull().default("needed"),
  needed_by: text("needed_by"),
  estimated_cost_cents: integer("estimated_cost_cents"),
  actual_cost_cents: integer("actual_cost_cents"),
  notes: text("notes"),
  created_at: integer("created_at").notNull().default(sql`extract(epoch from now())::integer`),
  updated_at: integer("updated_at").notNull().default(sql`extract(epoch from now())::integer`),
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
