"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AuditLogTable, type AuditLog } from "@/components/admin/audit-log-table";

interface LogsResponse {
  data: AuditLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface AdminOption {
  id: string;
  email: string;
}

const ACTION_TYPES = [
  "plan_override_grant",
  "plan_override_remove",
  "user_ban",
  "user_unban",
  "user_plan_change",
  "admin_note_create",
  "admin_note_delete",
];

const TARGET_TYPES = ["user", "subscription"];

const PAGE_SIZE = 25;

const SELECT_CLS =
  "border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-ring";

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  const [action, setAction] = useState("");
  const [adminId, setAdminId] = useState("");
  const [targetType, setTargetType] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [admins, setAdmins] = useState<AdminOption[]>([]);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
      });
      if (action) params.set("action", action);
      if (adminId) params.set("adminId", adminId);
      if (targetType) params.set("targetType", targetType);
      if (search) params.set("search", search);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);

      const res = await fetch(`/api/admin/logs?${params.toString()}`);
      if (!res.ok) return;
      const json: LogsResponse = await res.json();
      setLogs(json.data);
      setTotal(json.total);
      setTotalPages(json.totalPages);

      // Collect unique admins from logs for dropdown
      const seen = new Set<string>();
      const adminList: AdminOption[] = [];
      for (const log of json.data) {
        if (!seen.has(log.admin_id)) {
          seen.add(log.admin_id);
          adminList.push({ id: log.admin_id, email: log.admin_email });
        }
      }
      setAdmins((prev) => {
        const merged = new Map(prev.map((a) => [a.id, a]));
        for (const a of adminList) merged.set(a.id, a);
        return Array.from(merged.values());
      });
    } finally {
      setIsLoading(false);
    }
  }, [page, action, adminId, targetType, search, startDate, endDate]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  // Reset page on filter change
  const handleFilterChange = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(1);
  };

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSearch();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <ScrollText className="w-6 h-6 text-primary" />
          Audit Logs
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Browse and filter all admin actions recorded in the system.
        </p>
      </div>

      <Card padding="md">
        {/* Filter row */}
        <div className="flex flex-wrap gap-3 mb-4">
          <select
            value={action}
            onChange={(e) => handleFilterChange(setAction)(e.target.value)}
            className={SELECT_CLS}
          >
            <option value="">All actions</option>
            {ACTION_TYPES.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>

          <select
            value={adminId}
            onChange={(e) => handleFilterChange(setAdminId)(e.target.value)}
            className={SELECT_CLS}
          >
            <option value="">All admins</option>
            {admins.map((a) => (
              <option key={a.id} value={a.id}>{a.email}</option>
            ))}
          </select>

          <select
            value={targetType}
            onChange={(e) => handleFilterChange(setTargetType)(e.target.value)}
            className={SELECT_CLS}
          >
            <option value="">All target types</option>
            {TARGET_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          <div className="flex gap-2 items-center">
            <input
              type="date"
              value={startDate}
              onChange={(e) => handleFilterChange(setStartDate)(e.target.value)}
              className={SELECT_CLS}
              placeholder="Start date"
            />
            <span className="text-gray-400 dark:text-gray-500 text-sm">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => handleFilterChange(setEndDate)(e.target.value)}
              className={SELECT_CLS}
              placeholder="End date"
            />
          </div>

          <div className="flex gap-2 items-center flex-1 min-w-48">
            <Input
              placeholder="Search in details JSON..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              startIcon={<Search className="w-4 h-4" />}
              className="py-2"
            />
            <Button variant="secondary" size="sm" onClick={handleSearch}>
              Search
            </Button>
          </div>
        </div>

        <AuditLogTable logs={logs} isLoading={isLoading} />

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total} logs
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
