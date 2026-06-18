import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("returns 200 with ok:true and db:true when DB is reachable", async () => {
    const req = new NextRequest("http://localhost:3000/api/health");
    const res = await GET();

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.db).toBe(true);
    expect(typeof json.timestamp).toBe("string");
    // Validate ISO 8601
    expect(new Date(json.timestamp).toISOString()).toBe(json.timestamp);
  });
});
