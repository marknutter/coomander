/**
 * Chat configuration for the Coomander agents Worker.
 *
 * ⚠️ ADAPTED from the AppSeed template (which mirrors a static prompt from
 * apps/web/lib/chat-config.ts). Coomander's chat prompt is DYNAMIC — built per
 * turn from the user's live ops state (TodayModel, persona mode, recent thread)
 * by apps/web/lib/coomander/coomanderChat.ts. Rather than mirroring that prompt
 * here and keeping two copies in sync, the Worker fetches the fully rendered
 * system prompt + tool definitions from the web app each turn:
 *
 *   GET /api/coomander/agent-context  (cookie-authed, acts as the user)
 *     → { entitled, today, model, maxTokens, systemPrompt, tools }
 *
 * apps/web/lib/coomander/coomanderChat.ts (+ agentPrompts.ts, inbound.ts)
 * remains the single source of truth for the prompt, the model choice, and the
 * tool schemas. The values in getChatConfig below are FALLBACKS only (hydration
 * window size, and model/max-tokens defaults mirroring coomanderChat's
 * constants in case the context omits them).
 */

import type { ModelProvider, ModelTier } from "@coomander/core";
import type { Env } from "./index";
import { callAsUser } from "./web-api";

export interface ChatConfig {
  /** Fallback Anthropic model id — coomanderChat.ts's default. */
  model: string;
  /** Fallback max tokens per response — coomanderChat.ts uses 600. */
  maxTokens: number;
  /** Max recent thread turns to hydrate into model context. */
  contextWindowSize: number;
}

type ChatEnv = {
  CHAT_MODEL?: string;
  CHAT_MAX_TOKENS?: string;
};

export function getChatConfig(env: ChatEnv): ChatConfig {
  return {
    // Mirror of apps/web/lib/coomander/coomanderChat.ts MODEL fallback.
    model: env.CHAT_MODEL || "claude-sonnet-4-6",
    maxTokens: parseInt(env.CHAT_MAX_TOKENS || "600", 10),
    // Mirror of coomanderChat.ts recentTurns(userId, 20).
    contextWindowSize: 20,
  };
}

/** One Coomander tool definition as served by /api/coomander/agent-context. */
export interface AgentContextTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Per-turn chat context rendered by the web app (the source of truth). */
export interface AgentContext {
  /**
   * Whether Coomander ops is enabled for this user (the coomanderEnabled gate).
   * False → refuse the turn (the user must enable Coomander first).
   */
  entitled: boolean;
  /** The user's local today, YYYY-MM-DD. */
  today: string;
  model: string;
  maxTokens: number;
  /** Fully rendered Coomander system prompt (live ops context baked in). */
  systemPrompt: string;
  /** Coomander domain tools (log_drop, advance_content_state, …) to expose. */
  tools: AgentContextTool[];
  /**
   * Capability + dispatch fields for the resolved model (#203 Phase B). The web
   * app resolves the active catalog entry (admin switcher / per-user pref) and
   * passes these so the agent can gate tools per model and dispatch the right
   * provider client. Optional — older web builds (or a fallback resolution) may
   * omit them, so the agent defaults conservatively (tools/images on, look the
   * provider up from the catalog by model id).
   */
  supportsTools: boolean;
  supportsImages: boolean;
  tier?: ModelTier;
  provider?: ModelProvider;
}

/** Web app failed to render the chat context (unreachable / 5xx / bad shape). */
export class AgentContextUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentContextUnavailableError";
  }
}

/**
 * Fetch the per-turn Coomander context from the web app, acting as the user.
 * Throws AgentContextUnavailableError when the web app can't answer — callers
 * report a user-safe error frame, never run the model with a guessed prompt.
 */
export async function fetchAgentContext(env: Env, cookie: string): Promise<AgentContext> {
  let res: Response;
  try {
    res = await callAsUser(env, cookie, "/api/coomander/agent-context", { method: "GET" });
  } catch (err) {
    throw new AgentContextUnavailableError(
      `agent-context unreachable: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!res.ok) {
    throw new AgentContextUnavailableError(`agent-context failed: ${res.status}`);
  }
  const data = (await res.json().catch(() => null)) as Partial<AgentContext> | null;
  if (!data || typeof data.systemPrompt !== "string" || !data.systemPrompt) {
    throw new AgentContextUnavailableError("agent-context returned no system prompt");
  }
  const fallback = getChatConfig(env);
  return {
    entitled: data.entitled === true,
    today: typeof data.today === "string" ? data.today : "",
    model: typeof data.model === "string" && data.model ? data.model : fallback.model,
    maxTokens:
      typeof data.maxTokens === "number" && data.maxTokens > 0
        ? data.maxTokens
        : fallback.maxTokens,
    systemPrompt: data.systemPrompt,
    tools: Array.isArray(data.tools)
      ? data.tools.filter(
          (t): t is AgentContextTool =>
            !!t &&
            typeof (t as AgentContextTool).name === "string" &&
            typeof (t as AgentContextTool).description === "string" &&
            typeof (t as AgentContextTool).input_schema === "object"
        )
      : [],
    // Capability/dispatch flags — default conservatively when the web app omits
    // them: tools + images on (Claude defaults), provider/tier left undefined so
    // the chat loop resolves the catalog entry by model id.
    supportsTools: data.supportsTools !== false,
    supportsImages: data.supportsImages !== false,
    tier: typeof data.tier === "string" ? data.tier : undefined,
    provider: typeof data.provider === "string" ? data.provider : undefined,
  };
}

/**
 * Strip backend "system tags" ([PROFILE:]/[STEP_*:]) from text that gets
 * persisted and sent on the `done` frame — but PRESERVE rich-block markers
 * ([CHART:]/[IMAGE:]) so inline charts/images survive persistence and
 * re-render when the conversation reloads. Delegates to the single shared
 * implementation in @coomander/core so every surface stays in sync — mirrors
 * apps/web/lib/chat-tags.ts.
 */
export { stripSystemTags as stripTags } from "@coomander/core";
