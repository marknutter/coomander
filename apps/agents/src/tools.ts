import type { AgentTool, ToolContext } from "./types";
import type { AgentContextTool } from "./chat-config";
import { callAsUser } from "./web-api";

/**
 * Tools the model can call during a Coomander chat turn.
 *
 * ⚠️ ADAPTED from the template: Coomander's domain tools (log_drop,
 * advance_content_state, …) are NOT defined here. Their schemas come from
 * GET /api/coomander/agent-context each turn, and `makeCoomanderTool` wraps each
 * one in a thin proxy that executes it web-side via POST /api/coomander/agent-tool
 * (cookie-authed — acts AS the user through the exact same resolver/write path
 * the in-app chat (handleChatTurn) uses). The Worker owns transport and the
 * loop, never the product logic.
 *
 * `schedule_followup` stays Worker-side because it manipulates the Durable
 * Object's own schedule (Agents SDK alarms) — that genuinely lives here.
 */

/**
 * Wrap one web-served Coomander tool definition in a proxy handler. The web
 * route returns `{ action, note }`: the `note` becomes the tool_result the
 * model sees; the `action` is reported through `onAction` so the chat loop can
 * persist it in the assistant turn's meta.
 */
export function makeCoomanderTool(
  def: AgentContextTool,
  onAction?: (action: string) => void
): AgentTool {
  return {
    name: def.name,
    description: def.description,
    input_schema: def.input_schema,
    handler: async (input, ctx: ToolContext) => {
      if (!ctx.cookie) {
        throw new Error(`${def.name} requires an interactive session (no cookie on this turn).`);
      }
      const res = await callAsUser(ctx.env, ctx.cookie, "/api/coomander/agent-tool", {
        method: "POST",
        body: JSON.stringify({ name: def.name, input }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`${def.name} failed (${res.status}): ${detail}`);
      }
      const data = (await res.json().catch(() => null)) as {
        action?: string;
        note?: string;
      } | null;
      if (data?.action) onAction?.(data.action);
      return data?.note ?? "Done.";
    },
  };
}

/**
 * AI image generation (#222 follow-up). The model calls this tool, then emits
 * an `[IMAGE:{"key":"<key>","alt":"<desc>"}]` marker so the rich-block pipeline
 * (chat-blocks.tsx → ChatImage) renders the image served from the auth-gated
 * `/api/images/<key>` route.
 *
 * Pipeline:
 *   1. Generate via Cloudflare Workers AI `@cf/black-forest-labs/flux-1-schnell`
 *      over the DIRECT Workers AI REST endpoint (not the AI Gateway — the
 *      dev/prod gateways are configured for the chat providers and their
 *      workers-ai route needs gateway-level auth not provisioned for images,
 *      whereas the direct endpoint needs only the account id + a
 *      Workers-AI-scoped token and works identically in dev and prod).
 *   2. flux-1-schnell returns base64-encoded image bytes (JPEG) inside the
 *      standard Cloudflare envelope `{ result: { image } }` (the provider
 *      endpoint may also return `{ image }` directly, or raw image bytes — all
 *      three are handled). Decode to bytes.
 *   3. Store by POSTing the bytes to the web app over the service binding as the
 *      user (`callAsUser` → `/api/images`); the web app writes R2 under an
 *      auth-scoped key and returns `{ key }`.
 *   4. Return `{ key, alt }` so the model can echo them into the `[IMAGE:]` marker.
 *
 * Failures (missing config, provider error, empty image, store failure) throw a
 * clear Error — the chat loop surfaces it to the model as a tool error so it can
 * explain to the user, rather than silently succeeding.
 */

/** flux-1-schnell via the direct Cloudflare Workers AI REST endpoint. */
const FLUX_MODEL = "@cf/black-forest-labs/flux-1-schnell";

/**
 * Soft per-conversation generation cap (minimal abuse guard). In-memory, keyed
 * by `userId:conversationId`; resets on DO eviction — that's acceptable for a
 * soft ceiling (it bounds a single live conversation, not lifetime usage). The
 * count only increments on a SUCCESSFUL generation, so failed attempts don't
 * burn the quota; the chat loop's MAX_TOOL_ITERATIONS already bounds retries
 * within a single turn. The AUTHORITATIVE per-user/day cap is enforced web-side
 * in POST /api/images (this route is directly callable and bypassable by
 * opening new conversations, so the real ceiling has to live there).
 */
const MAX_IMAGES_PER_CONVERSATION = 4;
const imageGenCounts = new Map<string, number>();

/**
 * Build the DIRECT Workers AI run endpoint for the flux model. We call Workers
 * AI directly rather than via the AI Gateway: the dev/prod gateways are set up
 * for the chat providers and the workers-ai route needs gateway-level auth we
 * don't provision for images, whereas the direct endpoint needs only the
 * account id + a Workers-AI-scoped API token and works identically in dev and
 * prod.
 */
function fluxRunUrl(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${FLUX_MODEL}`;
}

/** Decode a base64 string to bytes (workerd has a global atob). */
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Short alt/caption derived from the prompt (kept compact for the marker). */
function captionFromPrompt(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;
}

export const generateImageTool: AgentTool = {
  name: "generate_image",
  description:
    "Generate an image from a text prompt using an AI image model. Use when the " +
    "user asks to draw, create, generate, or imagine a picture/image/illustration. " +
    "After calling this, include an [IMAGE:{\"key\":\"<key returned by this tool>\"," +
    "\"alt\":\"<short description>\"}] marker in your reply so the image renders.",
  input_schema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "A detailed description of the image to generate (required, 1–2048 chars).",
      },
      aspect: {
        type: "string",
        enum: ["square", "portrait", "landscape"],
        description:
          "Optional desired composition. flux-1-schnell does not take explicit " +
          "dimensions, so this is folded into the prompt as a framing hint.",
      },
    },
    required: ["prompt"],
  },
  handler: async (input, ctx) => {
    // 1. Require an interactive session — storing the image acts AS the user.
    if (!ctx.cookie) {
      throw new Error(
        "generate_image requires an interactive session (no cookie on this turn).",
      );
    }

    const prompt = String(input.prompt ?? "").trim();
    if (!prompt) {
      throw new Error("generate_image requires a non-empty prompt.");
    }

    // 2. Enforce the soft per-conversation cap before doing any paid work.
    const rlKey = `${ctx.userId}:${ctx.conversationId ?? "_"}`;
    const used = imageGenCounts.get(rlKey) ?? 0;
    if (used >= MAX_IMAGES_PER_CONVERSATION) {
      throw new Error(
        `Image generation limit reached for this conversation (max ` +
          `${MAX_IMAGES_PER_CONVERSATION}). Tell the user to start a new ` +
          `conversation to generate more images.`,
      );
    }

    // 3. Resolve the account id + a Workers-AI-scoped Cloudflare API token
    //    (separate from the AI Gateway config the chat loop uses — see the
    //    module doc comment above for why this calls Workers AI directly).
    const accountId = ctx.env.CLOUDFLARE_ACCOUNT_ID;
    const cfToken = ctx.env.CLOUDFLARE_API_TOKEN;
    if (!accountId) {
      throw new Error(
        "Image generation is not configured: CLOUDFLARE_ACCOUNT_ID must be set " +
          "on the agents worker.",
      );
    }
    if (!cfToken) {
      throw new Error(
        "Image generation is not configured: CLOUDFLARE_API_TOKEN (a Cloudflare " +
          "API token with 'Workers AI: Read') must be set on the agents worker.",
      );
    }

    // flux-1-schnell takes only `prompt` (+ a fixed 4-step count) on this
    // endpoint — no width/height — so fold the optional aspect into the prompt.
    const aspect = typeof input.aspect === "string" ? input.aspect : undefined;
    const aspectHint =
      aspect === "portrait"
        ? ", portrait orientation (tall framing)"
        : aspect === "landscape"
          ? ", landscape orientation (wide framing)"
          : aspect === "square"
            ? ", square composition"
            : "";
    const fullPrompt = `${prompt}${aspectHint}`.slice(0, 2048);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${cfToken}`,
      "Content-Type": "application/json",
    };

    // 4. Call Workers AI flux over the direct REST endpoint → image bytes.
    let genRes: Response;
    try {
      genRes = await fetch(fluxRunUrl(accountId), {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: fullPrompt }),
      });
    } catch (err) {
      throw new Error(
        `Image generation request failed to reach Workers AI: ${String(err)}`,
      );
    }
    if (!genRes.ok) {
      const detail = await genRes.text().catch(() => "");
      throw new Error(
        `Image generation failed (${genRes.status}): ${detail.slice(0, 300)}`,
      );
    }

    // The flux provider endpoint returns the CF envelope { result: { image } }
    // (base64). Some routes return { image } directly, or raw image bytes — all
    // three are handled so a provider-shape change degrades to a clear error,
    // never a silent empty success.
    // Explicitly parameterized (Uint8Array<ArrayBuffer>, not the default
    // ArrayBufferLike) so it satisfies fetch's BodyInit below — both branches
    // construct a Uint8Array backed by a concrete ArrayBuffer.
    let bytes: Uint8Array<ArrayBuffer>;
    const contentType = genRes.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = (await genRes.json().catch(() => null)) as
        | { result?: { image?: unknown }; image?: unknown }
        | null;
      const b64 =
        (typeof data?.result?.image === "string" && data.result.image) ||
        (typeof data?.image === "string" && data.image) ||
        "";
      if (!b64) {
        throw new Error(
          "Image generation returned no image data (empty result from flux-1-schnell).",
        );
      }
      bytes = base64ToBytes(b64);
    } else {
      bytes = new Uint8Array(await genRes.arrayBuffer());
    }
    if (bytes.length === 0) {
      throw new Error("Image generation returned an empty image.");
    }

    // 5. Store the bytes via the web app (as the user) → auth-scoped R2 key.
    const storeRes = await callAsUser(ctx.env, ctx.cookie, "/api/images", {
      method: "POST",
      body: bytes,
      headers: { "content-type": "image/png" },
    });
    if (!storeRes.ok) {
      const detail = await storeRes.text().catch(() => "");
      throw new Error(
        `Failed to store generated image (${storeRes.status}): ${detail.slice(0, 300)}`,
      );
    }
    const stored = (await storeRes.json().catch(() => null)) as
      | { key?: unknown }
      | null;
    const key = typeof stored?.key === "string" ? stored.key : "";
    if (!key) {
      throw new Error("Image store did not return a key.");
    }

    // 6. Success — bump the per-conversation count and hand back the marker data.
    imageGenCounts.set(rlKey, used + 1);
    return { key, alt: captionFromPrompt(prompt) };
  },
};

