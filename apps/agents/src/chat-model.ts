/**
 * Per-worker model resolution for the Coomander chat loop — the runtime-specific
 * half of the multi-provider engine (epic #203, ported from the AppSeed template
 * `apps/agents/src/chat-model.ts`). The PURE half (catalog, capability gating,
 * context trimming) lives in `@coomander/core`; provider-client wiring is
 * runtime-specific (env/binding access) so it stays here.
 *
 * Coomander difference vs AppSeed: the agent does NOT fetch the active model
 * here. `fetchAgentContext` (chat-config.ts) already asks the web app for the
 * resolved model id + capability flags per turn (admin switcher / per-user pref,
 * #203 Phase B), so this module only needs to MAP a catalog entry to a provider
 * client and convert tools. Two responsibilities:
 *   1. `resolveAgentModel` — map a catalog entry to a Vercel AI SDK
 *      `LanguageModel`, dispatching on provider:
 *        - anthropic → createAnthropic (pointed at the AI Gateway when enabled)
 *        - cloudflare → createWorkersAI({ binding: env.AI })
 *      If a Workers AI model is selected but env.AI is missing, fall back to the
 *      default Claude with a log (don't crash).
 *   2. `toAiSdkTools` — convert Coomander `AgentTool[]` to the AI SDK ToolSet.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createWorkersAI } from "workers-ai-provider";
import { jsonSchema, tool, type LanguageModel, type ToolSet } from "ai";
import { getModel, DEFAULT_MODEL_ID, type ModelCatalogEntry } from "@coomander/core";
import type { Env } from "./index";
import type { AgentTool, ToolContext } from "./types";
import { isAgentGatewayEnabled } from "./chat";

/**
 * workers-ai-provider@3.2.0 (the latest — no upstream fix yet) DOUBLE-emits
 * streamed text for models whose SSE chunks carry BOTH the native `response`
 * field AND the OpenAI-compat `choices[].delta.content` (e.g. Llama 3.3): its
 * stream transform runs both code paths, so every token streams twice
 * ("ParisParis"). We strip the redundant native `response` from any SSE chunk
 * that ALSO has `choices`, leaving only the OpenAI-compat path to emit. Pure +
 * exported for unit testing.
 */
export function dedupeWorkersAiSseLine(line: string): string {
  if (!line.startsWith("data:")) return line;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return line;
  try {
    const json = JSON.parse(payload) as Record<string, unknown>;
    if (json && json.choices != null && "response" in json) {
      delete json.response;
      return `data: ${JSON.stringify(json)}`;
    }
  } catch {
    /* not JSON — leave the line untouched */
  }
  return line;
}

/**
 * Wrap the Workers AI binding so its streamed SSE has the redundant `response`
 * field removed before workers-ai-provider parses it (see `dedupeWorkersAiSseLine`).
 * Only `run`'s streaming output is transformed; non-stream results and every
 * other member pass through untouched.
 */
function wrapWorkersAiBinding(ai: NonNullable<Env["AI"]>): NonNullable<Env["AI"]> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const handler: ProxyHandler<object> = {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== "run" || typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        const result = await (value as (...a: unknown[]) => unknown).apply(target, args);
        if (!(result instanceof ReadableStream)) return result;
        let buffer = "";
        return (result as ReadableStream<Uint8Array>).pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              buffer += decoder.decode(chunk, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                controller.enqueue(encoder.encode(dedupeWorkersAiSseLine(line) + "\n"));
              }
            },
            flush(controller) {
              if (buffer) controller.enqueue(encoder.encode(dedupeWorkersAiSseLine(buffer)));
            },
          }),
        );
      };
    },
  };
  return new Proxy(ai as object, handler) as NonNullable<Env["AI"]>;
}

/**
 * The Cloudflare AI Gateway base URL for the Anthropic provider, or undefined
 * when the gateway is not configured (→ direct to api.anthropic.com).
 *
 * GOTCHA — the trailing `/v1`: `@ai-sdk/anthropic` defaults its baseURL to
 * `https://api.anthropic.com/v1` and POSTs to `${baseURL}/messages`. So for the
 * gateway we must include `/v1` ourselves to land on `.../anthropic/v1/messages`
 * — the path the gateway proxies to Anthropic. (The raw `@anthropic-ai/sdk` path
 * used `.../anthropic` because that SDK appends `/v1/messages` itself; this
 * AI-SDK path must NOT.)
 */
