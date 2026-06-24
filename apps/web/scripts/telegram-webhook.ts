#!/usr/bin/env npx tsx
/**
 * Register / inspect / clear the Telegram webhook for a Coomander bot (#215).
 *
 * Coomander's inbound is webhook-based (POST /api/coomander/webhook) and
 * Telegram allows ONE webhook URL per bot. Prod's @coomander_bot already points
 * at https://coomander.com/api/coomander/webhook, so LOCAL dev uses a SEPARATE
 * dev bot (per developer) whose webhook points at that developer's Cloudflare
 * Tunnel hostname. See README → "Local Telegram dev".
 *
 * Usage (from apps/web):
 *   npm run telegram:webhook -- info        # getWebhookInfo (read-only, default)
 *   npm run telegram:webhook -- set --yes   # setWebhook → $TELEGRAM_WEBHOOK_URL
 *   npm run telegram:webhook -- delete      # deleteWebhook
 *
 * Reads from apps/web/.env.local:
 *   MADDIE_TELEGRAM_BOT_TOKEN      the bot to operate on (your DEV bot in dev)
 *   MADDIE_TELEGRAM_WEBHOOK_SECRET secret echoed in x-telegram-bot-api-secret-token
 *   TELEGRAM_WEBHOOK_URL           full public URL, e.g.
 *                                  https://dev-you.coomander.com/api/coomander/webhook
 *
 * Safety: `set` prints the resolved bot @username (getMe) and the target URL,
 * then REQUIRES `--yes` — so you can't silently repoint the wrong bot (e.g.
 * clobber prod's @coomander_bot if .env.local still holds the prod token).
 */

import { config } from "dotenv";
config({ path: ".env.local" });

const API = "https://api.telegram.org";

type Cmd = "info" | "set" | "delete";

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

async function tg<T>(token: string, method: string, body?: unknown): Promise<TgResponse<T>> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return (await res.json().catch(() => ({ ok: false, description: `http ${res.status}` }))) as TgResponse<T>;
}

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = (args.find((a) => !a.startsWith("-")) ?? "info") as Cmd;
  const yes = args.includes("--yes") || args.includes("-y");

  if (!["info", "set", "delete"].includes(cmd)) {
    fail(`unknown command "${cmd}". Use: info | set | delete`);
  }

  const token = process.env.MADDIE_TELEGRAM_BOT_TOKEN;
  if (!token) fail("MADDIE_TELEGRAM_BOT_TOKEN not set in apps/web/.env.local");

  // Always identify the target bot first — the guardrail against repointing the
  // wrong bot (getMe is read-only).
  const me = await tg<{ username?: string; id?: number }>(token, "getMe");
  if (!me.ok) fail(`getMe failed: ${me.description ?? "unknown error"} (check MADDIE_TELEGRAM_BOT_TOKEN)`);
  const botLabel = `@${me.result?.username ?? "?"} (id ${me.result?.id ?? "?"})`;
  console.log(`Bot: ${botLabel}`);

  if (cmd === "info") {
    const info = await tg<Record<string, unknown>>(token, "getWebhookInfo");
    if (!info.ok) fail(`getWebhookInfo failed: ${info.description}`);
    const r = info.result ?? {};
    console.log("Webhook info:");
    console.log(`  url:                  ${r.url || "(none set)"}`);
    console.log(`  pending_update_count: ${r.pending_update_count ?? 0}`);
    console.log(`  has_custom_cert:      ${r.has_custom_certificate ?? false}`);
    console.log(`  last_error_message:   ${r.last_error_message || "(none)"}`);
    console.log(`  allowed_updates:      ${JSON.stringify(r.allowed_updates ?? "(default)")}`);
    return;
  }

  if (cmd === "delete") {
    const del = await tg(token, "deleteWebhook", { drop_pending_updates: true });
    if (!del.ok) fail(`deleteWebhook failed: ${del.description}`);
    console.log(`✓ Webhook deleted for ${botLabel}`);
    return;
  }

  // cmd === "set"
  const url = process.env.TELEGRAM_WEBHOOK_URL;
  const secret = process.env.MADDIE_TELEGRAM_WEBHOOK_SECRET;
  if (!url) fail("TELEGRAM_WEBHOOK_URL not set in apps/web/.env.local (e.g. https://dev-you.coomander.com/api/coomander/webhook)");
  if (!secret) fail("MADDIE_TELEGRAM_WEBHOOK_SECRET not set in apps/web/.env.local");
  if (!/^https:\/\//.test(url)) fail("TELEGRAM_WEBHOOK_URL must be https://");

  console.log(`Will set webhook:\n  ${botLabel}\n  → ${url}`);
  if (!yes) {
    fail("refusing to set without confirmation. Re-run with --yes once you've verified the bot above is your DEV bot (not prod's @coomander_bot).");
  }

  const set = await tg(token, "setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
  if (!set.ok) fail(`setWebhook failed: ${set.description}`);
  console.log(`✓ Webhook set for ${botLabel} → ${url}`);
}

main().catch((e) => fail((e as Error).message));
