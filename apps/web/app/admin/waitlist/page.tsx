"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Send, RefreshCw, Users, UserCheck, UserPlus, Clock } from "lucide-react";

interface WaitlistEntry {
  id: number;
  email: string;
  referral_code: string;
  referred_by: string | null;
  referral_count: number;
  status: string;
  created_at: string;
  invited_at: string | null;
}

interface Stats {
  total: number;
  waiting: number;
  invited: number;
  registered: number;
}

export default function AdminWaitlistPage() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, waiting: 0, invited: 0, registered: 0 });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);

      const res = await fetch(`/api/admin/waitlist?${params}`);
      const json = await res.json();
      setEntries(json.data);
      setStats(json.stats);
      setTotal(json.total);
      setPages(json.pages);
    } catch {
      console.error("Failed to fetch waitlist data");
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === entries.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(entries.map((e) => e.id)));
    }
  }

  async function sendInvites() {
    const emails = entries
      .filter((e) => selected.has(e.id) && e.status === "waiting")
      .map((e) => e.email);

    if (emails.length === 0) {
      setInviteMessage("No waiting entries selected");
      return;
    }

    setInviteLoading(true);
    setInviteMessage(null);
    try {
      const res = await fetch("/api/admin/waitlist/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails }),
      });
      const json = await res.json();
      setInviteMessage(`Sent ${json.sent} invite(s)${json.failed > 0 ? `, ${json.failed} failed` : ""}`);
      setSelected(new Set());
      fetchData();
    } catch {
      setInviteMessage("Failed to send invites");
    } finally {
      setInviteLoading(false);
    }
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case "waiting":
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"><Clock className="w-3 h-3" />Waiting</span>;
      case "invited":
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"><Send className="w-3 h-3" />Invited</span>;
      case "registered":
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-accent text-primary dark:bg-primary/30 "><UserCheck className="w-3 h-3" />Registered</span>;
      default:
        return <span className="text-xs text-gray-500">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Waitlist</h1>
        <button
          onClick={fetchData}
          className="p-2 rounded-lg text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total" value={stats.total} icon={Users} />
        <StatCard label="Waiting" value={stats.waiting} icon={Clock} />
        <StatCard label="Invited" value={stats.invited} icon={Send} />
        <StatCard label="Registered" value={stats.registered} icon={UserPlus} />
      </div>

      {/* Filters & actions */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-3 items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Search emails..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="pl-9 pr-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-ring w-64"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            className="border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All statuses</option>
            <option value="waiting">Waiting</option>
            <option value="invited">Invited</option>
            <option value="registered">Registered</option>
          </select>
        </div>

        <div className="flex gap-2 items-center">
          {selected.size > 0 && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {selected.size} selected
            </span>
          )}
          <button
            onClick={sendInvites}
            disabled={inviteLoading || selected.size === 0}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-4 h-4" />
            {inviteLoading ? "Sending..." : "Send Invites"}
          </button>
        </div>
      </div>

      {inviteMessage && (
        <div className="px-4 py-2 rounded-lg text-sm bg-accent text-primary dark:bg-primary/30 border border-accent">
          {inviteMessage}
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={entries.length > 0 && selected.size === entries.length}
                    onChange={toggleSelectAll}
                    className="rounded border-zinc-300 dark:border-zinc-600"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Email</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Referrals</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Referred By</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {loading && entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-500 dark:text-zinc-400">
                    Loading...
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-500 dark:text-zinc-400">
                    No waitlist entries found
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(entry.id)}
                        onChange={() => toggleSelect(entry.id)}
                        className="rounded border-zinc-300 dark:border-zinc-600"
                      />
                    </td>
                    <td className="px-4 py-3 text-zinc-900 dark:text-zinc-100 font-medium">{entry.email}</td>
                    <td className="px-4 py-3">{statusBadge(entry.status)}</td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{entry.referral_count}</td>
                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400 text-xs font-mono">
                      {entry.referred_by ? entry.referred_by.slice(0, 8) + "..." : "-"}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400 text-xs">
                      {entry.created_at ? new Date(entry.created_at).toLocaleDateString() : "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 dark:border-zinc-800">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Showing {page * 20 + 1}-{Math.min((page + 1) * 20, total)} of {total}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-3 py-1 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg disabled:opacity-50 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-zinc-700 dark:text-zinc-300"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(Math.min(pages - 1, page + 1))}
                disabled={page >= pages - 1}
                className="px-3 py-1 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg disabled:opacity-50 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-zinc-700 dark:text-zinc-300"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: number; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{value}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
        </div>
      </div>
    </div>
  );
}
