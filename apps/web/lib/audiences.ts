/**
 * Audience resolution for email campaigns (Coomander sync of AppSeed #596,
 * epic #595 — issue #222).
 *
 * "Basic Mailchimp parity" models recipient lists/segments as TAGS on
 * newsletter_subscribers (the existing `tags` JSON-array column). A named list
 * is simply a tag; a segment is a set of tags matched ANY or ALL. A campaign
 * stores its target as the `audience_filter` JSON column, which this module
 * parses and resolves into a concrete recipient email list at send time.
 *
 * Invariant: an audience NEVER includes a recipient whose subscription is not
 * `active` (unsubscribed/bounced recipients are excluded), regardless of tags.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { newsletterSubscribers } from "@/lib/schema";

export type AudienceFilter =
  | { kind: "all" }
  | { kind: "tags"; tags: string[]; match: "any" | "all" };

export const ALL_AUDIENCE: AudienceFilter = { kind: "all" };

/**
 * Parse the persisted `tags` column (a JSON string array) into a string[].
 * Tolerant of null/empty/legacy values — never throws, always returns an array
 * of trimmed, non-empty, de-duplicated tag strings.
 */
export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out = new Set<string>();
  for (const t of parsed) {
    if (typeof t === "string") {
      const trimmed = t.trim();
      if (trimmed) out.add(trimmed);
    }
  }
  return [...out];
}

/** Serialize a tag list back to the canonical JSON-array storage form. */
export function serializeTags(tags: string[]): string {
  const out = new Set<string>();
  for (const t of tags) {
    if (typeof t === "string") {
      const trimmed = t.trim();
      if (trimmed) out.add(trimmed);
    }
  }
  return JSON.stringify([...out]);
}

/**
 * Parse a campaign's `audience_filter` column into a validated AudienceFilter.
 * Defaults to {kind:"all"} for null/empty/legacy/"{}"/malformed values, so a
 * campaign with no explicit audience behaves exactly like the historical
 * "blast all active subscribers" path.
 */
export function parseAudienceFilter(raw: string | null | undefined): AudienceFilter {
  if (!raw) return ALL_AUDIENCE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return ALL_AUDIENCE;
  }
  if (!parsed || typeof parsed !== "object") return ALL_AUDIENCE;
  const obj = parsed as Record<string, unknown>;

  // Legacy / empty objects ("{}") and explicit "all" → everyone active.
  if (!obj.kind || obj.kind === "all") return ALL_AUDIENCE;

  if (obj.kind === "tags") {
    const tags = Array.isArray(obj.tags)
      ? obj.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim())
      : [];
    // A tag segment with no tags is meaningless — treat as "all" so we never
    // silently resolve to zero recipients from a malformed filter.
    if (tags.length === 0) return ALL_AUDIENCE;
    const match = obj.match === "all" ? "all" : "any";
    return { kind: "tags", tags: [...new Set(tags)], match };
  }

  return ALL_AUDIENCE;
}

/** Serialize an AudienceFilter for storage in `audience_filter`. */
export function serializeAudienceFilter(filter: AudienceFilter): string {
  if (filter.kind === "all") return JSON.stringify({ kind: "all" });
  return JSON.stringify({ kind: "tags", tags: filter.tags, match: filter.match });
}

/** Does a subscriber's tag set satisfy the filter? (pure, unit-testable) */
export function subscriberMatchesFilter(
  subscriberTags: string[],
  filter: AudienceFilter,
): boolean {
  if (filter.kind === "all") return true;
  const have = new Set(subscriberTags);
  if (filter.match === "all") return filter.tags.every((t) => have.has(t));
  return filter.tags.some((t) => have.has(t));
}

/** A human-readable one-line description of an audience, for admin UIs/logs. */
export function describeAudience(filter: AudienceFilter): string {
  if (filter.kind === "all") return "All active subscribers";
  const verb = filter.match === "all" ? "all of" : "any of";
  return `Subscribers tagged ${verb}: ${filter.tags.join(", ")}`;
}

/**
 * Resolve a filter to the concrete list of recipient emails. Always scoped to
 * status='active' subscribers (never sends to unsubscribed/bounced), then
 * narrowed by the tag predicate in JS (tags are stored as a JSON blob, so
 * matching can't be pushed into portable SQL across SQLite/D1/PG).
 */
export async function resolveAudience(filter: AudienceFilter): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ email: newsletterSubscribers.email, tags: newsletterSubscribers.tags })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.status, "active"))
    .all();

  if (filter.kind === "all") {
    return rows.map((r) => r.email);
  }

  return rows
    .filter((r) => subscriberMatchesFilter(parseTags(r.tags), filter))
    .map((r) => r.email);
}

/** Count of recipients an audience resolves to (active-only, tag-narrowed). */
export async function countAudience(filter: AudienceFilter): Promise<number> {
  const emails = await resolveAudience(filter);
  return emails.length;
}

/**
 * Distinct tags across ACTIVE subscribers with their member counts — powers the
 * audience picker and the subscribers admin. Sorted by count desc, then name.
 */
export async function listTagsWithCounts(): Promise<{ tag: string; count: number }[]> {
  const db = getDb();
  const rows = await db
    .select({ tags: newsletterSubscribers.tags })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.status, "active"))
    .all();

  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const t of parseTags(r.tags)) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
