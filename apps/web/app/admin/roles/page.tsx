"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Input } from "@/components/ui";
import { Plus, Pencil, Trash2, Shield, X, Check } from "lucide-react";
import { PERMISSION_GROUPS, ALL_PERMISSIONS } from "@/lib/permissions";

interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  is_system: number;
  created_at: string | null;
}

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPermissions, setFormPermissions] = useState<string[]>([]);

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/roles");
      if (res.ok) {
        const json = await res.json();
        setRoles(json.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  function startCreate() {
    setCreating(true);
    setEditing(null);
    setFormName("");
    setFormDescription("");
    setFormPermissions([]);
  }

  function startEdit(role: Role) {
    setEditing(role.id);
    setCreating(false);
    setFormName(role.name);
    setFormDescription(role.description ?? "");
    setFormPermissions([...role.permissions]);
  }

  function cancelForm() {
    setEditing(null);
    setCreating(false);
  }

  function togglePermission(perm: string) {
    setFormPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  }

  function toggleAllInGroup(groupPerms: string[]) {
    const allSelected = groupPerms.every((p) => formPermissions.includes(p));
    if (allSelected) {
      setFormPermissions((prev) => prev.filter((p) => !groupPerms.includes(p)));
    } else {
      setFormPermissions((prev) => {
        const next = new Set(prev);
        groupPerms.forEach((p) => next.add(p));
        return Array.from(next);
      });
    }
  }

  async function handleSave() {
    const body = { name: formName, description: formDescription, permissions: formPermissions };

    if (creating) {
      const res = await fetch("/api/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setCreating(false);
        fetchRoles();
      }
    } else if (editing) {
      const res = await fetch(`/api/admin/roles/${editing}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setEditing(null);
        fetchRoles();
      }
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this role? Users with this role will lose its permissions.")) return;
    const res = await fetch(`/api/admin/roles/${id}`, { method: "DELETE" });
    if (res.ok) fetchRoles();
  }

  const showForm = creating || editing !== null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Roles</h1>
        {!showForm && (
          <Button onClick={startCreate} size="sm">
            <Plus className="w-4 h-4 mr-1" />
            New Role
          </Button>
        )}
      </div>

      {/* Create / Edit Form */}
      {showForm && (
        <Card padding="md">
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {creating ? "Create Role" : "Edit Role"}
            </h2>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Name
                </label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. moderator"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Description
                </label>
                <Input
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Brief description"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                Permissions
              </label>
              <div className="space-y-4">
                {PERMISSION_GROUPS.map((group) => {
                  const groupKeys = group.permissions.map((p) => p.key);
                  const allSelected = groupKeys.every((k) => formPermissions.includes(k));

                  return (
                    <div key={group.label} className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <button
                          type="button"
                          onClick={() => toggleAllInGroup(groupKeys)}
                          className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${
                            allSelected
                              ? "bg-primary border-primary text-white"
                              : "border-zinc-300 dark:border-zinc-600"
                          }`}
                        >
                          {allSelected && <Check className="w-3 h-3" />}
                        </button>
                        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                          {group.label}
                        </span>
                      </div>
                      <div className="grid gap-1 sm:grid-cols-2 ml-6">
                        {group.permissions.map((perm) => (
                          <label key={perm.key} className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              checked={formPermissions.includes(perm.key)}
                              onChange={() => togglePermission(perm.key)}
                              className="rounded border-zinc-300 text-primary focus:ring-ring"
                            />
                            <span className="text-zinc-700 dark:text-zinc-300">{perm.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="secondary" size="sm" onClick={cancelForm}>
                <X className="w-4 h-4 mr-1" />
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={!formName.trim()}>
                <Check className="w-4 h-4 mr-1" />
                {creating ? "Create" : "Save"}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Roles List */}
      <Card padding="sm">
        {loading ? (
          <div className="py-12 text-center text-zinc-400">Loading...</div>
        ) : roles.length === 0 ? (
          <div className="py-12 text-center text-zinc-400">No roles found</div>
        ) : (
          <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {roles.map((role) => (
              <div key={role.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <Shield className="w-5 h-5 text-primary" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">{role.name}</span>
                      {role.is_system === 1 && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                          system
                        </span>
                      )}
                    </div>
                    {role.description && (
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">{role.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {role.permissions.includes("*") ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                          all permissions
                        </span>
                      ) : (
                        role.permissions.slice(0, 5).map((p) => (
                          <span
                            key={p}
                            className="text-xs px-1.5 py-0.5 rounded bg-accent text-primary"
                          >
                            {p}
                          </span>
                        ))
                      )}
                      {!role.permissions.includes("*") && role.permissions.length > 5 && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                          +{role.permissions.length - 5} more
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {role.is_system === 0 && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => startEdit(role)}
                      className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(role.id)}
                      className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 text-zinc-500 hover:text-red-600"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
