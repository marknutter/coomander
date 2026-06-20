/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { describe, it, expect } from "vitest";
import {
  dedupeWorkersAiSseLine,
  agentAnthropicGatewayBaseURL,
  resolveAgentModel,
} from "../src/chat-model";
import { getModel, DEFAULT_MODEL_ID, type ModelCatalogEntry } from "@coomander/core";
import type { Env } from "../src/index";

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for the PURE half of the agent's multi-provider model resolution
// (epic #203, src/chat-model.ts). Tested against the SPEC contract:
//
//   - dedupeWorkersAiSseLine(line): strip workers-ai-provider's double-emitted
//     native `response` field from any SSE chunk that ALSO carries `choices`;
//     leave every other line untouched.
//   - agentAnthropicGatewayBaseURL(env): the AI-Gateway Anthropic base URL (with
//     the load-bearing trailing `/v1`) or undefined when unconfigured.
//   - resolveAgentModel(entry, env): dispatch a catalog entry to an AI-SDK
//     LanguageModel, with the documented fallbacks to the default Claude.
//
// NOTE: Coomander's agent does NOT fetch the active model (the web app's
// agent-context route resolves it per turn — #203 Phase B), so there is no
// `fetchActiveModel` to test here (unlike the AppSeed agent).
// ─────────────────────────────────────────────────────────────────────────────

/** Build a minimal Env with only the fields a given test cares about. */
function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    AppAgent: {} as never,
    ANTHROPIC_API_KEY: "sk-test",
    ...overrides,
  } as Env;
}

/** A fake Workers AI binding stub — resolveAgentModel only checks truthiness. */
function fakeAiBinding(): Ai {
  return { run: async () => ({}) } as unknown as Ai;
}

// ── dedupeWorkersAiSseLine ───────────────────────────────────────────────────

describe("dedupeWorkersAiSseLine", () => {
  it("strips `response` from a chunk that ALSO has `choices` (keeps choices)", () => {
    const line = `data: ${JSON.stringify({
      response: "Paris",
      choices: [{ delta: { content: "Paris" } }],
    })}`;
    const out = dedupeWorkersAiSseLine(line);
    const json = JSON.parse(out.slice(5));
    expect("response" in json).toBe(false);
    expect(json.choices[0].delta.content).toBe("Paris");
  });

  it("leaves a choices-only chunk (no response) unchanged", () => {
    const line = `data: ${JSON.stringify({ choices: [{ delta: { content: "x" } }] })}`;
    expect(dedupeWorkersAiSseLine(line)).toBe(line);
  });

  it("leaves a response-only chunk (no choices) unchanged", () => {
    const line = `data: ${JSON.stringify({ response: "Paris" })}`;
    expect(dedupeWorkersAiSseLine(line)).toBe(line);
  });

  it("passes through non-data lines, [DONE], blank, comment, and malformed-JSON lines", () => {
    expect(dedupeWorkersAiSseLine("event: message")).toBe("event: message");
    expect(dedupeWorkersAiSseLine("data: [DONE]")).toBe("data: [DONE]");
    expect(dedupeWorkersAiSseLine("")).toBe("");
    expect(dedupeWorkersAiSseLine(": keep-alive")).toBe(": keep-alive");
    expect(dedupeWorkersAiSseLine("data: not-json{")).toBe("data: not-json{");
  });
});

// ── agentAnthropicGatewayBaseURL ─────────────────────────────────────────────

describe("agentAnthropicGatewayBaseURL", () => {
  it("returns undefined when neither account id nor gateway id is set", () => {
    expect(agentAnthropicGatewayBaseURL(makeEnv())).toBeUndefined();
  });

  it("returns undefined when only one of the two is set", () => {
    expect(
      agentAnthropicGatewayBaseURL(makeEnv({ CLOUDFLARE_ACCOUNT_ID: "acct123" })),
    ).toBeUndefined();
    expect(
      agentAnthropicGatewayBaseURL(makeEnv({ AI_GATEWAY_ID: "gw123" })),
    ).toBeUndefined();
  });

  it("interpolates acct/gw and ends in the load-bearing trailing /v1 when both are set", () => {
    const url = agentAnthropicGatewayBaseURL(
      makeEnv({ CLOUDFLARE_ACCOUNT_ID: "acct123", AI_GATEWAY_ID: "coomander" }),
    );
    expect(url).toBe(
      "https://gateway.ai.cloudflare.com/v1/acct123/coomander/anthropic/v1",
    );
    expect(url!.endsWith("/anthropic/v1")).toBe(true);
  });
});

// ── resolveAgentModel dispatch + fallbacks ───────────────────────────────────

describe("resolveAgentModel", () => {
  it("an anthropic entry resolves with resolvedId === entry.id", () => {
    const entry = getModel("claude-opus-4-8")!;
    const { resolvedId } = resolveAgentModel(entry, makeEnv());
    expect(resolvedId).toBe("claude-opus-4-8");
  });

  it("a cloudflare entry WITH env.AI resolves to the workers model (resolvedId === entry.id)", () => {
    const entry = getModel("@cf/meta/llama-3.1-8b-instruct-fp8")!;
    const { resolvedId } = resolveAgentModel(entry, makeEnv({ AI: fakeAiBinding() }));
    expect(resolvedId).toBe("@cf/meta/llama-3.1-8b-instruct-fp8");
  });

  it("a cloudflare entry WITHOUT env.AI falls back to the default Claude", () => {
    const entry = getModel("@cf/meta/llama-3.1-8b-instruct-fp8")!;
    const { resolvedId } = resolveAgentModel(entry, makeEnv()); // no env.AI
    expect(resolvedId).toBe(DEFAULT_MODEL_ID);
    expect(resolvedId).not.toBe(entry.id);
  });

  it("DEFAULT_MODEL_ID is itself an anthropic (Claude) catalog entry", () => {
    const def = getModel(DEFAULT_MODEL_ID)!;
    expect(def.provider).toBe("anthropic");
    expect(def.id.startsWith("claude")).toBe(true);
  });

  it("a synthetic openai entry falls back to the default Claude", () => {
    const synthetic: ModelCatalogEntry = {
      ...getModel(DEFAULT_MODEL_ID)!,
      id: "gpt-synthetic",
      provider: "openai",
    };
    expect(resolveAgentModel(synthetic, makeEnv()).resolvedId).toBe(DEFAULT_MODEL_ID);
  });

  it("a synthetic google entry falls back to the default Claude", () => {
    const synthetic: ModelCatalogEntry = {
      ...getModel(DEFAULT_MODEL_ID)!,
      id: "gemini-synthetic",
      provider: "google",
    };
    expect(resolveAgentModel(synthetic, makeEnv()).resolvedId).toBe(DEFAULT_MODEL_ID);
  });
});
