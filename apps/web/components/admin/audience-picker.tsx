"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "@/lib/use-toast";
import { cn } from "@/lib/cn";

/**
 * Mirrors `AudienceFilter` from `@/lib/audiences` (#596/#222). Duplicated here
 * (rather than imported) because `lib/audiences.ts` pulls in `getDb()` /
 * better-sqlite3, which cannot be bundled into a client component.
 */
export type AudienceFilter =
  | { kind: "all" }
  | { kind: "tags"; tags: string[]; match: "any" | "all" };

export const ALL_AUDIENCE: AudienceFilter = { kind: "all" };

/**
 * Client-side mirror of `parseAudienceFilter` in `@/lib/audiences` — parses
 * a campaign's persisted `audience_filter` JSON string into a typed filter.
 * Defaults to "all" for null/empty/legacy/malformed values, same as the
 * server-side resolver.
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

  if (!obj.kind || obj.kind === "all") return ALL_AUDIENCE;

  if (obj.kind === "tags") {
    const tags = Array.isArray(obj.tags)
      ? obj.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim())
      : [];
    if (tags.length === 0) return ALL_AUDIENCE;
    const match = obj.match === "all" ? "all" : "any";
    return { kind: "tags", tags: [...new Set(tags)], match };
  }

  return ALL_AUDIENCE;
}

interface TagCount {
  tag: string;
  count: number;
}

export interface AudiencePickerProps {
  /** Current audience filter. */
  value: AudienceFilter;
  /** Called with the next filter whenever the admin changes the selection. */
  onChange: (filter: AudienceFilter) => void;
  /** When true, renders a read-only summary instead of editable controls. */
  readOnly?: boolean;
  /** Human-readable summary to show in read-only mode (from the audience-count API). */
  description?: string;
}

/**
 * Audience picker for campaign authoring (#596/#222). Lets an admin target
 * "all active subscribers" or a tag-based segment ("any"/"all" match).
 * Read-only outside of `draft` status, since the backend only allows editing
 * `audience_filter` while a campaign is a draft.
 */
export function AudiencePicker({ value, onChange, readOnly = false, description }: AudiencePickerProps) {
  const [tags, setTags] = useState<TagCount[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);

  const fetchTags = useCallback(async () => {
    setLoadingTags(true);
    try {
      const res = await fetch("/api/admin/subscribers/tags");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load tags");
      setTags(json.data ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load tags");
    } finally {
      setLoadingTags(false);
    }
  }, []);

  useEffect(() => {
    if (!readOnly) fetchTags();
  }, [readOnly, fetchTags]);

  if (readOnly) {
    const fallback =
      value.kind === "all"
        ? "All active subscribers"
        : `Subscribers tagged ${value.match === "all" ? "all of" : "any of"}: ${value.tags.join(", ")}`;
    return (
      <div>
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Audience</p>
        <p className="text-sm text-zinc-900 dark:text-zinc-100">{description || fallback}</p>
      </div>
    );
  }

  const isAll = value.kind === "all";

  function setKindAll() {
    onChange({ kind: "all" });
  }

  function setKindTags() {
    if (value.kind !== "tags") {
      onChange({ kind: "tags", tags: [], match: "any" });
    }
  }

  function toggleTag(tag: string) {
    if (value.kind !== "tags") return;
    const has = value.tags.includes(tag);
    const nextTags = has ? value.tags.filter((t) => t !== tag) : [...value.tags, tag];
    onChange({ kind: "tags", tags: nextTags, match: value.match });
  }

  function setMatch(match: "any" | "all") {
    if (value.kind !== "tags") return;
    onChange({ kind: "tags", tags: value.tags, match });
  }

  return (
    <div>
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Audience</p>
      <div className="flex flex-wrap gap-4 mb-3">
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
          <input
            type="radio"
            name="audience-kind"
            checked={isAll}
            onChange={setKindAll}
            className="accent-primary"
          />
          All active subscribers
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
          <input
            type="radio"
            name="audience-kind"
            checked={!isAll}
            onChange={setKindTags}
            className="accent-primary"
          />
          Specific tags
        </label>
      </div>

      {!isAll && (
        <div className="space-y-3 pl-1">
          {loadingTags ? (
            <p className="text-xs text-zinc-500">Loading tags...</p>
          ) : tags.length === 0 ? (
            <p className="text-xs text-zinc-500">No tags found on active subscribers.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => {
                const selected = value.kind === "tags" && value.tags.includes(t.tag);
                return (
                  <button
                    key={t.tag}
                    type="button"
                    onClick={() => toggleTag(t.tag)}
                    className={cn(
                      "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                      selected
                        ? "bg-primary text-white border-primary"
                        : "bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    )}
                  >
                    {t.tag} <span className="opacity-70">({t.count})</span>
                  </button>
                );
              })}
            </div>
          )}

          {value.kind === "tags" && value.tags.length > 1 && (
            <div className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
              <span>Match:</span>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="audience-match"
                  checked={value.match === "any"}
                  onChange={() => setMatch("any")}
                  className="accent-primary"
                />
                Any tag
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="audience-match"
                  checked={value.match === "all"}
                  onChange={() => setMatch("all")}
                  className="accent-primary"
                />
                All tags
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
