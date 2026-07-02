import {
  COOMANDER_CONVERSATION_ID,
  AGENT_PATH_PREFIX,
  parseServerFrame,
  encodeChatFrame,
  buildWsUrl,
  initialStreamState,
  reduce,
  resetTurn,
} from "@/lib/agent-socket-protocol";

describe("exported constants", () => {
  it("COOMANDER_CONVERSATION_ID is 'coomander'", () => {
    expect(COOMANDER_CONVERSATION_ID).toBe("coomander");
  });

  it("AGENT_PATH_PREFIX is '/agents/app-agent'", () => {
    expect(AGENT_PATH_PREFIX).toBe("/agents/app-agent");
  });
});

describe("parseServerFrame", () => {
  describe("non-string / unparseable input → null", () => {
    it("returns null for a number", () => {
      expect(parseServerFrame(5)).toBeNull();
    });

    it("returns null for an object", () => {
      expect(parseServerFrame({ type: "token", text: "hi" })).toBeNull();
    });

    it("returns null for null", () => {
      expect(parseServerFrame(null)).toBeNull();
    });

    it("returns null for undefined", () => {
      expect(parseServerFrame(undefined)).toBeNull();
    });

    it("returns null for an array", () => {
      expect(parseServerFrame([1, 2, 3])).toBeNull();
    });

    it("returns null for a boolean", () => {
      expect(parseServerFrame(true)).toBeNull();
    });

    it("returns null for an ArrayBuffer-like value", () => {
      expect(parseServerFrame(new ArrayBuffer(8))).toBeNull();
    });

    it("returns null for malformed JSON string", () => {
      expect(parseServerFrame("{not json")).toBeNull();
      expect(parseServerFrame("{")).toBeNull();
      expect(parseServerFrame("")).toBeNull();
    });
  });

  describe("valid JSON that is not an object → null", () => {
    it("returns null for a JSON number", () => {
      expect(parseServerFrame("5")).toBeNull();
    });

    it("returns null for a JSON boolean", () => {
      expect(parseServerFrame("true")).toBeNull();
    });

    it("returns null for JSON null", () => {
      expect(parseServerFrame("null")).toBeNull();
    });

    it("returns null for a JSON string literal", () => {
      expect(parseServerFrame('"hi"')).toBeNull();
    });

    it("returns null for a JSON array", () => {
      expect(parseServerFrame("[1,2,3]")).toBeNull();
    });
  });

  describe("missing / unknown type → null", () => {
    it("returns null when type is missing", () => {
      expect(parseServerFrame(JSON.stringify({ text: "hi" }))).toBeNull();
    });

    it("returns null for an unknown type", () => {
      expect(
        parseServerFrame(JSON.stringify({ type: "bananas", text: "hi" }))
      ).toBeNull();
    });

    it("returns null for an empty object", () => {
      expect(parseServerFrame("{}")).toBeNull();
    });
  });

  describe("conversation frame", () => {
    it("parses a valid conversation frame and returns only the two keys", () => {
      const result = parseServerFrame(
        JSON.stringify({ type: "conversation", conversationId: "abc", extra: 1 })
      );
      expect(result).toEqual({ type: "conversation", conversationId: "abc" });
    });

    it("returns null when conversationId is missing", () => {
      expect(
        parseServerFrame(JSON.stringify({ type: "conversation" }))
      ).toBeNull();
    });

    it("returns null when conversationId is not a string", () => {
      expect(
        parseServerFrame(
          JSON.stringify({ type: "conversation", conversationId: 5 })
        )
      ).toBeNull();
    });
  });

  describe("token frame", () => {
    it("parses a valid token frame", () => {
      const result = parseServerFrame(
        JSON.stringify({ type: "token", text: "hello" })
      );
      expect(result).toEqual({ type: "token", text: "hello" });
    });

    it("treats an empty string text as valid", () => {
      const result = parseServerFrame(
        JSON.stringify({ type: "token", text: "" })
      );
      expect(result).toEqual({ type: "token", text: "" });
    });

    it("returns null when text is missing", () => {
      expect(parseServerFrame(JSON.stringify({ type: "token" }))).toBeNull();
    });

    it("returns null when text is the wrong type (number)", () => {
      expect(
        parseServerFrame(JSON.stringify({ type: "token", text: 5 }))
      ).toBeNull();
    });
  });

  describe("done frame", () => {
    it("parses a valid done frame", () => {
      const result = parseServerFrame(
        JSON.stringify({
          type: "done",
          conversationId: "c1",
          fullText: "final",
        })
      );
      expect(result).toEqual({
        type: "done",
        conversationId: "c1",
        fullText: "final",
      });
    });

    it("returns null when fullText is missing", () => {
      expect(
        parseServerFrame(JSON.stringify({ type: "done", conversationId: "c" }))
      ).toBeNull();
    });

    it("returns null when conversationId is missing", () => {
      expect(
        parseServerFrame(JSON.stringify({ type: "done", fullText: "final" }))
      ).toBeNull();
    });

    it("returns null when conversationId is non-string", () => {
      expect(
        parseServerFrame(
          JSON.stringify({ type: "done", conversationId: 1, fullText: "final" })
        )
      ).toBeNull();
    });

    it("returns null when fullText is non-string", () => {
      expect(
        parseServerFrame(
          JSON.stringify({ type: "done", conversationId: "c", fullText: 1 })
        )
      ).toBeNull();
    });
  });

  describe("error frame", () => {
    it("parses a valid error frame", () => {
      const result = parseServerFrame(
        JSON.stringify({ type: "error", message: "boom" })
      );
      expect(result).toEqual({ type: "error", message: "boom" });
    });

    it("returns null when message is missing", () => {
      expect(parseServerFrame(JSON.stringify({ type: "error" }))).toBeNull();
    });

    it("returns null when message is non-string", () => {
      expect(
        parseServerFrame(JSON.stringify({ type: "error", message: 5 }))
      ).toBeNull();
    });
  });

});

