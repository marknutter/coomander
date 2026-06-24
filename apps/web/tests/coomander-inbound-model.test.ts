import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks for the collaborators resolveInboundModel calls. ---
// We mock these so we can drive every branch of the resolution logic purely
// from the spec, never touching the implementation under test.
vi.mock("@/lib/active-model", () => ({
  resolveActiveModelId: vi.fn(),
}));
vi.mock("@/lib/model-catalog", () => ({
  getModel: vi.fn(),
}));

import {
  resolveInboundModel,
  ANTHROPIC_FALLBACK_ID,
} from "@/lib/coomander/inbound-model";
import { resolveActiveModelId } from "@/lib/active-model";
import { getModel } from "@/lib/model-catalog";
import { inboundTools } from "@/lib/coomander/inbound";

const mockResolveActiveModelId = vi.mocked(resolveActiveModelId);
const mockGetModel = vi.mocked(getModel);

// Minimal catalog-entry shape factory. resolveInboundModel only ever inspects
// id / provider / supportsTools, so that's all we populate. Cast through unknown
// since the real ModelCatalogEntry has many more fields we don't care about.
function entry(
  partial: { id: string; provider: string; supportsTools: boolean },
): ReturnType<typeof getModel> {
  return partial as unknown as ReturnType<typeof getModel>;
}

describe("resolveInboundModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports ANTHROPIC_FALLBACK_ID defaulting to claude-sonnet-4-6", () => {
    expect(typeof ANTHROPIC_FALLBACK_ID).toBe("string");
    expect(ANTHROPIC_FALLBACK_ID).toBe("claude-sonnet-4-6");
  });

  it("case 1: anthropic + tool-capable model resolves directly, no fallback", async () => {
    mockResolveActiveModelId.mockResolvedValue("claude-opus-4-8");
    mockGetModel.mockReturnValue(
      entry({ id: "claude-opus-4-8", provider: "anthropic", supportsTools: true }),
    );

    const result = await resolveInboundModel("user-1");

    expect(result.provider).toBe("anthropic");
    expect(result.resolvedId).toBe("claude-opus-4-8");
    expect(result.fellBack).toBe(false);
    expect(mockResolveActiveModelId).toHaveBeenCalledWith({ userId: "user-1" });
  });

  it("case 2: chosen model lacks tool support → falls back to Anthropic fallback", async () => {
    mockResolveActiveModelId.mockResolvedValue(
      "@cf/meta/llama-4-scout-17b-16e-instruct",
    );
    mockGetModel.mockReturnValue(
      entry({
        id: "@cf/meta/llama-4-scout-17b-16e-instruct",
        provider: "cloudflare",
        supportsTools: false,
      }),
    );

    const result = await resolveInboundModel("user-1");

    expect(result.provider).toBe("anthropic");
    expect(result.resolvedId).toBe(ANTHROPIC_FALLBACK_ID);
    // Chosen id !== fallback id, so this counts as a fallback.
    expect(result.fellBack).toBe(true);
  });

  it("case 3: unknown catalog id (getModel undefined) → falls back to Anthropic fallback", async () => {
    mockResolveActiveModelId.mockResolvedValue("totally-made-up-model");
    mockGetModel.mockReturnValue(undefined);

    const result = await resolveInboundModel("user-1");

    expect(result.provider).toBe("anthropic");
    expect(result.resolvedId).toBe(ANTHROPIC_FALLBACK_ID);
    expect(result.fellBack).toBe(true);
  });

  it("case 4: resolveActiveModelId rejects → uses fallback id as chosen, not a fallback", async () => {
    mockResolveActiveModelId.mockRejectedValue(new Error("db down"));
    // The impl catches the rejection and uses ANTHROPIC_FALLBACK_ID as the
    // chosen id, so getModel is asked for the fallback entry.
    mockGetModel.mockImplementation((id: string) =>
      id === ANTHROPIC_FALLBACK_ID
        ? entry({
            id: ANTHROPIC_FALLBACK_ID,
            provider: "anthropic",
            supportsTools: true,
          })
        : undefined,
    );

    const result = await resolveInboundModel("user-1");

    expect(result.provider).toBe("anthropic");
    expect(result.resolvedId).toBe(ANTHROPIC_FALLBACK_ID);
    // Chosen id === fallback id, so this is NOT counted as a fallback.
    expect(result.fellBack).toBe(false);
  });

  // KNOWN LIMITATION: the impl reads the Workers AI binding via a CommonJS
  // require("@opennextjs/cloudflare") that vi.mock cannot intercept. In the
  // vitest (node) env, getCloudflareContext() throws and the binding resolves
  // to null, so the cloudflare branch always falls back here. The "Workers AI
  // binding PRESENT" success branch is therefore NOT unit-testable in this env
  // (it is verified in prod instead). This case asserts the binding-ABSENT
  // fallback path.
  it("case 5: cloudflare + tool-capable but no env.AI binding → falls back to Anthropic fallback", async () => {
    mockResolveActiveModelId.mockResolvedValue(
      "@cf/meta/llama-4-scout-17b-16e-instruct",
    );
    mockGetModel.mockReturnValue(
      entry({
        id: "@cf/meta/llama-4-scout-17b-16e-instruct",
        provider: "cloudflare",
        supportsTools: true,
      }),
    );

    const result = await resolveInboundModel("user-1");

    expect(result.provider).toBe("anthropic");
    expect(result.resolvedId).toBe(ANTHROPIC_FALLBACK_ID);
    expect(result.fellBack).toBe(true);
  });

  it("case 6: unwired provider (openai) → falls back to Anthropic fallback", async () => {
    mockResolveActiveModelId.mockResolvedValue("x");
    mockGetModel.mockReturnValue(
      entry({ id: "x", provider: "openai", supportsTools: true }),
    );

    const result = await resolveInboundModel("user-1");

    expect(result.provider).toBe("anthropic");
    expect(result.resolvedId).toBe(ANTHROPIC_FALLBACK_ID);
    expect(result.fellBack).toBe(true);
  });
});

