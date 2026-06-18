"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Database, AlertCircle } from "lucide-react";
import { TableBrowser } from "@/components/admin/table-browser";
import { Card } from "@/components/ui";

interface TableInfo {
  name: string;
  rowCount: number;
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 text-red-500 text-sm">
      <AlertCircle className="h-4 w-4 shrink-0" />
      {message}
    </div>
  );
}

function RawBrowserInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTable = searchParams.get("table") ?? "";

  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>(initialTable);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [tableError, setTableError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/database/tables")
      .then((r) => r.json())
      .then((json) => {
        if (json.error) {
          setTablesError(json.error);
        } else {
          setTables(json.data);
          if (!initialTable && json.data.length > 0) {
            setSelectedTable(json.data[0].name);
          }
        }
      })
      .catch(() => setTablesError("Failed to load tables"));
  }, [initialTable]);

  const handleTableChange = (name: string) => {
    setSelectedTable(name);
    setTableError(null);
    const params = new URLSearchParams(searchParams.toString());
    params.set("table", name);
    // Remove sort/order from URL when switching tables
    params.delete("sort");
    params.delete("order");
    router.push(`/admin/database/raw?${params}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Database className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Generic Table Browser</h1>
      </div>

      {tablesError && <ErrorBanner message={tablesError} />}

      <Card padding="sm">
        <div className="flex flex-wrap items-center gap-3">
          <label
            htmlFor="table-select"
            className="text-sm font-medium text-zinc-700 dark:text-zinc-300 shrink-0"
          >
            Table:
          </label>
          <select
            id="table-select"
            value={selectedTable}
            onChange={(e) => handleTableChange(e.target.value)}
            className="text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-1.5 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {tables.length === 0 && (
              <option value="" disabled>
                Loading…
              </option>
            )}
            {tables.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name} ({t.rowCount.toLocaleString()} rows)
              </option>
            ))}
          </select>
        </div>
      </Card>

      {tableError && <ErrorBanner message={tableError} />}

      {selectedTable && (
        <Card padding="sm">
          <TableBrowser
            table={selectedTable}
            onError={(msg) => setTableError(msg)}
          />
        </Card>
      )}
    </div>
  );
}

export default function AdminDatabaseRawPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-3 text-zinc-500 dark:text-zinc-400 text-sm">
          <Database className="h-5 w-5 animate-pulse" />
          Loading browser…
        </div>
      }
    >
      <RawBrowserInner />
    </Suspense>
  );
}
