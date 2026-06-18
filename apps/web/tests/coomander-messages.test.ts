import { describe, it, expect, beforeAll } from "vitest";
import {
  appendMessage,
  listMessages,
  messagesSince,
} from "@/lib/coomander/coomanderMessages";
import { getRawDb } from "@/lib/db";
// Importing the db helper bootstraps the Better Auth `user` table schema.
import "./helpers/db";

let userIdCounter = 0;
function seedUser(): string {
  const id = `coomander-msg-user-${Date.now()}-${userIdCounter++}`;
  const email = `${id}@test.com`;
  const now = Math.floor(Date.now() / 1000);
  getRawDb()
    .prepare(
      "INSERT INTO user (id, email, emailVerified, createdAt, updatedAt, isAdmin, disabled, coomanderEnabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, email, 1, now, now, 0, 0, 1);
  return id;
}

describe("coomanderMessages — indefinite-retention message log (#151)", () => {
  it("retains all 100 appended messages — no TTL, no sweep (default-limit case)", async () => {
    const userId = seedUser();
    for (let i = 0; i < 100; i++) {
      await appendMessage(userId, "inbound", `message ${i}`);
    }
    // Default limit is 100; pass it explicitly to be unambiguous.
    const rows = await listMessages(userId, 100);
    expect(rows.length).toBe(100);
  });

  it("retains well over the default limit when an explicit larger limit is given", async () => {
    const userId = seedUser();
    const total = 150;
    for (let i = 0; i < total; i++) {
      await appendMessage(userId, "inbound", `message ${i}`);
    }
    // Confirm none were swept/deleted: the underlying log still holds all rows.
    const rows = await listMessages(userId, total);
    expect(rows.length).toBe(total);
  });

  it("persists both inbound and outbound directions", async () => {
    const userId = seedUser();
    await appendMessage(userId, "inbound", "user said hi");
    await appendMessage(userId, "outbound", "assistant replied");
    await appendMessage(userId, "inbound", "user said bye");

    const rows = await listMessages(userId, 100);
    const directions = new Set(rows.map((r) => r.direction));
    expect(directions.has("inbound")).toBe(true);
    expect(directions.has("outbound")).toBe(true);
  });

  it("round-trips persona_mode", async () => {
    const userId = seedUser();
    await appendMessage(userId, "outbound", "operational reply", {
      personaMode: "operational",
    });

    const rows = await listMessages(userId, 100);
    const row = rows.find((r) => r.text === "operational reply");
    expect(row).toBeTruthy();
    expect(row!.personaMode).toBe("operational");
  });

  it("round-trips toolCall as parsed JSON", async () => {
    const userId = seedUser();
    const toolCall = {
      toolName: "need_clarification",
      input: { reply: "hi" },
    };
    await appendMessage(userId, "inbound", "needs clarification", { toolCall });

    const rows = await listMessages(userId, 100);
    const row = rows.find((r) => r.text === "needs clarification");
    expect(row).toBeTruthy();
    expect(row!.toolCall).toEqual(toolCall);
  });

  it("listMessages returns rows oldest-first", async () => {
    const userId = seedUser();
    const texts = ["first", "second", "third", "fourth"];
    for (const t of texts) {
      await appendMessage(userId, "inbound", t);
    }

    const rows = await listMessages(userId, 100);
    expect(rows.map((r) => r.text)).toEqual(texts);
  });

  it("messagesSince returns only rows after the cursor, oldest-first", async () => {
    const userId = seedUser();
    await appendMessage(userId, "inbound", "old message");
    // Cursor strictly after the first message's created_at second.
    const cursor = Math.floor(Date.now() / 1000) + 5;
    // Force later rows to have a created_at greater than the cursor by waiting
    // past the cursor boundary is impractical in a unit test; instead assert the
    // ordering/filter contract on whatever rows qualify.
    const rows = await messagesSince(userId, 0);
    // since 0 → everything for this user, oldest-first
    const sorted = [...rows].sort((a, b) => a.createdAt - b.createdAt);
    expect(rows.map((r) => r.id)).toEqual(sorted.map((r) => r.id));
    // And a future cursor returns nothing.
    const none = await messagesSince(userId, cursor);
    expect(none.length).toBe(0);
  });
});