/**
 * Lets the model schedule its own proactive follow-up. The handler closes over
 * the agent so it can call `scheduleProactive`; built per-instance in
 * `AppAgent.getTools()`. `delaySeconds` keeps it simple and dev-testable
 * (1 minute out → miniflare alarm fires).
 */
export function makeScheduleFollowupTool(agent: {
  scheduleProactive: (
    when: number,
    message: string,
    conversationId?: string
  ) => Promise<string>;
}): AgentTool {
  return {
    name: "schedule_followup",
    description:
      "Schedule a proactive follow-up message to be delivered to the user after a delay. Use when the user asks to be reminded or followed up with later.",
    input_schema: {
      type: "object",
      properties: {
        delaySeconds: {
          type: "number",
          description: "How many seconds from now to deliver the follow-up.",
        },
        message: {
          type: "string",
          description: "The follow-up message to deliver to the user.",
        },
      },
      required: ["delaySeconds", "message"],
    },
    handler: async (input, ctx) => {
      const delaySeconds = Number(input.delaySeconds);
      const message = String(input.message ?? "");
      if (!Number.isFinite(delaySeconds) || delaySeconds <= 0) {
        throw new Error("delaySeconds must be a positive number.");
      }
      if (!message.trim()) {
        throw new Error("message must not be empty.");
      }
      // Pass the conversation so the wake persists the reminder into this thread.
      const id = await agent.scheduleProactive(delaySeconds, message, ctx.conversationId);
      return { scheduled: true, scheduleId: id, delaySeconds };
    },
  };
}

export type { ToolContext };