// --- Part B: inboundTools() zod input schemas. ---

const TOOL_NAMES = [
  "log_drop",
  "advance_content_state",
  "log_purchase",
  "add_procurement_item",
  "mark_blocker",
  "adjust_beat",
  "need_clarification",
] as const;

type ZodLike = { safeParse: (input: unknown) => { success: boolean } };

// Locate the zod schema retained on a Vercel AI SDK tool object. In current
// SDK versions it is `.inputSchema`, but guard against version drift by probing
// known alternates (`.parameters`) before failing loudly.
function schemaFor(name: (typeof TOOL_NAMES)[number]): ZodLike {
  const tool = inboundTools()[name] as Record<string, unknown>;
  const candidate =
    (tool.inputSchema as unknown) ??
    (tool.parameters as unknown) ??
    undefined;
  if (candidate && typeof (candidate as ZodLike).safeParse === "function") {
    return candidate as ZodLike;
  }
  throw new Error(
    `Could not locate zod schema for tool "${name}". Tool object keys: ${Object.keys(
      tool,
    ).join(", ")}`,
  );
}

function parses(name: (typeof TOOL_NAMES)[number], input: unknown): boolean {
  return schemaFor(name).safeParse(input).success;
}

describe("inboundTools()", () => {
  it("exposes exactly the 7 expected tool names", () => {
    expect(Object.keys(inboundTools()).sort()).toEqual([...TOOL_NAMES].sort());
  });

  describe("log_drop schema", () => {
    it("parses with required beat_id + valid kind", () => {
      expect(parses("log_drop", { beat_id: "b", kind: "shipped" })).toBe(true);
    });
    it("fails when beat_id is missing", () => {
      expect(parses("log_drop", { kind: "shipped" })).toBe(false);
    });
    it("accepts the other valid kinds", () => {
      expect(parses("log_drop", { beat_id: "b", kind: "captured" })).toBe(true);
      expect(parses("log_drop", { beat_id: "b", kind: "completed" })).toBe(true);
    });
    it("fails on an invalid kind", () => {
      expect(parses("log_drop", { beat_id: "b", kind: "bogus" })).toBe(false);
    });
    it("accepts optional count/platform/notes", () => {
      // platform is an enum (ig/tiktok/fb/snap/of) — use a valid member so this
      // verifies optionality, not the enum constraint.
      expect(
        parses("log_drop", {
          beat_id: "b",
          kind: "shipped",
          count: 2,
          platform: "tiktok",
          notes: "n",
        }),
      ).toBe(true);
    });
  });

  describe("advance_content_state schema", () => {
    it("parses with content_id + new_state", () => {
      expect(
        parses("advance_content_state", { content_id: "c", new_state: "shot" }),
      ).toBe(true);
    });
    it("fails without content_id", () => {
      expect(parses("advance_content_state", { new_state: "shot" })).toBe(false);
    });
    it("fails without new_state", () => {
      expect(parses("advance_content_state", { content_id: "c" })).toBe(false);
    });
    it("accepts optional notes", () => {
      expect(
        parses("advance_content_state", {
          content_id: "c",
          new_state: "shot",
          notes: "n",
        }),
      ).toBe(true);
    });
  });

  describe("log_purchase schema", () => {
    it("parses with procurement_item_id", () => {
      expect(parses("log_purchase", { procurement_item_id: "p" })).toBe(true);
    });
    it("fails without procurement_item_id", () => {
      expect(parses("log_purchase", {})).toBe(false);
    });
    it("accepts optional actual_cost/notes", () => {
      expect(
        parses("log_purchase", {
          procurement_item_id: "p",
          actual_cost: 12.5,
          notes: "n",
        }),
      ).toBe(true);
    });
  });

  describe("add_procurement_item schema", () => {
    it("parses with valid category + label", () => {
      expect(
        parses("add_procurement_item", {
          category: "shoot_prep",
          label: "ring light",
        }),
      ).toBe(true);
      expect(
        parses("add_procurement_item", {
          category: "business_admin",
          label: "filing",
        }),
      ).toBe(true);
    });
    it("fails without category", () => {
      expect(parses("add_procurement_item", { label: "ring light" })).toBe(false);
    });
    it("fails without label", () => {
      expect(parses("add_procurement_item", { category: "shoot_prep" })).toBe(
        false,
      );
    });
    it("fails on an invalid category", () => {
      expect(
        parses("add_procurement_item", { category: "misc", label: "x" }),
      ).toBe(false);
    });
    it("accepts optional needed_by/notes", () => {
      expect(
        parses("add_procurement_item", {
          category: "shoot_prep",
          label: "ring light",
          needed_by: "2026-06-25",
          notes: "n",
        }),
      ).toBe(true);
    });
  });

  describe("mark_blocker schema", () => {
    it("parses with reason only", () => {
      expect(parses("mark_blocker", { reason: "sick" })).toBe(true);
    });
    it("fails without reason", () => {
      expect(parses("mark_blocker", {})).toBe(false);
    });
    it("accepts optional beat_id", () => {
      expect(parses("mark_blocker", { reason: "sick", beat_id: "b" })).toBe(true);
    });
  });

  describe("adjust_beat schema", () => {
    it("parses with beat_id only", () => {
      expect(parses("adjust_beat", { beat_id: "b" })).toBe(true);
    });
    it("fails without beat_id", () => {
      expect(parses("adjust_beat", {})).toBe(false);
    });
    it("accepts optional target_count", () => {
      expect(parses("adjust_beat", { beat_id: "b", target_count: 5 })).toBe(true);
    });
  });

  describe("need_clarification schema", () => {
    it("parses with reply", () => {
      expect(parses("need_clarification", { reply: "huh?" })).toBe(true);
    });
    it("fails without reply", () => {
      expect(parses("need_clarification", {})).toBe(false);
    });
  });
});
