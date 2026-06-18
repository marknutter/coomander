"use client";

import { useState, useEffect, useCallback } from "react";
import { Alert } from "@/components/ui/alert";

interface Subscriber {
  id: number;
  email: string;
  status: string;
  created_at: string;
}

const PAGE_SIZE = 50;

export function SubscriberList() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSubscribers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (search) params.set("search", search);
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
  }, [page, search]);

  useEffect(() => {
    fetchSubscribers();
  }, [fetchSubscribers]);


  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    setPage(1);
  }

  function exportCsv() {
    const rows = [
      ["email", "status", "subscribed_at"],
      ...subscribers.map((s) => [s.email, s.status, s.created_at]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
      <div className="flex items-center justify-between gap-3">
        <input
          type="search"
          value={search}
          onChange={handleSearchChange}
          placeholder="Search by email..."
          className="border border-zinc-300 dark:border-zinc-700 rounded-md px-3 py-2 text-sm bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 w-64 focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">{total} total</span>
          <button
            onClick={exportCsv}
            disabled={subscribers.length === 0}
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
              <th className="text-left px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">Subscribed</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-zinc-400">Loading...</td>
              </tr>
            ) : subscribers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-zinc-400">No subscribers found.</td>
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
