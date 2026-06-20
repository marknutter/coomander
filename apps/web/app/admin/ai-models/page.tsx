"use client";

import { useState, useEffect, useCallback } from "react";
import { Bot, KeyRound, Loader2, Check, Trash2, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { toast } from "@/lib/use-toast";

// Mirror of lib/model-catalog ModelCatalogEntry (kept inline to avoid importing
// a server module into the client bundle — the API returns these verbatim).
interface ModelEntry {
  id: string;
  label: string;
  provider: string;
  tier: "workers-ai" | "byok";
  contextWindow: number;
  supportsImages: boolean;
  supportsPdf: boolean;
  supportsTools: boolean;
  costTier: "free" | "low" | "medium" | "high";
  userSelectable: boolean;
}

interface ProviderKeyStatus {
  provider: "anthropic" | "openai" | "google";
  configured: boolean;
  source: "db" | "env" | "none";
  hint: string | null;
  envPresent: boolean;
  updatedAt: number | null;
}

interface ModelsResponse {
  catalog: ModelEntry[];
  adminDefaultModel: string | null;
  effectiveModel: string;
  builtInDefault: string;
  providerKeys: ProviderKeyStatus[];
  encryptionConfigured: boolean;
}

const SELECT_CLS =
  "border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-ring w-full max-w-md";

const COST_VARIANT: Record<ModelEntry["costTier"], BadgeVariant> = {
  free: "success",
  low: "info",
  medium: "default",
  high: "warning",
};

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  google: "Google (Gemini)",
};

