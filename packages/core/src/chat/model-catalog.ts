/**
 * Tiered AI model catalog — the single source of truth for which models the app
 * knows about. Shared by apps/web (the SSE `/api/chat` engine) and apps/agents
 * (the live WebSocket chat) so the two paths can never drift on what models
 * exist, their capabilities, or the defaults (epic #483).
 *
 * Pure + platform-agnostic: no env, no Node built-ins, no DOM. The web app
 * re-exports this from `apps/web/lib/model-catalog.ts` so existing imports keep
 * working; the agent imports it directly.
 *
 * ## Tiers
 * - `byok` — proprietary models that need a provider API key ("bring your own
 *   key"): Anthropic Claude, OpenAI, Google.
 * - `workers-ai` — open models hosted on Cloudflare Workers AI. No provider key
 *   required (billed via the CF account).
 *
 * ## Contract (consumed by both chat engines)
 *   - the `ModelCatalogEntry` shape (esp. `id`, `provider`, `tier`, the
 *     capability flags, `contextWindow`)
 *   - `getModel(id)`, `listModels()`, `isValidModelId(id)`, `DEFAULT_MODEL_ID`,
 *     `DEFAULT_OPEN_MODEL_ID`
 * Add new models by appending entries here — do not hardcode model ids in UI or
 * in either chat engine.
 */

/** Which execution path / billing model an entry belongs to. */
export type ModelTier = "workers-ai" | "byok";

/** The upstream provider. `cloudflare` == Workers AI open models. */
export type ModelProvider = "anthropic" | "openai" | "google" | "cloudflare";

/** Coarse relative cost bucket for UI display (not a price). */
export type CostTier = "free" | "low" | "medium" | "high";

export interface ModelCatalogEntry {
  /** Stable model id passed to the provider SDK (e.g. "claude-sonnet-4-6"). */
  id: string;
  /** Human-friendly name for the switcher UI. */
  label: string;
  /** Upstream provider. */
  provider: ModelProvider;
  /** `byok` (needs a provider key) or `workers-ai` (open, no key). */
  tier: ModelTier;
  /** Approx context window in tokens (for UI; not enforced here). */
  contextWindow: number;
  /** Capability flags — used by UI and the multi-provider engine. */
  supportsImages: boolean;
  supportsPdf: boolean;
  supportsTools: boolean;
  /** Coarse cost bucket for the switcher UI. */
  costTier: CostTier;
  /** Whether end users may select this model (vs admin-only / internal). */
  userSelectable: boolean;
}

/**
 * The catalog. Order is the display order in the switcher.
 *
 * NOTE on ids:
 *  - Claude ids are the current AppSeed defaults (see chat-config CHAT_MODEL).
 *  - Workers AI ids follow the `@cf/<org>/<model>` convention.
 */