describe("encodeChatFrame", () => {
  it("encodes without userContext (no userContext key)", () => {
    const json = encodeChatFrame({ conversationId: "c1", message: "hi" });
    expect(JSON.parse(json)).toEqual({
      type: "chat",
      conversationId: "c1",
      message: "hi",
    });
    expect(JSON.parse(json)).not.toHaveProperty("userContext");
  });

  it("encodes with userContext when provided", () => {
    const json = encodeChatFrame({
      conversationId: "c1",
      message: "hi",
      userContext: "ctx",
    });
    expect(JSON.parse(json)).toEqual({
      type: "chat",
      conversationId: "c1",
      message: "hi",
      userContext: "ctx",
    });
  });

  it("preserves a null conversationId in the JSON", () => {
    const json = encodeChatFrame({ conversationId: null, message: "hi" });
    expect(json).toContain('"conversationId":null');
    expect(JSON.parse(json)).toEqual({
      type: "chat",
      conversationId: null,
      message: "hi",
    });
  });

  it("round-trips to a deep-equal object", () => {
    const input = {
      conversationId: "abc",
      message: "round trip",
      userContext: "extra",
    };
    expect(JSON.parse(encodeChatFrame(input))).toEqual({
      type: "chat",
      ...input,
    });
  });
});

describe("buildWsUrl", () => {
  it("swaps https → wss and appends default name 'me'", () => {
    expect(buildWsUrl("https://coomander.com")).toBe(
      "wss://coomander.com/agents/app-agent/me"
    );
  });

  it("swaps http → ws and appends default name 'me'", () => {
    expect(buildWsUrl("http://localhost:3005")).toBe(
      "ws://localhost:3005/agents/app-agent/me"
    );
  });

  it("strips a trailing slash before appending", () => {
    expect(buildWsUrl("https://x.ts.net/")).toBe(
      "wss://x.ts.net/agents/app-agent/me"
    );
  });

  it("produces the same result with or without a trailing slash", () => {
    expect(buildWsUrl("https://x.com/")).toBe(buildWsUrl("https://x.com"));
  });

  it("strips multiple trailing slashes", () => {
    expect(buildWsUrl("https://x.com///")).toBe(
      "wss://x.com/agents/app-agent/me"
    );
  });

  it("uses the provided name", () => {
    expect(buildWsUrl("https://coomander.com", "abc")).toBe(
      "wss://coomander.com/agents/app-agent/abc"
    );
  });

  it("encodeURIComponent-s a name with a space", () => {
    expect(buildWsUrl("https://coomander.com", "a b")).toBe(
      "wss://coomander.com/agents/app-agent/a%20b"
    );
  });

  it("encodeURIComponent-s a name with reserved characters", () => {
    expect(buildWsUrl("https://coomander.com", "a/b?c")).toBe(
      "wss://coomander.com/agents/app-agent/a%2Fb%3Fc"
    );
  });

  it("treats the scheme case-insensitively (HTTPS)", () => {
    expect(buildWsUrl("HTTPS://coomander.com")).toBe(
      "wss://coomander.com/agents/app-agent/me"
    );
  });

  it("treats the scheme case-insensitively (HTTP)", () => {
    expect(buildWsUrl("HTTP://localhost:3005")).toBe(
      "ws://localhost:3005/agents/app-agent/me"
    );
  });
});

