/**
 * Schema barrel — conditionally re-exports from the correct dialect schema.
 *
 * Consumer imports stay unchanged: `import { user, session } from "@/lib/schema"`.
 *
 * TypeScript types are from the SQLite schema (the default/primary dialect).
 * When running against PG, the actual objects carry PG-specific metadata, but
 * the runtime column/table names are identical — Drizzle uses these at runtime
 * to generate dialect-correct SQL via the dialect-specific DB instance.
 */

import * as sqliteSchema from "./schema.sqlite";
import * as pgSchema from "./schema.pg";
import { getDialect } from "./db-dialect";

// Static ES imports let Vitest and Next.js both resolve the modules
// correctly. The unused dialect's module is tree-shaken in the Next.js
// build; in tests it's loaded but never invoked.
const mod: typeof sqliteSchema = (getDialect() === "pg"
  ? (pgSchema as unknown as typeof sqliteSchema)
  : sqliteSchema);

export const user = mod.user;
export const session = mod.session;
export const account = mod.account;
export const verification = mod.verification;
export const twoFactor = mod.twoFactor;
export const adminLogs = mod.adminLogs;
export const planOverrides = mod.planOverrides;
export const newsletterSubscribers = mod.newsletterSubscribers;
export const blogPosts = mod.blogPosts;
export const jobs = mod.jobs;
export const files = mod.files;
export const notifications = mod.notifications;
export const webhooks = mod.webhooks;
export const webhookDeliveries = mod.webhookDeliveries;
export const roles = mod.roles;
export const userRoles = mod.userRoles;
export const waitlist = mod.waitlist;
export const inviteCodes = mod.inviteCodes;
export const emailEvents = mod.emailEvents;
export const emailCampaigns = mod.emailCampaigns;
export const campaignSendBatches = mod.campaignSendBatches;
export const _migrations = mod._migrations;
export const platforms = mod.platforms;
export const posts = mod.posts;
export const postAnalysis = mod.postAnalysis;
export const postInsights = mod.postInsights;
export const accountSnapshots = mod.accountSnapshots;
export const demographics = mod.demographics;
export const contentInsights = mod.contentInsights;
export const coomanderSettings = mod.coomanderSettings;
export const coomanderLinkCodes = mod.coomanderLinkCodes;
export const coomanderMessageLog = mod.coomanderMessageLog;
export const coomanderUsage = mod.coomanderUsage;
export const coomanderDayState = mod.coomanderDayState;
export const coomanderDedup = mod.coomanderDedup;
export const cadencePillars = mod.cadencePillars;
export const cadenceBeats = mod.cadenceBeats;
export const contentStates = mod.contentStates;
export const drops = mod.drops;
export const procurementItems = mod.procurementItems;
export const weeklyReviews = mod.weeklyReviews;
export const appSettings = mod.appSettings;
export const providerKeys = mod.providerKeys;

export type {
  Platform,
  NewPlatform,
  Post,
  NewPost,
  PostAnalysis,
  NewPostAnalysis,
  PostInsight,
  NewPostInsight,
  AccountSnapshot,
  NewAccountSnapshot,
  Demographic,
  NewDemographic,
  ContentInsight,
  NewContentInsight,
  CoomanderSettings,
  NewCoomanderSettings,
  CoomanderMessageLog,
  NewCoomanderMessageLog,
  CoomanderUsage,
  NewCoomanderUsage,
  CoomanderDayState,
  NewCoomanderDayState,
  CoomanderDedup,
  NewCoomanderDedup,
  ContentStateValue,
  CadencePillar,
  NewCadencePillar,
  CadenceBeat,
  NewCadenceBeat,
  ContentState,
  NewContentState,
  Drop,
  NewDrop,
  ProcurementItem,
  NewProcurementItem,
  WeeklyReviewRow,
  NewWeeklyReviewRow,
  AppSetting,
  NewAppSetting,
  ProviderKeyRow,
  NewProviderKeyRow,
} from "./schema.sqlite";
