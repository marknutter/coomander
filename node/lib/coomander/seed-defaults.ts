/**
 * Coomander v1 playbook defaults (#153).
 *
 * `seedOpsDefaults(userId)` creates the validated OF playbook (pillars + beats)
 * for a brand new ops account. Every seeded row carries source='v1_default' so
 * defaults are distinguishable from the creator's customizations. Idempotent: it
 * no-ops if the user has already been seeded (settings.ops_seeded_at set) or
 * already has pillars.
 *
 * Procurement "beats" (restock, costume calendar, invoices, upgrades) are modeled
 * as rolling `window` beats since the cadence enum has no `monthly` kind; the
 * exact monthly math is a V2 refinement. The Day 1-6 ramp lives in ramp.ts and
 * is applied at read time, not baked into the seeded weekly targets.
 */

import crypto from "crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { cadencePillars, cadenceBeats, coomanderSettings } from "@/lib/schema";
import { userToday } from "./settings";

const SOURCE = "v1_default";

function plusDays(date: string, n: number): string {
  return new Date(Date.parse(date + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}

interface SeedBeat {
  name: string;
  cadenceKind: "daily" | "weekly" | "window" | "daily_vlog_buffer";
  targetCount: number;
  bufferGoalDays?: number | null;
  windowDays?: number; // for window beats: window_end = today + windowDays
  priority: "low" | "med" | "high";
  platformSpecific?: "ig" | "tiktok" | "fb" | "snap" | "of" | null;
  subtype?: string | null;
  notes?: string | null;
}

interface SeedPillar {
  name: string;
  kind: "content" | "wall" | "procurement" | "engagement" | "admin";
  beats: SeedBeat[];
}

/** The validated OF playbook (docs/strategy/coomander-direction.md § Cadence model). */
export const V1_PLAYBOOK: SeedPillar[] = [
  {
    name: "Reels",
    kind: "content",
    beats: [
      { name: "Normal reel", cadenceKind: "weekly", targetCount: 21, priority: "high", platformSpecific: null, subtype: "normal_reel", notes: "3/day. Cross-posts to IG, TikTok, FB." },
      { name: "Trial reel", cadenceKind: "weekly", targetCount: 21, priority: "high", platformSpecific: "ig", subtype: "trial_reel", notes: "3/day. IG-only mechanic (shown to non-followers)." },
    ],
  },
  {
    name: "OF Wall",
    kind: "wall",
    beats: [
      { name: "Daily-vlog wall capture", cadenceKind: "daily_vlog_buffer", targetCount: 5, bufferGoalDays: 3, priority: "med", platformSpecific: "of", notes: "Passive daily capture, 5-10 pieces. Stay 3+ days ahead." },
      { name: "Themed batch", cadenceKind: "window", targetCount: 1, windowDays: 30, priority: "low", platformSpecific: "of", notes: "Costume / cosplay / location shoots." },
    ],
  },
  {
    name: "Live Streams",
    kind: "engagement",
    beats: [
      { name: "IG Live", cadenceKind: "weekly", targetCount: 1, priority: "med", platformSpecific: "ig", notes: "Top-of-funnel intent capture." },
    ],
  },
  {
    name: "PPV Sends",
    kind: "engagement",
    beats: [
      { name: "Mass PPV", cadenceKind: "weekly", targetCount: 1, priority: "med", platformSpecific: "of", notes: "Revenue ladder." },
      { name: "Welcome PPV", cadenceKind: "window", targetCount: 1, windowDays: 2, priority: "low", platformSpecific: "of", notes: "First-48h pattern per new sub. PROMPT ONLY, never auto-sent." },
    ],
  },
  {
    name: "Procurement (shoot prep)",
    kind: "procurement",
    beats: [
      { name: "Recurring restock - makeup", cadenceKind: "window", targetCount: 1, windowDays: 30, priority: "low", subtype: "shoot_prep", notes: "Monthly restock." },
      { name: "Themed costume calendar", cadenceKind: "window", targetCount: 1, windowDays: 30, priority: "low", subtype: "shoot_prep", notes: "Per upcoming theme." },
    ],
  },
  {
    name: "Procurement (business admin)",
    kind: "admin",
    beats: [
      { name: "Monthly invoice payment", cadenceKind: "window", targetCount: 1, windowDays: 30, priority: "low", subtype: "business_admin", notes: "If working with an agency." },
      { name: "Phone / lighting upgrades", cadenceKind: "window", targetCount: 1, windowDays: 30, priority: "low", subtype: "business_admin", notes: "As needed." },
    ],
  },
];

export interface SeedResult {
  seeded: boolean;
  reason?: string;
  pillars?: number;
  beats?: number;
}

async function settingsRow(userId: string) {
  const db = getDb();
  const rows = await db.select().from(coomanderSettings).where(eq(coomanderSettings.user_id, userId)).limit(1);
  return rows[0] as { ops_seeded_at?: number | null } | undefined;
}

/**
 * Seed the v1 playbook for a user. Idempotent: returns {seeded:false} if the
 * user was already seeded or already has pillars.
 */
export async function seedOpsDefaults(userId: string): Promise<SeedResult> {
  const db = getDb();

  const settings = await settingsRow(userId);
  if (settings?.ops_seeded_at) return { seeded: false, reason: "already seeded" };

  const existing = await db.select({ id: cadencePillars.id }).from(cadencePillars).where(eq(cadencePillars.user_id, userId)).limit(1);
  if (existing.length > 0) return { seeded: false, reason: "user already has pillars" };

  const now = Math.floor(Date.now() / 1000);
  const today = await userToday(userId);
  let pillarCount = 0;
  let beatCount = 0;

  for (let p = 0; p < V1_PLAYBOOK.length; p++) {
    const sp = V1_PLAYBOOK[p];
    const pillarId = crypto.randomUUID();
    await db.insert(cadencePillars).values({
      id: pillarId,
      user_id: userId,
      name: sp.name,
      kind: sp.kind,
      display_order: p,
      source: SOURCE,
      created_at: now,
      updated_at: now,
    });
    pillarCount++;

    for (const sb of sp.beats) {
      await db.insert(cadenceBeats).values({
        id: crypto.randomUUID(),
        user_id: userId,
        pillar_id: pillarId,
        name: sb.name,
        cadence_kind: sb.cadenceKind,
        target_count: sb.targetCount,
        buffer_goal_days: sb.bufferGoalDays ?? null,
        window_start: sb.cadenceKind === "window" ? today : null,
        window_end: sb.cadenceKind === "window" ? plusDays(today, sb.windowDays ?? 30) : null,
        priority: sb.priority,
        platform_specific: sb.platformSpecific ?? null,
        subtype: sb.subtype ?? null,
        active: 1,
        source: SOURCE,
        notes: sb.notes ?? null,
        created_at: now,
        updated_at: now,
      });
      beatCount++;
    }
  }

  // Stamp ops_seeded_at (upsert the settings row).
  if (settings) {
    await db.update(coomanderSettings).set({ ops_seeded_at: now, updated_at: now }).where(eq(coomanderSettings.user_id, userId));
  } else {
    await db.insert(coomanderSettings).values({
      user_id: userId,
      nag_frequency: "tight",
      persona_mode: "light_companion",
      ops_seeded_at: now,
      created_at: now,
      updated_at: now,
    });
  }

  return { seeded: true, pillars: pillarCount, beats: beatCount };
}
