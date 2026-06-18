import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock @/lib/auth ────────────────────────────────────────────────────────
const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
    },
  },
}));

// ─── Mock @/lib/ai/analyze-content ──────────────────────────────────────────
const analyzeUnanalyzedPostsMock = vi.fn();
const generateContentReportMock = vi.fn();
const getLatestReportMock = vi.fn();
const elaboratePatternMock = vi.fn();

vi.mock("@/lib/ai/analyze-content", () => ({
  analyzeUnanalyzedPosts: (...args: unknown[]) => analyzeUnanalyzedPostsMock(...args),
  generateContentReport: (...args: unknown[]) => generateContentReportMock(...args),
  getLatestReport: (...args: unknown[]) => getLatestReportMock(...args),
  elaboratePattern: (...args: unknown[]) => elaboratePatternMock(...args),
}));

// Imports AFTER vi.mock calls so the mocks are hoisted in time.
import * as analyzeRoute from "@/app/api/analyze/instagram/route";
import * as streamRoute from "@/app/api/analyze/instagram/stream/route";
import * as elaborateRoute from "@/app/api/analyze/instagram/elaborate/route";

const SESSION = { user: { id: "user-123" } };

function makeRequest(
  url: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string> }
): Request {
  const { method = "GET", body, headers = {} } = init ?? {};
  return new Request(url, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

async function readJson(res: Response): Promise<unknown> {
  return await res.json();
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── /api/analyze/instagram POST + GET ─────────────────────────────────────
describe("POST /api/analyze/instagram", () => {
  it("returns 401 when no session", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const req = makeRequest("http://localhost/api/analyze/instagram", {
      method: "POST",
      body: {},
    });
    const res = await analyzeRoute.POST(req);
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { code?: string };
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("defaults action to 'full' when missing and runs analyze + report", async () => {
    getSessionMock.mockResolvedValueOnce(SESSION);
    analyzeUnanalyzedPostsMock.mockResolvedValueOnce({ analyzed: 3 });
    generateContentReportMock.mockResolvedValueOnce({ summary: "ok" });

    const req = makeRequest("http://localhost/api/analyze/instagram", {
      method: "POST",
      body: {},
    });
    const res = await analyzeRoute.POST(req);

    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.analyzeResult).toEqual({ analyzed: 3 });
    expect(body.report).toEqual({ summary: "ok" });
    expect(analyzeUnanalyzedPostsMock).toHaveBeenCalledWith("user-123");
    expect(generateContentReportMock).toHaveBeenCalledWith("user-123");
  });

  it("action='analyze' only runs analyzeUnanalyzedPosts", async () => {
    getSessionMock.mockResolvedValueOnce(SESSION);
    analyzeUnanalyzedPostsMock.mockResolvedValueOnce({ analyzed: 5 });

    const req = makeRequest("http://localhost/api/analyze/instagram", {
      method: "POST",
      body: { action: "analyze" },
    });
    const res = await analyzeRoute.POST(req);

    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.result).toEqual({ analyzed: 5 });
    expect(generateContentReportMock).not.toHaveBeenCalled();
  });

  it("action='report' only runs generateContentReport", async () => {
    getSessionMock.mockResolvedValueOnce(SESSION);
    generateContentReportMock.mockResolvedValueOnce({ summary: "yay" });

    const req = makeRequest("http://localhost/api/analyze/instagram", {
      method: "POST",
      body: { action: "report" },
    });
    const res = await analyzeRoute.POST(req);

    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.report).toEqual({ summary: "yay" });
    expect(analyzeUnanalyzedPostsMock).not.toHaveBeenCalled();
  });

  it("returns errorResponse on thrown error", async () => {
    getSessionMock.mockResolvedValueOnce(SESSION);
    analyzeUnanalyzedPostsMock.mockRejectedValueOnce(new Error("boom"));

    const req = makeRequest("http://localhost/api/analyze/instagram", {
      method: "POST",
      body: { action: "analyze" },
    });
    const res = await analyzeRoute.POST(req);
    expect(res.status).toBe(500);
    const body = (await readJson(res)) as { code?: string };
    expect(body.code).toBe("INTERNAL_ERROR");
  });
});

describe("GET /api/analyze/instagram", () => {
  it("returns 401 when no session", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const req = makeRequest("http://localhost/api/analyze/instagram");
    const res = await analyzeRoute.GET(req);
    expect(res.status).toBe(401);
  });

  it("returns null report with explanatory message when none exists", async () => {
    getSessionMock.mockResolvedValueOnce(SESSION);
    getLatestReportMock.mockResolvedValueOnce(null);
    const req = makeRequest("http://localhost/api/analyze/instagram");
    const res = await analyzeRoute.GET(req);
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.report).toBeNull();
    expect(typeof body.message).toBe("string");
    expect(body.message).toMatch(/no analysis report/i);
  });

  it("returns latest report when one exists", async () => {
    getSessionMock.mockResolvedValueOnce(SESSION);
    const report = { id: "r1", summary: "hello" };
    getLatestReportMock.mockResolvedValueOnce(report);
    const req = makeRequest("http://localhost/api/analyze/instagram");
    const res = await analyzeRoute.GET(req);
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.report).toEqual(report);
  });
});