export function agentAnthropicGatewayBaseURL(env: Env): string | undefined {
  if (!isAgentGatewayEnabled(env)) return undefined;
  return `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/anthropic/v1`;
}

/**
 * Map a catalog entry to a Vercel AI SDK `LanguageModel`, dispatching on the
 * entry's provider. Returns the resolved id alongside the model so the caller
 * can tag gateway metadata with what actually ran (which may differ from the
 * requested entry after a fallback).
 *
 * Anthropic: createAnthropic pointed at the AI Gateway when enabled (with the
 * cf-aig-authorization header when AI_GATEWAY_TOKEN is set). The Anthropic key
 * is read from env ONLY (`env.ANTHROPIC_API_KEY`) — same as the AppSeed agent;
 * the agent has no DB access, the web app owns provider-key storage.
 * Cloudflare (Workers AI): createWorkersAI({ binding: env.AI }). If env.AI is
 * missing, fall back to the default Claude (logged) rather than crashing.
 * openai/google: not wired (the catalog has no executing entries) → fall back.
 */
export function resolveAgentModel(
  entry: ModelCatalogEntry,
  env: Env,
): { model: LanguageModel; resolvedId: string } {
  switch (entry.provider) {
    case "anthropic": {
      const baseURL = agentAnthropicGatewayBaseURL(env);
      const headers: Record<string, string> = {};
      if (baseURL && env.AI_GATEWAY_TOKEN) {
        headers["cf-aig-authorization"] = `Bearer ${env.AI_GATEWAY_TOKEN}`;
      }
      const anthropic = createAnthropic({
        apiKey: env.ANTHROPIC_API_KEY,
        baseURL, // undefined → direct to api.anthropic.com
        headers: Object.keys(headers).length ? headers : undefined,
      });
      return { model: anthropic(entry.id), resolvedId: entry.id };
    }

    case "cloudflare": {
      if (env.AI) {
        // Wrap the binding to strip workers-ai-provider's double-emitted text.
        const workersai = createWorkersAI({ binding: wrapWorkersAiBinding(env.AI) as never });
        return { model: workersai(entry.id), resolvedId: entry.id };
      }
      // No Workers AI binding on this worker — degrade to the default Claude so
      // chat keeps working rather than crashing on a missing binding.
      console.warn(
        `[agents.chat-model] Workers AI model "${entry.id}" selected but env.AI ` +
          `binding is missing; falling back to ${DEFAULT_MODEL_ID}`,
      );
      return resolveAgentModel(getModel(DEFAULT_MODEL_ID)!, env);
    }

    case "openai":
    case "google":
    default: {
      // No openai/google entries execute in the catalog yet; if one is ever
      // added without wiring a provider here, fall back to the default Claude.
      console.warn(
        `[agents.chat-model] provider "${entry.provider}" not yet wired in the agent; ` +
          `falling back to ${DEFAULT_MODEL_ID}`,
      );
      return resolveAgentModel(getModel(DEFAULT_MODEL_ID)!, env);
    }
  }
}

/**
 * Map Coomander tools to the AI SDK ToolSet. Each tool's Anthropic-style
 * `input_schema` (JSON Schema object) is wrapped with `jsonSchema()`, and
 * `execute` dispatches to the original `handler(input, ctx)`, returning its
 * string/JSON result. A handler throw propagates to the SDK, which surfaces it
 * to the model as a tool error so the model can recover gracefully (same
 * contract as the old manual loop).
 */
export function toAiSdkTools(tools: AgentTool[], ctx: ToolContext): ToolSet {
  const set: ToolSet = {};
  for (const t of tools) {
    set[t.name] = tool({
      description: t.description,
      inputSchema: jsonSchema(t.input_schema as never),
      execute: async (input: unknown) =>
        t.handler((input ?? {}) as Record<string, unknown>, ctx),
    });
  }
  return set;
}
