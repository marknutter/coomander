"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";

interface PlanOverrideFormProps {
  userId: string;
  currentOverride: {
    plan: string;
    reason: string | null;
    expiresAt: string | null;
    active: boolean;
  } | null;
  onSuccess: () => void;
}

const PLANS = ["free", "pro"];

export function PlanOverrideForm({ userId, currentOverride, onSuccess }: PlanOverrideFormProps) {
  const [plan, setPlan] = useState(currentOverride?.plan ?? "pro");
  const [reason, setReason] = useState(currentOverride?.reason ?? "");
  const [expiresAt, setExpiresAt] = useState(
    currentOverride?.expiresAt
      ? currentOverride.expiresAt.split("T")[0]
      : ""
  );
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/users/${userId}/plan`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, reason, expiresAt: expiresAt || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to set plan override");
        return;
      }
      onSuccess();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove() {
    if (!currentOverride) return;
    setRemoving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/users/${userId}/plan`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to remove override");
        return;
      }
      onSuccess();
    } catch {
      setError("Network error");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Plan
        </label>
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {PLANS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <Input
        label="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. VIP customer, beta tester..."
        required
      />

      <Input
        label="Expires At (optional)"
        type="date"
        value={expiresAt}
        onChange={(e) => setExpiresAt(e.target.value)}
      />

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" loading={loading}>
          {currentOverride ? "Update Override" : "Set Override"}
        </Button>
        {currentOverride && (
          <Button
            type="button"
            variant="danger"
            loading={removing}
            onClick={handleRemove}
          >
            Remove Override
          </Button>
        )}
      </div>
    </form>
  );
}