export default function AdminAiModelsPage() {
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedModel, setSelectedModel] = useState("");
  const [savingModel, setSavingModel] = useState(false);

  // Per-provider key input + busy state
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [keyBusy, setKeyBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/admin/ai-models");
      if (!res.ok) {
        toast.error("Failed to load AI model settings");
        return;
      }
      const json: ModelsResponse = await res.json();
      setData(json);
      setSelectedModel(json.adminDefaultModel ?? json.effectiveModel);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveDefaultModel = async () => {
    if (!selectedModel) return;
    setSavingModel(true);
    try {
      const res = await fetch("/api/admin/ai-models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: selectedModel }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Failed to save default model");
        return;
      }
      toast.success("Default model updated");
      await load();
    } finally {
      setSavingModel(false);
    }
  };

  const saveKey = async (provider: string) => {
    const key = (keyInputs[provider] ?? "").trim();
    if (!key) return;
    setKeyBusy((b) => ({ ...b, [provider]: true }));
    try {
      const res = await fetch("/api/admin/ai-models/keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Failed to save key");
        return;
      }
      toast.success(`${PROVIDER_LABEL[provider] ?? provider} key saved`);
      setKeyInputs((k) => ({ ...k, [provider]: "" }));
      await load();
    } finally {
      setKeyBusy((b) => ({ ...b, [provider]: false }));
    }
  };

  const clearKey = async (provider: string) => {
    setKeyBusy((b) => ({ ...b, [provider]: true }));
    try {
      const res = await fetch(`/api/admin/ai-models/keys?provider=${encodeURIComponent(provider)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error("Failed to clear key");
        return;
      }
      toast.success(`${PROVIDER_LABEL[provider] ?? provider} key removed`);
      await load();
    } finally {
      setKeyBusy((b) => ({ ...b, [provider]: false }));
    }
  };

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const byok = data.catalog.filter((m) => m.tier === "byok");
  const workersAi = data.catalog.filter((m) => m.tier === "workers-ai");
  const selectedEntry = data.catalog.find((m) => m.id === selectedModel);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Bot className="w-6 h-6 text-primary" />
          AI Models
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Choose the default chat model and manage provider API keys. New chats use the active default;
          keys are encrypted at rest and never displayed.
        </p>
      </div>

      {/* ─── Default model switcher ─────────────────────────────────────── */}
      <Card padding="md">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Default model</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Currently effective: <code className="font-mono">{data.effectiveModel}</code>
          {data.adminDefaultModel == null && (
            <span className="text-gray-400"> (no admin override — using env / built-in default)</span>
          )}
        </p>

        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className={SELECT_CLS}
        >
          <optgroup label="BYOK — proprietary (needs provider key)">
            {byok.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · {m.supportsTools ? "tools" : "no tools"}
              </option>
            ))}
          </optgroup>
          <optgroup label="Workers AI — open (no key)">
            {workersAi.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · {m.supportsTools ? "tools" : "no tools"}
              </option>
            ))}
          </optgroup>
        </select>

        {selectedEntry && (
          <div className="flex flex-wrap gap-2 mt-3">
            <Badge variant={selectedEntry.tier === "byok" ? "pro" : "success"}>
              {selectedEntry.tier === "byok" ? "BYOK" : "Workers AI"}
            </Badge>
            <Badge variant={COST_VARIANT[selectedEntry.costTier]}>cost: {selectedEntry.costTier}</Badge>
            <Badge variant="info">{(selectedEntry.contextWindow / 1000).toFixed(0)}k context</Badge>
            {selectedEntry.supportsImages && <Badge variant="default">images</Badge>}
            {selectedEntry.supportsPdf && <Badge variant="default">pdf</Badge>}
            {selectedEntry.supportsTools && <Badge variant="default">tools</Badge>}
          </div>
        )}

        <div className="mt-4">
          <Button
            onClick={saveDefaultModel}
            disabled={savingModel || selectedModel === data.adminDefaultModel}
          >
            {savingModel ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Save default
          </Button>
        </div>
      </Card>

      {/* ─── Provider keys ──────────────────────────────────────────────── */}
      <Card padding="md">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1 flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-primary" />
          Provider keys
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Set a key to override the environment variable for that provider. Keys are write-only —
          they are encrypted and never shown again.
        </p>

        {!data.encryptionConfigured && (
          <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3 mb-4">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              No encryption key configured. Set <code className="font-mono">PROVIDER_KEY_KEK</code> or{" "}
              <code className="font-mono">BETTER_AUTH_SECRET</code> before saving keys.
            </span>
          </div>
        )}

        <div className="space-y-4">
          {data.providerKeys.map((pk) => {
            const busy = keyBusy[pk.provider];
            return (
              <div
                key={pk.provider}
                className="border border-gray-200 dark:border-gray-700 rounded-lg p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    {PROVIDER_LABEL[pk.provider] ?? pk.provider}
                  </div>
                  {pk.configured ? (
                    <Badge variant="success">
                      configured ({pk.source === "db" ? "admin-set" : "env"}
                      {pk.hint ? ` ${pk.hint}` : ""})
                    </Badge>
                  ) : (
                    <Badge variant="warning">not configured</Badge>
                  )}
                </div>

                {pk.source === "db" && pk.envPresent && (
                  <p className="text-xs text-gray-400 mb-2">
                    An <code className="font-mono">ENV</code> key is also present but the admin-set key
                    takes precedence.
                  </p>
                )}

                <div className="flex flex-wrap gap-2 items-center">
                  <Input
                    type="password"
                    autoComplete="off"
                    placeholder={pk.configured ? "Replace key…" : "Paste API key…"}
                    value={keyInputs[pk.provider] ?? ""}
                    onChange={(e) =>
                      setKeyInputs((k) => ({ ...k, [pk.provider]: e.target.value }))
                    }
                    className="flex-1 min-w-56"
                  />
                  <Button
                    size="sm"
                    onClick={() => saveKey(pk.provider)}
                    disabled={busy || !(keyInputs[pk.provider] ?? "").trim() || !data.encryptionConfigured}
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
                  </Button>
                  {pk.source === "db" && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => clearKey(pk.provider)}
                      disabled={busy}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