export const MODEL_CATALOG: ModelCatalogEntry[] = [
  // ─── BYOK — Anthropic Claude (executes today) ──────────────────────────────
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    tier: "byok",
    contextWindow: 200_000,
    supportsImages: true,
    supportsPdf: true,
    supportsTools: true,
    costTier: "medium",
    userSelectable: true,
  },
  {
    id: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    provider: "anthropic",
    tier: "byok",
    contextWindow: 200_000,
    supportsImages: true,
    supportsPdf: true,
    supportsTools: true,
    costTier: "high",
    userSelectable: true,
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    tier: "byok",
    contextWindow: 200_000,
    supportsImages: true,
    supportsPdf: true,
    supportsTools: true,
    costTier: "low",
    userSelectable: true,
  },

  // ─── Workers AI — open models (no key, billed via the CF account) ───────────
  // Curated subset of the live `wrangler ai models list` catalog (#495). Ids,
  // contextWindow, supportsImages (vision), and supportsTools (function_calling)
  // are taken VERBATIM from Cloudflare's model metadata — keep them in sync if
  // the account catalog changes. `supportsTools` reflects CF's `function_calling`
  // capability; the agent gates tool-passing on it (a model marked tool-free
  // never receives tools, so it can't refuse/garble normal chat — #491).
  {
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    label: "Llama 3.3 70B (Workers AI)",
    provider: "cloudflare",
    tier: "workers-ai",
    contextWindow: 24_000,
    supportsImages: false,
    supportsPdf: false,
    // Cloudflare lists this as function_calling-capable, but in practice it
    // REFUSES normal chat when given tools ("…outside the scope of the functions
    // I have been given") — verified in prod (#495). The other tool-capable open
    // models (Llama 4 Scout, Mistral, GPT-OSS, Qwen3) handle tools+chat fine; this
    // older variant is the outlier, so it runs tool-free.
    supportsTools: false,
    costTier: "free",
    userSelectable: true,
  },
  {
    id: "@cf/meta/llama-4-scout-17b-16e-instruct",
    label: "Llama 4 Scout 17B (Workers AI)",
    provider: "cloudflare",
    tier: "workers-ai",
    contextWindow: 131_000,
    supportsImages: true,
    supportsPdf: false,
    supportsTools: true,
    costTier: "free",
    userSelectable: true,
  },
  {
    id: "@cf/mistralai/mistral-small-3.1-24b-instruct",
    label: "Mistral Small 3.1 24B (Workers AI)",
    provider: "cloudflare",
    tier: "workers-ai",
    contextWindow: 128_000,
    supportsImages: false,
    supportsPdf: false,
    supportsTools: true,
    costTier: "free",
    userSelectable: true,
  },
  {
    id: "@cf/openai/gpt-oss-120b",
    label: "GPT-OSS 120B (Workers AI)",
    provider: "cloudflare",
    tier: "workers-ai",
    contextWindow: 128_000,
    supportsImages: false,
    supportsPdf: false,
    supportsTools: true,
    costTier: "low",
    userSelectable: true,
  },
  {
    id: "@cf/openai/gpt-oss-20b",
    label: "GPT-OSS 20B (Workers AI)",
    provider: "cloudflare",
    tier: "workers-ai",
    contextWindow: 128_000,
    supportsImages: false,
    supportsPdf: false,
    supportsTools: true,
    costTier: "free",
    userSelectable: true,
  },
  {
    id: "@cf/qwen/qwen3-30b-a3b-fp8",
    label: "Qwen3 30B (Workers AI)",
    provider: "cloudflare",
    tier: "workers-ai",
    contextWindow: 32_768,
    supportsImages: false,
    supportsPdf: false,
    supportsTools: true,
    costTier: "free",
    userSelectable: true,
  },
  {
    id: "@cf/meta/llama-3.1-8b-instruct-fp8",
    label: "Llama 3.1 8B (Workers AI)",
    provider: "cloudflare",
    tier: "workers-ai",
    contextWindow: 32_000,
    supportsImages: false,
    supportsPdf: false,
    supportsTools: false,
    costTier: "free",
    userSelectable: true,
  },
  {
    id: "@cf/qwen/qwen2.5-coder-32b-instruct",
    label: "Qwen2.5 Coder 32B (Workers AI)",
    provider: "cloudflare",
    tier: "workers-ai",
    contextWindow: 32_768,
    supportsImages: false,
    supportsPdf: false,
    supportsTools: false,
    costTier: "free",
    userSelectable: true,
  },
  {
    id: "@cf/meta/llama-3.2-11b-vision-instruct",
    label: "Llama 3.2 11B Vision (Workers AI)",
    provider: "cloudflare",
    tier: "workers-ai",
    contextWindow: 128_000,
    supportsImages: true,
    supportsPdf: false,
    supportsTools: false,
    costTier: "free",
    userSelectable: true,
  },
];

/**
 * The built-in default model id. Used as the final fallback in active-model
 * resolution when no admin default, per-user preference, or CHAT_MODEL env is
 * set. Kept in sync with chat-config's historical default (Sonnet).
 */
export const DEFAULT_MODEL_ID = "claude-sonnet-4-6";

/**
 * The default open (Workers AI) model id. Used by the multi-provider chat engine
 * (web + agent) as the no-key fallback: when the resolved model is a `byok`
 * entry but no provider key is configured, the engine falls back to this open
 * model so chat keeps working with no key (billed via the Cloudflare account, no
 * API key needed). MUST be a `workers-ai`-tier entry present in MODEL_CATALOG.
 * Deliberately a TOOL-FREE model: the no-key fallback must chat reliably, and
 * small open models can refuse/garble when handed tools (#491), so the fallback
 * never risks that.
 */
export const DEFAULT_OPEN_MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

/** Return all catalog entries (display order preserved). */
export function listModels(): ModelCatalogEntry[] {
  return MODEL_CATALOG;
}

/** Return only entries end users are allowed to pick. */
export function listUserSelectableModels(): ModelCatalogEntry[] {
  return MODEL_CATALOG.filter((m) => m.userSelectable);
}

/** Look up a single entry by id, or `undefined` if unknown. */
export function getModel(id: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

/** True when `id` is a known catalog model. */
export function isValidModelId(id: string): boolean {
  return MODEL_CATALOG.some((m) => m.id === id);
}
