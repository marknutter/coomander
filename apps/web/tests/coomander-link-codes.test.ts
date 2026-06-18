import { describe, it, expect } from "vitest";
import {
  createLinkCode,
  consumeLinkCode,
  unlinkTelegram,
  deepLink,
} from "@/lib/coomander/linkCodes";
import { getRawDb } from "@/lib/db";
// Importing the db helper bootstraps schema (Better Auth tables + migrations,
// which include coomander_link_codes and user.telegramChatId).
import "./helpers/db";

let userIdCounter = 0;
function seedUser(): string {
  const id = `coomander-link-user-${Date.now()}-${userIdCounter++}`;
  const email = `${id}@test.com`;
  const now = Math.floor(Date.now() / 1000);
  getRawDb()
    .prepare(
      "INSERT INTO user (id, email, emailVerified, createdAt, updatedAt, isAdmin, disabled, coomanderEnabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, email, 1, now, now, 0, 0, 1);
  return id;
}

function getChatId(userId: string): string | null {
  const row = getRawDb()
    .prepare("SELECT telegramChatId FROM user WHERE id = ?")
    .get(userId) as { telegramChatId: string | null } | undefined;
  return row ? row.telegramChatId : null;
}

function codeRowExists(code: string): boolean {
  const row = getRawDb()
    .prepare("SELECT code FROM coomander_link_codes WHERE code = ?")
    .get(code) as { code: string } | undefined;
  return !!row;
}

describe("coomander linkCodes — in-app Telegram link flow (#185)", () => {
  it("create + consume happy path links the chat and returns the userId", async () => {
    const userId = seedUser();
    const { code } = await createLinkCode(userId);

    const result = await consumeLinkCode(code, "999");

    expect(result).toBe(userId);
    expect(getChatId(userId)).toBe("999");
  });

  it("is single-use: a second consume of the same code returns null", async () => {
    const userId = seedUser();
    const { code } = await createLinkCode(userId);

    const first = await consumeLinkCode(code, "999");
    expect(first).toBe(userId);

    const second = await consumeLinkCode(code, "999");
    expect(second).toBeNull();
  });

  it("accepts a /start deep-link payload and is case-insensitive", async () => {
    const userId = seedUser();
    const { code } = await createLinkCode(userId);

    const result = await consumeLinkCode("/start " + code.toLowerCase(), "111");

    expect(result).toBe(userId);
    expect(getChatId(userId)).toBe("111");
  });

  it("keeps only one active code per user: the first code stops working after a re-mint", async () => {
    const userId = seedUser();
    const { code: firstCode } = await createLinkCode(userId);
    const { code: secondCode } = await createLinkCode(userId);

    expect(secondCode).not.toBe(firstCode);

    const firstResult = await consumeLinkCode(firstCode, "222");
    expect(firstResult).toBeNull();
    expect(getChatId(userId)).toBeNull();

    const secondResult = await consumeLinkCode(secondCode, "222");
    expect(secondResult).toBe(userId);
    expect(getChatId(userId)).toBe("222");
  });

  it("rejects an expired code, links nothing, and still deletes the matched row", async () => {
    const userId = seedUser();
    const { code } = await createLinkCode(userId);

    const pastTs = Math.floor(Date.now() / 1000) - 60;
    getRawDb()
      .prepare("UPDATE coomander_link_codes SET expires_at = ? WHERE code = ?")
      .run(pastTs, code);

    const result = await consumeLinkCode(code, "1");

    expect(result).toBeNull();
    expect(getChatId(userId)).toBeNull();
    // Single-use even on expiry: the matched row is gone.
    expect(codeRowExists(code)).toBe(false);
  });

  it("ignores non-code text and a bare /start payload", async () => {
    const result1 = await consumeLinkCode("posted a reel", "1");
    expect(result1).toBeNull();

    const result2 = await consumeLinkCode("/start", "1");
    expect(result2).toBeNull();
  });

  it("unlinkTelegram clears telegramChatId and removes any pending code", async () => {
    const userId = seedUser();

    // Link first.
    const { code: linkCode } = await createLinkCode(userId);
    expect(await consumeLinkCode(linkCode, "777")).toBe(userId);
    expect(getChatId(userId)).toBe("777");

    // Mint a fresh pending code, then unlink.
    const { code: pendingCode } = await createLinkCode(userId);
    await unlinkTelegram(userId);

    expect(getChatId(userId)).toBeNull();
    // Pending code no longer consumes.
    expect(await consumeLinkCode(pendingCode, "888")).toBeNull();
    expect(getChatId(userId)).toBeNull();
  });

  it("deepLink returns a t.me URL containing the code", () => {
    const url = deepLink("ABC123");
    expect(url).toMatch(/^https:\/\/t\.me\//);
    expect(url).toContain("ABC123");
  });
});
