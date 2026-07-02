"use client";

import { useState } from "react";
import { X, Plus } from "lucide-react";
import { Badge } from "@/components/ui";
import { toast } from "@/lib/use-toast";

interface TagEditorProps {
  /** Subscriber email this tag set belongs to */
  email: string;
  /** Current tags for this subscriber */
  tags: string[];
  /** Known tags across all subscribers, used to power the add-tag suggestions */
  suggestions: string[];
  /** Called with the server-confirmed tag list after a successful add/remove */
  onTagsChange: (tags: string[]) => void;
}

/**
 * Inline tag chip editor for a single subscriber row. Renders existing tags
 * as removable badges plus a small input (with datalist suggestions) for
 * adding new ones. Every add/remove sends the full updated tag array via
 * `PATCH /api/admin/subscribers`, since the endpoint replaces the tag set
 * wholesale rather than diffing it.
 */
export function TagEditor({ email, tags, suggestions, onTagsChange }: TagEditorProps) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);

  const datalistId = `tag-suggestions-${email.replace(/[^a-zA-Z0-9]/g, "-")}`;

  async function updateTags(nextTags: string[]) {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/subscribers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, tags: nextTags }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to update tags");
      onTagsChange(json.data?.tags ?? nextTags);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update tags");
    } finally {
      setSaving(false);
    }
  }

  function removeTag(tag: string) {
    updateTags(tags.filter((t) => t !== tag));
  }

  function addTag() {
    const next = draft.trim();
    if (!next) return;
    if (tags.some((t) => t.toLowerCase() === next.toLowerCase())) {
      toast.error(`Already tagged "${next}"`);
      setDraft("");
      setAdding(false);
      return;
    }
    setDraft("");
    setAdding(false);
    updateTags([...tags, next]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    } else if (e.key === "Escape") {
      setDraft("");
      setAdding(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <Badge key={tag} variant="default" className="gap-1">
          {tag}
          <button
            type="button"
            onClick={() => removeTag(tag)}
            disabled={saving}
            aria-label={`Remove tag ${tag}`}
            className="hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
          >
            <X className="w-3 h-3" />
          </button>
        </Badge>
      ))}

      {adding ? (
        <>
          <input
            autoFocus
            list={datalistId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (draft.trim()) addTag();
              else setAdding(false);
            }}
            placeholder="tag name"
            disabled={saving}
            className="w-28 border border-zinc-300 dark:border-zinc-700 rounded-md px-1.5 py-0.5 text-xs bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <datalist id={datalistId}>
            {suggestions
              .filter((s) => !tags.includes(s))
              .map((s) => (
                <option key={s} value={s} />
              ))}
          </datalist>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={saving}
          aria-label="Add tag"
          className="inline-flex items-center gap-0.5 text-xs text-zinc-400 hover:text-primary dark:hover:text-primary disabled:opacity-50"
        >
          <Plus className="w-3 h-3" />
          tag
        </button>
      )}
    </div>
  );
}
