import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { newsletterSubscribers } from "@/lib/schema";
import {
  parseTags,
  serializeTags,
  parseAudienceFilter,
  serializeAudienceFilter,
  subscriberMatchesFilter,
  describeAudience,
  resolveAudience,
  countAudience,
  listTagsWithCounts,
  ALL_AUDIENCE,
  type AudienceFilter,
} from "@/lib/audiences";

// ─── Audience resolution for email campaigns (lib/audiences.ts, #222) ──────
//
// SPEC (from the module docblock + #222 acceptance criteria — "basic
// Mailchimp parity"):
//   - A campaign's audience is EITHER "all active subscribers" OR a
//     tag-based segment matching ANY or ALL of a tag list.
//   - Resolution NEVER includes a subscriber whose status is not 'active'
//     (unsubscribed/bounced excluded), regardless of tags — this is an
//     explicit invariant in the module docblock.
//   - parseTags / parseAudienceFilter are TOLERANT: malformed/legacy/null
//     input never throws and degrades to a safe default (empty tag list /
//     {kind:"all"}), so a campaign never silently resolves to zero
//     recipients from bad stored JSON.
//
// Written against the spec/public interface, not the implementation — the
// author did not read resolveAudience's internals before writing the
// DB-integration assertions below.

// A random namespace per test run so tag-count assertions in listTagsWithCounts
// can never collide with leftover data from a prior/parallel run.
const NS = Math.random().toString(36).slice(2, 8);
const tag = (name: string) => `${NS}-${name}`;

function uniqueEmail(label: string): string {
  return `${NS}-${label}-${Math.random().toString(36).slice(2)}@example.com`;
}

const seededEmails: string[] = [];

async function seedSubscriber(opts: {
  label: string;
  status?: string;
  tags?: string[];
}): Promise<string> {
  const email = uniqueEmail(opts.label);
  await getDb()
    .insert(newsletterSubscribers)
    .values({
      email,
      status: opts.status ?? "active",
      tags: JSON.stringify(opts.tags ?? []),
    });
  seededEmails.push(email);
  return email;
}

afterEach(async () => {
  const db = getDb();
  for (const email of seededEmails.splice(0)) {
    await db.delete(newsletterSubscribers).where(eq(newsletterSubscribers.email, email));
  }
});

// ── parseTags ────────────────────────────────────────────────────────────

describe("parseTags", () => {
  it("parses a JSON array of strings", () => {
    expect(parseTags('["vip","beta"]')).toEqual(["vip", "beta"]);
  });

  it("trims whitespace and drops empty strings", () => {
    expect(parseTags('[" vip ", "", "  "]')).toEqual(["vip"]);
  });

  it("de-duplicates tags", () => {
    expect(parseTags('["vip","vip","beta"]')).toEqual(["vip", "beta"]);
  });

  it("returns [] for null/undefined", () => {
    expect(parseTags(null)).toEqual([]);
    expect(parseTags(undefined)).toEqual([]);
  });

  it("returns [] for an empty string", () => {
    expect(parseTags("")).toEqual([]);
  });

  it("returns [] for malformed JSON", () => {
    expect(parseTags("{not valid json")).toEqual([]);
  });

  it("returns [] when the parsed value is not an array", () => {
    expect(parseTags('{"kind":"tags"}')).toEqual([]);
    expect(parseTags('"just a string"')).toEqual([]);
  });

  it("filters out non-string array elements", () => {
    expect(parseTags('["vip", 42, null, "beta"]')).toEqual(["vip", "beta"]);
  });
});

// ── serializeTags ────────────────────────────────────────────────────────

describe("serializeTags", () => {
  it("serializes a tag list to a JSON array string", () => {
    expect(JSON.parse(serializeTags(["vip", "beta"]))).toEqual(["vip", "beta"]);
  });

  it("trims, drops empty, and de-duplicates before serializing", () => {
    expect(JSON.parse(serializeTags([" vip ", "vip", "", "beta"]))).toEqual([
      "vip",
      "beta",
    ]);
  });

  it("serializes an empty list to '[]'", () => {
    expect(serializeTags([])).toBe("[]");
  });
});

// ── parseAudienceFilter ──────────────────────────────────────────────────

