"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight, Pencil, Trash2, Loader2 } from "lucide-react";
import { Button, Input, Modal } from "@/components/ui";
import { cn } from "@/lib/cn";

interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface TableBrowserProps {
  table: string;
  onError?: (msg: string) => void;
}

type SortDir = "asc" | "desc";

interface EditState {
  rowId: unknown;
  column: string;
  currentValue: unknown;
  newValue: string;
}

interface DeleteState {
  rowId: unknown;
  confirmText: string;
}

const PAGE_SIZE = 50;

export function TableBrowser({ table, onError }: TableBrowserProps) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const [editState, setEditState] = useState<EditState | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(PAGE_SIZE));
      if (sortKey) {
        params.set("sort", sortKey);
        params.set("order", sortDir);
      }
      const activeFilters = Object.fromEntries(
        Object.entries(filters).filter(([, v]) => v !== "")
      );
      if (Object.keys(activeFilters).length > 0) {
        params.set("filter", JSON.stringify(activeFilters));
      }

      const res = await fetch(`/api/admin/database/${encodeURIComponent(table)}?${params}`);
      const json = await res.json();
      if (!res.ok) {
        onError?.(json.error ?? "Failed to load rows");
        return;
      }
      setRows(json.data.rows);
      setTotal(json.data.total);
      setColumns(json.data.columns);
    } finally {
      setLoading(false);
    }
  }, [table, page, sortKey, sortDir, filters, onError]);

  useEffect(() => {
    setPage(0);
    setFilters({});
    setSortKey(null);
    setSortDir("asc");
  }, [table]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const handleSort = (col: string) => {
    if (sortKey === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col);
      setSortDir("asc");
    }
    setPage(0);
  };

  const handleFilterChange = (col: string, val: string) => {
    setFilters((prev) => ({ ...prev, [col]: val }));
    setPage(0);
  };

  const pkCol = columns.find((c) => c.pk === 1);

  const openEdit = (row: Record<string, unknown>, colName: string) => {
    if (!pkCol) return;
    setEditError(null);
    setEditState({
      rowId: row[pkCol.name],
      column: colName,
      currentValue: row[colName],
      newValue: String(row[colName] ?? ""),
    });
  };

  const handleEditConfirm = async () => {
    if (!editState) return;
    setEditLoading(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/admin/database/${encodeURIComponent(table)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editState.rowId,
          column: editState.column,
          value: editState.newValue,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setEditError(json.error ?? "Update failed");
        return;
      }
      setEditState(null);
      fetchRows();
    } finally {
      setEditLoading(false);
    }
  };

  const openDelete = (row: Record<string, unknown>) => {
    if (!pkCol) return;
    setDeleteError(null);
    setDeleteState({ rowId: row[pkCol.name], confirmText: "" });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteState) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/database/${encodeURIComponent(table)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: deleteState.rowId,
          confirm: deleteState.confirmText,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setDeleteError(json.error ?? "Delete failed");
        return;
      }
      setDeleteState(null);
      fetchRows();
    } finally {
      setDeleteLoading(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const SortIcon = ({ col }: { col: string }) => {
    if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 text-zinc-400" />;
    return sortDir === "asc" ? (
      <ChevronUp className="w-3 h-3" />
    ) : (
      <ChevronDown className="w-3 h-3" />
    );
  };

  const colNames = columns.map((c) => c.name);

  return (
    <div className="space-y-3">
      {/* Filter row */}
      {colNames.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {colNames.map((col) => (
            <input
              key={col}
              placeholder={`Filter ${col}…`}
              value={filters[col] ?? ""}
              onChange={(e) => handleFilterChange(col, e.target.value)}
              className="text-xs border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring w-32"
            />
          ))}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-700">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
              {colNames.map((col) => (
                <th
                  key={col}
                  onClick={() => handleSort(col)}
                  className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-200 select-none whitespace-nowrap"
                >
                  <span className="inline-flex items-center gap-1">
                    {col}
                    <SortIcon col={col} />
                  </span>
                </th>
              ))}
              {pkCol && (
                <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={colNames.length + (pkCol ? 1 : 0)}
                  className="px-3 py-8 text-center text-zinc-400"
                >
                  <Loader2 className="w-5 h-5 animate-spin inline-block" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={colNames.length + (pkCol ? 1 : 0)}
                  className="px-3 py-8 text-center text-zinc-400"
                >
                  No rows found
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr
                  key={pkCol ? String(row[pkCol.name]) : idx}
                  className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                >
                  {colNames.map((col) => (
                    <td
                      key={col}
                      className={cn(
                        "px-3 py-2 text-zinc-800 dark:text-zinc-200 max-w-[200px] truncate",
                        col !== pkCol?.name && "cursor-pointer hover:bg-primary/90/30"
                      )}
                      title={String(row[col] ?? "")}
                      onClick={() => {
                        if (col !== pkCol?.name) openEdit(row, col);
                      }}
                    >
                      {String(row[col] ?? "")}
                    </td>
                  ))}
                  {pkCol && (
                    <td className="px-3 py-2">
                      <button
                        onClick={() => openDelete(row)}
                        className="text-red-400 hover:text-red-600 transition-colors"
                        title="Delete row"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <span>
          {total} row{total !== 1 ? "s" : ""} &middot; page {page + 1} of {totalPages}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Edit Modal */}
      <Modal
        open={editState !== null}
        onClose={() => setEditState(null)}
        title="Edit Cell"
        titleIcon={<Pencil className="w-4 h-4 text-primary" />}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" size="sm" onClick={() => setEditState(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={editLoading}
              onClick={handleEditConfirm}
            >
              Save
            </Button>
          </div>
        }
      >
        {editState && (
          <div className="space-y-3">
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-1">
                Column: <span className="font-mono font-medium text-zinc-700 dark:text-zinc-300">{editState.column}</span>
              </p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-3">
                Current: <span className="font-mono">{String(editState.currentValue ?? "")}</span>
              </p>
            </div>
            <Input
              label="New value"
              value={editState.newValue}
              onChange={(e) =>
                setEditState((s) => s ? { ...s, newValue: e.target.value } : null)
              }
              autoFocus
            />
            {editError && (
              <p className="text-xs text-red-500">{editError}</p>
            )}
          </div>
        )}
      </Modal>

      {/* Delete Modal */}
      <Modal
        open={deleteState !== null}
        onClose={() => setDeleteState(null)}
        title="Delete Row"
        titleIcon={<Trash2 className="w-4 h-4 text-red-500" />}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" size="sm" onClick={() => setDeleteState(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={deleteLoading}
              disabled={deleteState?.confirmText !== "DELETE"}
              onClick={handleDeleteConfirm}
            >
              Delete
            </Button>
          </div>
        }
      >
        {deleteState && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              This will permanently delete the row with ID{" "}
              <span className="font-mono font-medium">{String(deleteState.rowId)}</span>.
              This action cannot be undone.
            </p>
            <Input
              label='Type "DELETE" to confirm'
              value={deleteState.confirmText}
              onChange={(e) =>
                setDeleteState((s) => s ? { ...s, confirmText: e.target.value } : null)
              }
              placeholder="DELETE"
            />
            {deleteError && (
              <p className="text-xs text-red-500">{deleteError}</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