describe("stream reducer", () => {
  describe("initialStreamState", () => {
    it("matches the documented initial state", () => {
      expect(initialStreamState).toEqual({
        streamingText: null,
        finalText: null,
        conversationId: null,
        done: false,
        error: null,
      });
    });
  });

  describe("reduce — conversation", () => {
    it("sets conversationId without touching text fields", () => {
      const next = reduce(initialStreamState, {
        type: "conversation",
        conversationId: "c1",
      });
      expect(next).toEqual({
        streamingText: null,
        finalText: null,
        conversationId: "c1",
        done: false,
        error: null,
      });
    });

    it("returns a new object reference and does not mutate input", () => {
      const before = { ...initialStreamState };
      const next = reduce(initialStreamState, {
        type: "conversation",
        conversationId: "c1",
      });
      expect(next).not.toBe(initialStreamState);
      expect(initialStreamState).toEqual(before);
    });
  });

  describe("reduce — token", () => {
    it("becomes the token text from a null streamingText", () => {
      const next = reduce(initialStreamState, { type: "token", text: "ab" });
      expect(next.streamingText).toBe("ab");
    });

    it("concatenates onto existing streamingText", () => {
      const state = { ...initialStreamState, streamingText: "ab" };
      const next = reduce(state, { type: "token", text: "cd" });
      expect(next.streamingText).toBe("abcd");
    });

    it("returns a new object reference and does not mutate input", () => {
      const state = { ...initialStreamState, streamingText: "ab" };
      const before = { ...state };
      const next = reduce(state, { type: "token", text: "cd" });
      expect(next).not.toBe(state);
      expect(state).toEqual(before);
    });
  });

  describe("reduce — done", () => {
    it("clears streamingText, sets finalText, conversationId, and done", () => {
      const state = { ...initialStreamState, streamingText: "partial" };
      const next = reduce(state, {
        type: "done",
        conversationId: "c2",
        fullText: "the full text",
      });
      expect(next).toEqual({
        streamingText: null,
        finalText: "the full text",
        conversationId: "c2",
        done: true,
        error: null,
      });
    });

    it("returns a new object reference and does not mutate input", () => {
      const state = { ...initialStreamState, streamingText: "partial" };
      const before = { ...state };
      const next = reduce(state, {
        type: "done",
        conversationId: "c2",
        fullText: "x",
      });
      expect(next).not.toBe(state);
      expect(state).toEqual(before);
    });
  });

  describe("reduce — error", () => {
    it("clears streamingText, sets error, and preserves finalText", () => {
      const state = {
        ...initialStreamState,
        streamingText: "partial",
        finalText: "kept final",
      };
      const next = reduce(state, { type: "error", message: "boom" });
      expect(next.streamingText).toBeNull();
      expect(next.error).toBe("boom");
      expect(next.finalText).toBe("kept final");
    });

    it("returns a new object reference and does not mutate input", () => {
      const state = { ...initialStreamState, streamingText: "partial" };
      const before = { ...state };
      const next = reduce(state, { type: "error", message: "boom" });
      expect(next).not.toBe(state);
      expect(state).toEqual(before);
    });
  });

  describe("reduce — full sequence", () => {
    it("folds conversation, tokens, then done", () => {
      const frames = [
        { type: "conversation", conversationId: "conv-1" } as const,
        { type: "token", text: "Hel" } as const,
        { type: "token", text: "lo " } as const,
        { type: "token", text: "world" } as const,
        { type: "done", conversationId: "conv-1", fullText: "Hello world" } as const,
      ];
      const final = frames.reduce(reduce, initialStreamState);
      expect(final.finalText).toBe("Hello world");
      expect(final.streamingText).toBeNull();
      expect(final.done).toBe(true);
      expect(final.conversationId).toBe("conv-1");
      expect(final.error).toBeNull();
    });
  });

  describe("resetTurn", () => {
    it("clears turn fields and preserves conversationId", () => {
      const state = {
        streamingText: "partial",
        finalText: "final",
        conversationId: "c7",
        done: true,
        error: "boom",
      };
      const next = resetTurn(state);
      expect(next).toEqual({
        streamingText: null,
        finalText: null,
        conversationId: "c7",
        done: false,
        error: null,
      });
    });

    it("returns a new object reference and does not mutate input", () => {
      const state = {
        streamingText: "partial",
        finalText: "final",
        conversationId: "c7",
        done: true,
        error: "boom",
      };
      const before = JSON.parse(JSON.stringify(state));
      const next = resetTurn(state);
      expect(next).not.toBe(state);
      expect(state).toEqual(before);
    });
  });
});
