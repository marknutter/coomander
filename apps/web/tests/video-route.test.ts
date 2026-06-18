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

// ─── Mock @/lib/ai/video-analysis ───────────────────────────────────────────
const processVideoPostsMock = vi.fn();
vi.mock("@/lib/ai/video-analysis", () => ({
  processVideoPosts: (...args: unknown[]) => processVideoPostsMock(...args),
}));

// Imports AFTER vi.mock calls so the mocks are hoisted in time.
import * as videoRoute from "@/app/api/analyze/instagram/video/route";

const SESSION = { user: { id: "user-123" } };

function makeRequest(
  url: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string> },
): Request {
  const { method = "POST", body, headers = {} } = init ?? {};
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

describe("POST /api/analyze/instagram/video", () => {
  it("returns 401 when no session", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const req = makeRequest("http://localhost/api/analyze/instagram/video", {
      method: "POST",
      body: {},
    });
    const res = await videoRoute.POST(req);
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { code?: string };
    expect(body.code).toBe("UNAUTHORIZED");
    expect(processVideoPostsMock).not.toHaveBeenCalled();
  });

  it("happy path: delegates to processVideoPosts(session.user.id)", async () => {
    getSessionMock.mockResolvedValueOnce(SESSION);
    const result = {
      transcribed: 2,
      framesAnalyzed: 2,
      skipped: 0,
      errors: 0,
    };
    processVideoPostsMock.mockResolvedValueOnce(result);

    const req = makeRequest("http://localhost/api/analyze/instagram/video", {
      method: "POST",
      body: {},
    });
    const res = await videoRoute.POST(req);

    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.result).toEqual(result);
    expect(processVideoPostsMock).toHaveBeenCalledTimes(1);
    expect(processVideoPostsMock).toHaveBeenCalledWith("user-123");
  });

  it("returns errorResponse on thrown error", async () => {
    getSessionMock.mockResolvedValueOnce(SESSION);
    processVideoPostsMock.mockRejectedValueOnce(new Error("boom"));

    const req = makeRequest("http://localhost/api/analyze/instagram/video", {
      method: "POST",
      body: {},
    });
    const res = await videoRoute.POST(req);
    expect(res.status).toBe(500);
    const body = (await readJson(res)) as { code?: string };
    expect(body.code).toBe("INTERNAL_ERROR");
  });
});