// ─── /api/analyze/instagram/stream GET (SSE) ────────────────────────────────
async function readSseEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: Array<Record<string, unknown>> = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed.startsWith("data:")) continue;
      const json = trimmed.slice("data:".length).trim();
      if (!json) continue;
      events.push(JSON.parse(json));
    }
  }
  // Drain trailing buffer
  const tail = buffer.trim();
  if (tail.startsWith("data:")) {
    const json = tail.slice("data:".length).trim();
    if (json) events.push(JSON.parse(json));
  }
  return events;
}

describe("GET /api/analyze/instagram/stream", () => {
  it("returns 401 plain Response when no session", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const req = makeRequest("http://localhost/api/analyze/instagram/stream");
    const res = await streamRoute.GET(req);
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).toBe("Unauthorized");
  });

  it("emits expected SSE event sequence on happy path", async () => {
    getSessionMock.mockResolvedValueOnce(SESSION);

    analyzeUnanalyzedPostsMock.mockImplementationOnce(
      async (userId: string, ...rest: unknown[]) => {
        expect(userId).toBe("user-123");
        // onProgress may be passed as 2nd arg or after a numeric limit (3rd).
        const onProgress = rest.find(
          (a): a is (e: Record<string, unknown>) => void => typeof a === "function"
        );
        onProgress?.({
          phase: "analyze",
          step: "Analyzing post 1/2",
          current: 1,
          total: 2,
        });
        onProgress?.({
          phase: "analyze",
          step: "Analyzing post 2/2",
          current: 2,
          total: 2,
        });
        return { analyzed: 2 };
      }
    );

    const report = { id: "r-final", summary: "all done" };
    generateContentReportMock.mockImplementationOnce(
      async (userId: string, ...rest: unknown[]) => {
        expect(userId).toBe("user-123");
        const onProgress = rest.find(
          (a): a is (e: Record<string, unknown>) => void => typeof a === "function"
        );
        onProgress?.({
          phase: "report",
          step: "Reasoning...",
          current: 0,
          total: 1,
        });
        return report;
      }
    );

    const req = makeRequest("http://localhost/api/analyze/instagram/stream");
    const res = await streamRoute.GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/text\/event-stream/);

    const events = await readSseEvents(res);

    // 1. start of analyze
    expect(events[0]).toMatchObject({
      phase: "analyze",
      step: "Starting post analysis...",
      current: 0,
      total: 0,
    });

    // somewhere in the middle: forwarded analyze progress (post 1/2 + 2/2)
    const analyzeProgress = events.filter(
      (e) =>
        e.phase === "analyze" &&
        !e.done &&
        typeof e.step === "string" &&
        (e.step as string).startsWith("Analyzing post")
    );
    expect(analyzeProgress.length).toBeGreaterThanOrEqual(2);

    // analyze done marker
    const analyzeDone = events.find(
      (e) => e.phase === "analyze" && e.done === true
    );
    expect(analyzeDone).toBeDefined();
    expect(analyzeDone!.current).toBe(analyzeDone!.total);

    // report start
    const reportStart = events.find(
      (e) =>
        e.phase === "report" &&
        e.step === "Generating AI insights report..." &&
        e.current === 0 &&
        e.total === 1
    );
    expect(reportStart).toBeDefined();

    // forwarded report progress
    const reportProgress = events.find(
      (e) =>
        e.phase === "report" &&
        e.step === "Reasoning..." &&
        !e.done
    );
    expect(reportProgress).toBeDefined();

    // report done
    const reportDone = events.find(
      (e) =>
        e.phase === "report" &&
        e.done === true &&
        e.step === "Report complete"
    );
    expect(reportDone).toBeDefined();

    // final complete
    const complete = events[events.length - 1];
    expect(complete).toMatchObject({ phase: "complete", report });
  });

  it("emits error event when underlying call throws", async () => {
    getSessionMock.mockResolvedValueOnce(SESSION);
    analyzeUnanalyzedPostsMock.mockRejectedValueOnce(new Error("kaboom"));

    const req = makeRequest("http://localhost/api/analyze/instagram/stream");
    const res = await streamRoute.GET(req);
    expect(res.status).toBe(200);

    const events = await readSseEvents(res);
    const errEvent = events.find((e) => e.phase === "error");
    expect(errEvent).toBeDefined();
    expect(typeof errEvent!.error).toBe("string");
  });
});

