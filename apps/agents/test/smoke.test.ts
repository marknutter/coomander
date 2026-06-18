/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { describe, it, expect } from "vitest";
import { parseClientFrame, COOMANDER_CONVERSATION_ID } from "../src/chat";

// Skeleton vitest-pool-workers test — wires up the workerd/miniflare pool so the
// AppAgent Durable Object + its SQLite state behave as in production. Real
// coverage (pure functions, auth-gate routing, hibernation attachment, chat
// loop, proactive persist-then-deliver) is written by a separate test subagent
// against the spec, per the testing-requirements rule. This file just proves the
// harness boots and the src modules import cleanly inside workerd.

describe("agents worker harness", () => {
  it("imports the chat module and exposes the conversation sentinel", () => {
    expect(COOMANDER_CONVERSATION_ID).toBe("coomander");
  });

  it("parses a valid chat frame", () => {
    const frame = parseClientFrame(
      JSON.stringify({ type: "chat", conversationId: "coomander", message: "hi" }),
    );
    expect(frame).toEqual({
      type: "chat",
      conversationId: "coomander",
      message: "hi",
      userContext: undefined,
    });
  });
});