describe("parseAudienceFilter", () => {
  it("returns ALL_AUDIENCE for null/undefined/empty string", () => {
    expect(parseAudienceFilter(null)).toEqual(ALL_AUDIENCE);
    expect(parseAudienceFilter(undefined)).toEqual(ALL_AUDIENCE);
    expect(parseAudienceFilter("")).toEqual(ALL_AUDIENCE);
  });

  it("returns ALL_AUDIENCE for malformed JSON", () => {
    expect(parseAudienceFilter("{not json")).toEqual(ALL_AUDIENCE);
  });

  it("returns ALL_AUDIENCE for legacy '{}' (no kind)", () => {
    expect(parseAudienceFilter("{}")).toEqual(ALL_AUDIENCE);
  });

  it("returns ALL_AUDIENCE for an explicit {kind:'all'}", () => {
    expect(parseAudienceFilter('{"kind":"all"}')).toEqual(ALL_AUDIENCE);
  });

  it("returns ALL_AUDIENCE when the parsed value is not an object (e.g. an array or number)", () => {
    expect(parseAudienceFilter("[1,2,3]")).toEqual(ALL_AUDIENCE);
    expect(parseAudienceFilter("42")).toEqual(ALL_AUDIENCE);
  });

  it("parses a tags filter with explicit match:'all'", () => {
    expect(parseAudienceFilter('{"kind":"tags","tags":["a","b"],"match":"all"}')).toEqual({
      kind: "tags",
      tags: ["a", "b"],
      match: "all",
    });
  });

  it("defaults match to 'any' when unspecified", () => {
    expect(parseAudienceFilter('{"kind":"tags","tags":["a"]}')).toEqual({
      kind: "tags",
      tags: ["a"],
      match: "any",
    });
  });

  it("normalizes any non-'all' match value to 'any'", () => {
    expect(parseAudienceFilter('{"kind":"tags","tags":["a"],"match":"bogus"}')).toEqual({
      kind: "tags",
      tags: ["a"],
      match: "any",
    });
  });

  it("falls back to ALL_AUDIENCE for a tags filter with an empty tag list", () => {
    // A tag segment with no tags is meaningless — must not silently resolve
    // to zero recipients.
    expect(parseAudienceFilter('{"kind":"tags","tags":[],"match":"any"}')).toEqual(
      ALL_AUDIENCE,
    );
  });

  it("trims and de-duplicates tags within the filter", () => {
    expect(
      parseAudienceFilter('{"kind":"tags","tags":[" a ","a","b"],"match":"any"}'),
    ).toEqual({ kind: "tags", tags: ["a", "b"], match: "any" });
  });

  it("drops non-string entries from the tags array", () => {
    expect(
      parseAudienceFilter('{"kind":"tags","tags":["a",42,null],"match":"any"}'),
    ).toEqual({ kind: "tags", tags: ["a"], match: "any" });
  });
});

// ── serializeAudienceFilter ──────────────────────────────────────────────

describe("serializeAudienceFilter", () => {
  it("serializes ALL_AUDIENCE to {kind:'all'}", () => {
    expect(JSON.parse(serializeAudienceFilter(ALL_AUDIENCE))).toEqual({ kind: "all" });
  });

  it("round-trips a tags filter through parseAudienceFilter", () => {
    const filter: AudienceFilter = { kind: "tags", tags: ["vip", "beta"], match: "all" };
    expect(parseAudienceFilter(serializeAudienceFilter(filter))).toEqual(filter);
  });
});

// ── subscriberMatchesFilter ──────────────────────────────────────────────

describe("subscriberMatchesFilter", () => {
  it("matches everyone for ALL_AUDIENCE, even a subscriber with no tags", () => {
    expect(subscriberMatchesFilter([], ALL_AUDIENCE)).toBe(true);
    expect(subscriberMatchesFilter(["vip"], ALL_AUDIENCE)).toBe(true);
  });

  describe("match:'any'", () => {
    const filter: AudienceFilter = { kind: "tags", tags: ["vip", "beta"], match: "any" };

    it("matches a subscriber with at least one of the filter tags", () => {
      expect(subscriberMatchesFilter(["vip"], filter)).toBe(true);
      expect(subscriberMatchesFilter(["beta", "other"], filter)).toBe(true);
    });

    it("does not match a subscriber with none of the filter tags", () => {
      expect(subscriberMatchesFilter(["other"], filter)).toBe(false);
      expect(subscriberMatchesFilter([], filter)).toBe(false);
    });
  });

  describe("match:'all'", () => {
    const filter: AudienceFilter = { kind: "tags", tags: ["vip", "beta"], match: "all" };

    it("matches a subscriber that has every filter tag", () => {
      expect(subscriberMatchesFilter(["vip", "beta", "extra"], filter)).toBe(true);
    });

    it("does not match a subscriber missing even one filter tag", () => {
      expect(subscriberMatchesFilter(["vip"], filter)).toBe(false);
      expect(subscriberMatchesFilter([], filter)).toBe(false);
    });
  });
});

