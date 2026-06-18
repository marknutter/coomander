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
