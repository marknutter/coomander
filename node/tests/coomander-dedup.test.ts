import { describe, it, expect, beforeAll } from "vitest";
import { claimUpdate } from "@/lib/coomander/telegramDedup";
import { getRawDb } from "@/lib/db";
// Importing the db helper bootstraps the Better Auth `user` table schema.
import "./helpers/db";

let userIdCounter = 0;
function seedUser(): string {
  const id = `coomander-dedup-user-${Date.now()}-${userIdCounter++}`;
  const email = `${id}@test.com`;
  const now = Math.floor(Date.now() / 1000);
  getRawDb()
    .prepare(
      "INSERT INTO user (id, email, emailVerified, createdAt, updatedAt, isAdmin, disabled, coomanderEnabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, email, 1, now, now, 0, 0, 1);
  return id;
}

// Use a fresh, monotonically-increasing block of update IDs per test so cases
// never collide on the coomander_dedup primary key across the shared test.db.
let updateIdBase = 900_000;
function nextUpdateId(): number {
  return updateIdBase++;
}

describe("claimUpdate (telegram at-least-once dedup)", () => {
  let userId: string;

  beforeAll(() => {
    userId = seedUser();
  });

  it("returns true the first time a new updateId is claimed", async () => {
    const updateId = nextUpdateId();
    await expect(claimUpdate(updateId, userId)).resolves.toBe(true);
  });

  it("returns false on a second claim of the same updateId (idempotent)", async () => {
    const updateId = nextUpdateId();
    const first = await claimUpdate(updateId, userId);
    const second = await claimUpdate(updateId, userId);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("returns true for a different updateId", async () => {
    const idA = nextUpdateId();
    const idB = nextUpdateId();
    expect(await claimUpdate(idA, userId)).toBe(true);
    expect(await claimUpdate(idB, userId)).toBe(true);
  });

  it("records the claimed update in the coomander_dedup table", async () => {
    const updateId = nextUpdateId();
    await claimUpdate(updateId, userId);
    const row = getRawDb()
      .prepare(
        "SELECT telegram_update_id, user_id FROM coomander_dedup WHERE telegram_update_id = ?",
      )
      .get(updateId) as { telegram_update_id: number; user_id: string } | undefined;
    expect(row).toBeTruthy();
    expect(row!.telegram_update_id).toBe(updateId);
    expect(row!.user_id).toBe(userId);
  });

  it("a repeated claim does not insert a duplicate row", async () => {
    const updateId = nextUpdateId();
    await claimUpdate(updateId, userId);
    await claimUpdate(updateId, userId);
    const { c } = getRawDb()
      .prepare(
        "SELECT COUNT(*) as c FROM coomander_dedup WHERE telegram_update_id = ?",
      )
      .get(updateId) as { c: number };
    expect(c).toBe(1);
  });
});