// ── describeAudience ──────────────────────────────────────────────────────

describe("describeAudience", () => {
  it("describes ALL_AUDIENCE", () => {
    expect(describeAudience(ALL_AUDIENCE)).toBe("All active subscribers");
  });

  it("describes an 'any' tags filter", () => {
    expect(
      describeAudience({ kind: "tags", tags: ["vip", "beta"], match: "any" }),
    ).toBe("Subscribers tagged any of: vip, beta");
  });

  it("describes an 'all' tags filter", () => {
    expect(
      describeAudience({ kind: "tags", tags: ["vip", "beta"], match: "all" }),
    ).toBe("Subscribers tagged all of: vip, beta");
  });
});

// ── resolveAudience / countAudience (DB-integration, active-only) ────────

describe("resolveAudience — DB integration", () => {
  it("ALL_AUDIENCE resolves to active subscribers and excludes unsubscribed ones", async () => {
    const active = await seedSubscriber({ label: "active" });
    const unsubscribed = await seedSubscriber({
      label: "unsub",
      status: "unsubscribed",
    });

    const emails = await resolveAudience(ALL_AUDIENCE);

    expect(emails).toContain(active);
    expect(emails).not.toContain(unsubscribed);
  });

  it("'any' tag match includes a subscriber with at least one matching tag", async () => {
    const vip = await seedSubscriber({ label: "vip", tags: [tag("vip")] });
    const beta = await seedSubscriber({ label: "beta", tags: [tag("beta")] });
    const none = await seedSubscriber({ label: "none", tags: [tag("other")] });

    const filter: AudienceFilter = {
      kind: "tags",
      tags: [tag("vip"), tag("beta")],
      match: "any",
    };
    const emails = await resolveAudience(filter);

    expect(emails).toContain(vip);
    expect(emails).toContain(beta);
    expect(emails).not.toContain(none);
  });

  it("'all' tag match requires every listed tag, excluding a partial match", async () => {
    const both = await seedSubscriber({
      label: "both",
      tags: [tag("vip"), tag("beta")],
    });
    const partial = await seedSubscriber({ label: "partial", tags: [tag("vip")] });

    const filter: AudienceFilter = {
      kind: "tags",
      tags: [tag("vip"), tag("beta")],
      match: "all",
    };
    const emails = await resolveAudience(filter);

    expect(emails).toContain(both);
    expect(emails).not.toContain(partial);
  });

  it("excludes an unsubscribed subscriber even when their tags match the filter", async () => {
    const unsub = await seedSubscriber({
      label: "unsub-vip",
      status: "unsubscribed",
      tags: [tag("vip")],
    });

    const filter: AudienceFilter = { kind: "tags", tags: [tag("vip")], match: "any" };
    const emails = await resolveAudience(filter);

    expect(emails).not.toContain(unsub);
  });

  it("countAudience returns the length of the resolved audience", async () => {
    await seedSubscriber({ label: "a", tags: [tag("counted")] });
    await seedSubscriber({ label: "b", tags: [tag("counted")] });
    await seedSubscriber({ label: "c", tags: [tag("not-counted")] });

    const filter: AudienceFilter = { kind: "tags", tags: [tag("counted")], match: "any" };
    const [emails, count] = await Promise.all([
      resolveAudience(filter),
      countAudience(filter),
    ]);

    expect(count).toBe(emails.length);
    expect(count).toBe(2);
  });
});

// ── listTagsWithCounts ────────────────────────────────────────────────────

describe("listTagsWithCounts", () => {
  it("counts distinct tags across active subscribers only, sorted by count desc then name", async () => {
    await seedSubscriber({ label: "1", tags: [tag("popular")] });
    await seedSubscriber({ label: "2", tags: [tag("popular")] });
    await seedSubscriber({ label: "3", tags: [tag("rare")] });
    // Unsubscribed — must not contribute to the count for `popular`.
    await seedSubscriber({
      label: "4",
      status: "unsubscribed",
      tags: [tag("popular")],
    });

    const counts = await listTagsWithCounts();
    const popular = counts.find((c) => c.tag === tag("popular"));
    const rare = counts.find((c) => c.tag === tag("rare"));

    expect(popular?.count).toBe(2);
    expect(rare?.count).toBe(1);

    // Sort order: popular (count 2) must come before rare (count 1).
    const popularIdx = counts.findIndex((c) => c.tag === tag("popular"));
    const rareIdx = counts.findIndex((c) => c.tag === tag("rare"));
    expect(popularIdx).toBeLessThan(rareIdx);
  });
});
