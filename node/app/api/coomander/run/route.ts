/**
 * POST /api/coomander/run — Coomander cron entrypoint (#151).
 *
 * Fired by the Cloudflare cron (see custom-worker.ts), not a browser, so there
 * is no user session. Guarded by a shared secret: the caller must send
 * `x-agent-secret: $COOMANDER_RUN_SECRET`. Returns 503 if the secret is unset,
 * 401 on mismatch. Always returns 200 with a status object on the happy path so
 * the cron never sees a 500 and retry-storms.
 *
 * Body: `{ slot: "morning" | "midday" | "check" | "evening" }`. The handler
 * fans out to every opted-in user with a Telegram chat id and calls
 * `runAgentPing(userId, slot)`, which internally consults each user's nag
 * preset (planPing) before deciding to send. A missing/invalid slot defaults to
 * "check" (the lightest touchpoint) so a bare manual curl still works.
 */

import { NextResponse } from "next/server";
import { runAgentPing } from "@/lib/coomander/agent";
import { usersToPing } from "@/lib/coomander/settings";
import { SLOTS, type Slot } from "@/lib/coomander/agentPrompts";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 290; // generous headroom for fan-out + model calls

export async function POST(request: Request) {
  const secret = process.env.COOMANDER_RUN_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "COOMANDER_RUN_SECRET not configured" }, { status: 503 });
  }
  if (request.headers.get("x-agent-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { slot?: unknown } = {};
  try {
    body = (await request.json()) ?? {};
  } catch {
    body = {};
  }

  const slot: Slot = SLOTS.includes(body.slot as Slot) ? (body.slot as Slot) : "check";

  const recipients = await usersToPing();
  const results = await Promise.all(
    recipients.map((r) =>
      runAgentPing(r.userId, slot)
        .then((res) => ({ userId: r.userId, ...res }))
        .catch((e) => ({ userId: r.userId, ok: false, slot, sent: false, error: (e as Error).message })),
    ),
  );

  for (const r of results) {
    if (!r.ok) log.warn("[POST /api/coomander/run] ping failed", { userId: r.userId, slot, error: r.error });
  }

  log.info("[POST /api/coomander/run] complete", {
    slot,
    recipients: recipients.length,
    sent: results.filter((r) => r.sent).length,
  });

  return NextResponse.json({ ok: true, slot, recipients: recipients.length, results });
}