// ─── /api/analyze/instagram/elaborate POST ──────────────────────────────────
describe("POST /api/analyze/instagram/elaborate", () => {
  it("returns 401 when no session", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const req = makeRequest("http://localhost/api/analyze/instagram/elaborate", {
      method: "POST",
      body: { title: "t", description: "d" },
    });
    const res = await elaborateRoute.POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when title is missing", async () => {
    getSessionMock.mockResolvedValueOnce(SESSION);
    const req = makeRequest("http://localhost/api/analyze/instagram/elaborate", {
      method: "POST",
      body: { description: "d" },
    });
    const res = await elaborateRoute.POST(req);
    expect(res.status).toBe(400);
    expect(elaboratePatternMock).not.toHaveBeenCalled();
  });

  it("returns 400 when description is missing", async () => {
    getSessionMock.mockResolvedValueOnce(SESSION);
    const req = makeRequest("http://localhost/api/analyze/instagram/elaborate", {
      method: "POST",
      body: { title: "t" },
    });
    const res = await elaborateRoute.POST(req);
    expect(res.status).toBe(400);
    expect(elaboratePatternMock).not.toHaveBeenCalled();
  });

  it("returns elaboration on happy path with evidence", async () => {
    getSessionMock.mockResolvedValueOnce(SESSION);
    elaboratePatternMock.mockResolvedValueOnce("Long explanation here");

    const req = makeRequest("http://localhost/api/analyze/instagram/elaborate", {
      method: "POST",
      body: { title: "Pattern", description: "desc", evidence: "ev" },
    });
    const res = await elaborateRoute.POST(req);
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.elaboration).toBe("Long explanation here");
    expect(elaboratePatternMock).toHaveBeenCalledWith("user-123", {
      title: "Pattern",
      description: "desc",
      evidence: "ev",
    });
  });

  it("defaults evidence to empty string when omitted", async () => {
    getSessionMock.mockResolvedValueOnce(SESSION);
    elaboratePatternMock.mockResolvedValueOnce("text");

    const req = makeRequest("http://localhost/api/analyze/instagram/elaborate", {
      method: "POST",
      body: { title: "Pattern", description: "desc" },
    });
    const res = await elaborateRoute.POST(req);
    expect(res.status).toBe(200);
    expect(elaboratePatternMock).toHaveBeenCalledWith("user-123", {
      title: "Pattern",
      description: "desc",
      evidence: "",
    });
  });

  it("returns errorResponse on thrown error", async () => {
    getSessionMock.mockResolvedValueOnce(SESSION);
    elaboratePatternMock.mockRejectedValueOnce(new Error("nope"));

    const req = makeRequest("http://localhost/api/analyze/instagram/elaborate", {
      method: "POST",
      body: { title: "t", description: "d" },
    });
    const res = await elaborateRoute.POST(req);
    expect(res.status).toBe(500);
  });
});
