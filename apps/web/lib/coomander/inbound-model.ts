/**
 * Model resolution for the Telegram inbound classifier (#218).
 *
 * The web worker's NON-streaming counterpart to the agents worker's
 * `apps/agents/src/chat-model.ts::resolveAgentModel`. It maps the
 * admin/per-user-chosen catalog model (via `resolveActiveModelId`) to a Vercel
 * AI SDK `LanguageModel`, dispatching on the entry's provider:
 *   - anthropic  → createAnthropic (env ANTHROPIC_API_KEY)
 *   - cloudflare → createWorkersAI({ binding: env.AI })
 *
 * The classifier REQUIRES forced tool-calling, so any chosen model without tool
 * support (or an unknown id) falls back to the Anthropic default. In `next dev`
 * there is no `[ai]` binding, so a Workers-AI choice also falls back to Anthropic
 * (real Workers-AI dispatch happens only in the deployed worker). Every fallback
 * is logged and the function never throws — Telegram parsing must not break.
 *
 * NOTE: the agents worker wraps the Workers-AI binding in an SSE-dedupe Proxy;
 * that is STREAMING-only. The classifier uses non-streaming `generateText`, so
 * the shim is intentionally omitted here.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createWorkersAI } from "workers-ai-provider";
import type { LanguageModel } from "ai";
import { getModel } from "@/lib/model-catalog";
import { resolveActiveModelId } from "@/lib/active-model";
import { log } from "@/lib/logger";

/** env-tier default — the pre-#218 inbound model + the universal fallback. */
export const ANTHROPIC_FALLBACK_ID =
  process.env.COOMANDER_AGENT_MODEL || process.env.CHAT_MODEL || "claude-sonnet-4-6";

export interface InboundModel {
  model: LanguageModel;
  resolvedId: string;
  provider: string;
  /** True when we fell back to the Anthropic default instead of the chosen model. */
  fellBack: boolean;
}

/**
 * The Workers AI binding for THIS (web) worker, or null in `next dev` (no
 * binding) / when the OpenNext context can't be resolved. Lazy `require` mirrors
 * lib/db.ts — `getCloudflareContext` only resolves inside the Workers runtime.
 */
function workersAiBinding(): unknown | null {
  try {
    const { getCloudflareContext } = require("@opennextjs/cloudflare");
    return getCloudflareContext()?.env?.AI ?? null;
  } catch {
    return null;
  }
}

function anthropicModel(id: string, fellBack: boolean): InboundModel {
  return {
    model: createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(id),
    resolvedId: id,
    provider: "anthropic",
    fellBack,
  };
}

export async function resolveInboundModel(userId: string): Promise<InboundModel> {
  const chosenId = await resolveActiveModelId({ userId }).catch(() => ANTHROPIC_FALLBACK_ID);
  const entry = getModel(chosenId);

  // The classifier REQUIRES forced tool-calling → models without tool support
  // (or unknown ids) fall back to the Anthropic default.
  if (!entry || !entry.supportsTools) {
    if (entry && !entry.supportsTools) {
      log.info("[inbound-model] chosen model has no tool support; using Anthropic default", { chosenId });
    }
    return anthropicModel(ANTHROPIC_FALLBACK_ID, chosenId !== ANTHROPIC_FALLBACK_ID);
  }

  switch (entry.provider) {
    case "anthropic":
      return anthropicModel(entry.id, false);
    case "cloudflare": {
      const ai = workersAiBinding();
      if (!ai) {
        // dev `next dev` has no [ai] binding → graceful fallback.
        log.warn("[inbound-model] Workers AI chosen but env.AI binding missing; using Anthropic default", { chosenId: entry.id });
        return anthropicModel(ANTHROPIC_FALLBACK_ID, true);
      }
      return {
        model: createWorkersAI({ binding: ai as never })(entry.id),
        resolvedId: entry.id,
        provider: "cloudflare",
        fellBack: false,
      };
    }
    default:
      log.warn("[inbound-model] provider not wired for inbound; using Anthropic default", { provider: entry.provider });
      return anthropicModel(ANTHROPIC_FALLBACK_ID, true);
  }
}
