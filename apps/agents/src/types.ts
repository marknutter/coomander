import type { Env } from "./index";

export interface ToolContext {
  /** The agent instance name == validated Better Auth user id. */
  userId: string;
  /** The requesting connection's cookie, when the turn came from a live socket. */
  cookie?: string;
  env: Env;
  /**
   * The conversation this turn belongs to — available to tools that need to tie
   * deferred work back to the thread (e.g. `schedule_followup` persists its
   * reminder into this conversation when the wake fires).
   */
  conversationId?: string;
}

export interface AgentTool {
  name: string;
  description: string;
  /** Anthropic tool `input_schema` (JSON Schema object). */
  input_schema: Record<string, unknown>;
  handler: (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}
