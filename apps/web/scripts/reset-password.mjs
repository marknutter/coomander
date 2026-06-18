// Dev-only password reset. Hashes via Better Auth's own hasher so the
// stored hash is guaranteed compatible with the running auth instance.
//
// Usage (inside container):
//   node scripts/reset-password.mjs <email> <new-password>

import { hashPassword } from "better-auth/crypto";
import Database from "better-sqlite3";

const [, , email, newPassword] = process.argv;
if (!email || !newPassword) {
  console.error("Usage: node scripts/reset-password.mjs <email> <password>");
  process.exit(1);
}

const dbPath = process.env.DATABASE_PATH || "./data/appseed.db";
const db = new Database(dbPath);

const user = db.prepare("SELECT id, email FROM user WHERE email = ?").get(email);
if (!user) {
  console.error(`No user with email ${email}`);
  process.exit(1);
}

const hash = await hashPassword(newPassword);

const account = db
  .prepare("SELECT id FROM account WHERE userId = ? AND providerId = 'credential'")
  .get(user.id);

if (account) {
  db.prepare("UPDATE account SET password = ? WHERE id = ?").run(hash, account.id);
  console.log(`Updated existing credential account for ${email}`);
} else {
  // No credential account yet (e.g. OAuth-only user) — create one
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?, ?, 'credential', ?, ?, datetime('now'), datetime('now'))"
  ).run(id, user.id, user.id, hash);
  console.log(`Created credential account for ${email}`);
}

db.close();
