"use client";

import { useState, useEffect, useCallback } from "react";
import { Alert } from "@/components/ui/alert";
import { TagEditor } from "@/components/admin/tag-editor";

interface Subscriber {
  id: number;
  email: string;
  status: string;
  tags: string[];
  created_at: string;
}

interface TagCount {
  tag: string;
  count: number;
}

const PAGE_SIZE = 50;

export function SubscriberList() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<TagCount[]>([]);
  const [tagFilter, setTagFilter] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);

  const fetchSubscribers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (search) params.set("search", search);
      if (tagFilter) params.set("tag", tagFilter);
      const res = await fetch(`/api/admin/subscribers?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load subscribers");
      setSubscribers(json.data);
      setTotal(json.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [page, search, tagFilter]);

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/subscribers/tags");
      const json = await res.json();
      if (res.ok) setAllTags(json.data);
    } catch {
      // Tag suggestions are non-critical; fail silently.
    }
  }, []);

  useEffect(() => {
    fetchSubscribers();
  }, [fetchSubscribers]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  function handleTagsChange(subscriberId: number, newTags: string[]) {
    setSubscribers((prev) =>
      prev.map((s) => (s.id === subscriberId ? { ...s, tags: newTags } : s))
    );
    fetchTags();
  }

  async function handleAddSubscriber(e: React.FormEvent) {
    e.preventDefault();
    const email = newEmail.trim();
    if (!email) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/subscribers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to add subscriber");
      setNewEmail("");
      setPage(1);
      await fetchSubscribers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add subscriber");
    } finally {
      setAdding(false);
    }
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    setPage(1);
  }

  function handleTagFilterChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setTagFilter(e.target.value);
    setPage(1);
  }

  // Export the FULL current selection (all pages of the active search + tag
  // filter), not just the visible page — fetch everything matching, then build
  // the CSV. This keeps "export everyone tagged X" complete.
  async function exportCsv() {
    try {
      const params = new URLSearchParams({ page: "1", limit: "10000" });
      if (search) params.set("search", search);
      if (tagFilter) params.set("tag", tagFilter);
      const res = await fetch(`/api/admin/subscribers?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Export failed");
      const all: Subscriber[] = json.data;
      const rows = [
        ["email", "status", "tags", "subscribed_at"],
        ...all.map((s) => [s.email, s.status, s.tags.join("|"), s.created_at]),
      ];
      const csv = rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    }
  }

  async function deleteSubscriber(email: string) {
    if (!confirm(`Remove subscriber ${email}?`)) return;
    const res = await fetch(`/api/admin/subscribers?email=${encodeURIComponent(email)}`, { method: "DELETE" });
    if (res.ok) {
      fetchSubscribers();
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <form onSubmit={handleAddSubscriber} className="flex items-center gap-2">
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder="Add subscriber by email..."
          className="border border-zinc-300 dark:border-zinc-700 rounded-md px-3 py-2 text-sm bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 w-72 focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          disabled={adding || !newEmail.trim()}
          className="px-3 py-2 text-sm font-medium bg-primary hover:bg-primary/90 disabled:opacity-50 text-white rounded-md transition-colors"
        >
          {adding ? "Adding…" : "Add subscriber"}
        </button>
      </form>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={handleSearchChange}
            placeholder="Search by email..."
            className="border border-zinc-300 dark:border-zinc-700 rounded-md px-3 py-2 text-sm bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 w-64 focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {allTags.length > 0 && (
            <select
              value={tagFilter}
              onChange={handleTagFilterChange}
              className="border border-zinc-300 dark:border-zinc-700 rounded-md px-3 py-2 text-sm bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All tags</option>
              {allTags.map((t) => (
                <option key={t.tag} value={t.tag}>
                  {t.tag} ({t.count})
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {total} {tagFilter ? `tagged "${tagFilter}"` : "total"}
          </span>
          <button
            onClick={exportCsv}
            disabled={total === 0}
            className="px-3 py-2 text-sm font-medium bg-primary hover:bg-primary/90 disabled:opacity-50 text-white rounded-md transition-colors"
          >
            Export CSV
          </button>
        </div>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">Email</th>
              <th className="text-left px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">Status</th>
              <th className="text-left px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">Tags</th>
              <th className="text-left px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">Subscribed</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-400">Loading...</td>
              </tr>
            ) : subscribers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-400">
                  {tagFilter ? "No subscribers with this tag." : "No subscribers found."}
                </td>
              </tr>
            ) : (
              subscribers.map((s) => (
                <tr key={s.id} className="bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                  <td className="px-4 py-3 text-zinc-900 dark:text-zinc-100 font-mono text-xs">{s.email}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      s.status === "active"
                        ? "bg-accent text-primary "
                        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <TagEditor
                      email={s.email}
                      tags={s.tags}
                      suggestions={allTags.map((t) => t.tag)}
                      onTagsChange={(newTags) => handleTagsChange(s.id, newTags)}
                    />
                  </td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400 text-xs">
                    {new Date(s.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => deleteSubscriber(s.email)}
                      className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-xs border border-zinc-300 dark:border-zinc-700 rounded-md disabled:opacity-40 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-xs border border-zinc-300 dark:border-zinc-700 rounded-md disabled:opacity-40 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
