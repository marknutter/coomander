import { describe, it, expect } from "vitest";
import {
  getModel,
  isValidModelId,
  listModels,
  listUserSelectableModels,
  DEFAULT_MODEL_ID,
  DEFAULT_OPEN_MODEL_ID,
} from "@/lib/model-catalog";

// ---------------------------------------------------------------------------
// Model catalog (#203) — the single source of truth for known models. Pure,
// platform-agnostic; lives in @coomander/core and is re-exported via
// @/lib/model-catalog. Tested against the behavioral spec, not internals.
// ---------------------------------------------------------------------------

describe("model-catalog — getModel", () => {
  it("returns a byok/anthropic entry for claude-sonnet-4-6 (tools + 200k context)", () => {
    const entry = getModel("claude-sonnet-4-6");
    expect(entry).toBeDefined();
    expect(entry?.id).toBe("claude-sonnet-4-6");
    expect(entry?.tier).toBe("byok");
    expect(entry?.provider).toBe("anthropic");
    expect(entry?.supportsTools).toBe(true);
    expect(entry?.contextWindow).toBe(200_000);
  });

  it("returns a workers-ai/cloudflare entry for the 8b Llama (no tools)", () => {
    const entry = getModel("@cf/meta/llama-3.1-8b-instruct-fp8");
    expect(entry).toBeDefined();
    expect(entry?.id).toBe("@cf/meta/llama-3.1-8b-instruct-fp8");
    expect(entry?.tier).toBe("workers-ai");
    expect(entry?.provider).toBe("cloudflare");
    expect(entry?.supportsTools).toBe(false);
  });

  it("returns undefined for an unknown id", () => {
    expect(getModel("nonexistent")).toBeUndefined();
    expect(getModel("")).toBeUndefined();
  });
});

describe("model-catalog — isValidModelId", () => {
  it("is true for a known id and false for an unknown id", () => {
    expect(isValidModelId("claude-sonnet-4-6")).toBe(true);
    expect(isValidModelId("nonexistent")).toBe(false);
    expect(isValidModelId("")).toBe(false);
  });

  it("agrees with getModel for every catalog entry", () => {
    for (const m of listModels()) {
      expect(isValidModelId(m.id)).toBe(true);
      expect(getModel(m.id)).toBeDefined();
    }
  });
});

describe("model-catalog — composition (3 Claude BYOK + 9 Workers AI = 12)", () => {
  it("has exactly 12 entries total", () => {
    expect(listModels()).toHaveLength(12);
  });

  it("has exactly 3 byok/anthropic Claude entries", () => {
    const claude = listModels().filter(
      (m) => m.tier === "byok" && m.provider === "anthropic",
    );
    expect(claude).toHaveLength(3);
  });

  it("has exactly 9 workers-ai/cloudflare entries", () => {
    const workersAi = listModels().filter(
      (m) => m.tier === "workers-ai" && m.provider === "cloudflare",
    );
    expect(workersAi).toHaveLength(9);
  });
});

describe("model-catalog — defaults", () => {
  it("DEFAULT_MODEL_ID is claude-sonnet-4-6 and a valid catalog id", () => {
    expect(DEFAULT_MODEL_ID).toBe("claude-sonnet-4-6");
    expect(isValidModelId(DEFAULT_MODEL_ID)).toBe(true);
  });

  it("DEFAULT_OPEN_MODEL_ID is the 8b Llama and a valid catalog id", () => {
    expect(DEFAULT_OPEN_MODEL_ID).toBe("@cf/meta/llama-3.1-8b-instruct-fp8");
    expect(isValidModelId(DEFAULT_OPEN_MODEL_ID)).toBe(true);
  });

  it("DEFAULT_OPEN_MODEL_ID's entry is a tool-free workers-ai model", () => {
    const entry = getModel(DEFAULT_OPEN_MODEL_ID);
    expect(entry).toBeDefined();
    expect(entry?.tier).toBe("workers-ai");
    expect(entry?.supportsTools).toBe(false);
  });
});

describe("model-catalog — documented tool-refusing outlier", () => {
  it("llama-3.3-70b-instruct-fp8-fast is supportsTools: false", () => {
    const entry = getModel("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    expect(entry).toBeDefined();
    expect(entry?.supportsTools).toBe(false);
  });
});

describe("model-catalog — listUserSelectableModels", () => {
  it("returns only entries flagged userSelectable", () => {
    const selectable = listUserSelectableModels();
    expect(selectable.length).toBeGreaterThan(0);
    for (const m of selectable) {
      expect(m.userSelectable).toBe(true);
    }
  });

  it("is a subset of listModels and excludes non-user-selectable entries", () => {
    const all = listModels();
    const selectable = listUserSelectableModels();
    expect(selectable.length).toBeLessThanOrEqual(all.length);
    // every entry whose userSelectable is true appears in the selectable list
    const selectableIds = new Set(selectable.map((m) => m.id));
    for (const m of all) {
      if (m.userSelectable) expect(selectableIds.has(m.id)).toBe(true);
      else expect(selectableIds.has(m.id)).toBe(false);
    }
  });
});
