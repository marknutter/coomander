"use client";

import { useState, useEffect, useCallback } from "react";
import { Bot, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { toast } from "@/lib/use-toast";

interface ModelOption {
  id: string;
  label: string;
  tier: "workers-ai" | "byok";
  supportsTools: boolean;
}

interface PreferenceResponse {
  preference: string | null;
  adminDefaultModel: string | null;
  effectiveModel: string;
  models: ModelOption[];
}

const SELECT_CLS =
  "border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-ring";

const USE_DEFAULT = "__default__";

/**
 * Per-user model preference (#465, optional AC). Lets a user pick which catalog
 * model their chats use, or fall back to the admin default. Self-contained so
 * the large settings page only needs a one-line import.
 */
export function AiModelPreference() {
  const [data, setData] = useState<PreferenceResponse | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/model-preference");
    if (!res.ok) return;
    setData((await res.json()) as PreferenceResponse);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onChange = async (value: string) => {
    const modelId = value === USE_DEFAULT ? null : value;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/model-preference", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Failed to update model preference");
        return;
      }
      toast.success("Chat model updated");
      await load();
    } finally {
      setSaving(false);
    }
  };

  if (!data) return null;

  return (
    <Card icon={<Bot className="w-4 h-4 text-primary" />} title="AI Chat Model">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Preferred model</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Used for your chats. Leave on default to follow the app-wide setting.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
          <select
            value={data.preference ?? USE_DEFAULT}
            onChange={(e) => onChange(e.target.value)}
            disabled={saving}
            className={SELECT_CLS}
          >
            <option value={USE_DEFAULT}>Use app default ({data.effectiveModel})</option>
            {data.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · {m.supportsTools ? "tools" : "no tools"}
              </option>
            ))}
          </select>
        </div>
      </div>
    </Card>
  );
}
