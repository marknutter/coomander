/**
 * Server-side realtime publish.
 *
 * Live event delivery is backed by the agents Worker's per-channel Durable
 * Object (apps/agents/src/channel — ported from the AppSeed realtime epic,
 * #222). The OLD in-process `Map` pub/sub + the SSE endpoint
 * (`/api/realtime/[channel]`) were removed: they only worked single-process and
 * were broken in the Cloudflare Workers deploy, where each request can land on a
 * different isolate. There is no `subscribe`/`unsubscribe` here anymore — the
 * browser connects a WebSocket directly to the agents Worker (see
 * `lib/use-realtime.ts`), and this module only PUSHES events to it.
 *
 * Transport: a server-to-server POST to the agents Worker's
 * `/realtime/internal/publish` route, authenticated with the shared
 * `AGENTS_INTERNAL_SECRET` (the same secret the agent uses for its internal
 * web calls). The Worker fans the event out to every socket on the channel's DO.
 *
 * Usage (server only):
 *   import { publish } from "@/lib/realtime";
 *   await publish(`notifications:${userId}`, { type: "new-notification", notification });
 *
 * IMPORTANT — Workers "unawaited promise gets cancelled" caveat:
 *   In a Next API route you should `await publish(...)` (or hand it to the
 *   platform `waitUntil`). A fire-and-forget promise left running AFTER the
 *   response has been returned can be cancelled by the runtime before the POST
 *   completes, silently dropping the live push. `await`-ing keeps the request
 *   alive until the push is sent.
 */

import { log } from "@/lib/logger";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/** Minimal shape of a Cloudflare service binding (a `Fetcher`). */
type RealtimeService = { fetch(input: string, init?: RequestInit): Promise<Response> };

/**
 * The web→agents **service binding** (`REALTIME` → the coomander-agents
 * Worker, apps/agents/wrangler.toml), available in prod, or `null` under local
 * `next dev` (no Cloudflare bindings).
 *
 * This binding is REQUIRED in prod: the OpenNext web Worker and the agents
 * Worker share the SAME zone (both route on coomander.com), and a Worker
 * fetching its own zone's public hostname
 * (`https://coomander.com/realtime/internal/publish`) **loops and returns HTTP
 * 522** — so the public-URL path can never deliver edge-side. A service binding
 * is a DIRECT worker-to-worker call that bypasses edge routing entirely.
 */
function realtimeBinding(): RealtimeService | null {
  try {
    const env = getCloudflareContext().env as unknown as { REALTIME?: RealtimeService };
    return env.REALTIME ?? null;
  } catch {
    // getCloudflareContext throws when there's no CF context (e.g. next dev).
    return null;
  }
}

/** Dev-only fallback origin for the agents Worker's `/realtime/*` routes —
 *  used ONLY when the REALTIME service binding isn't available (local `next
 *  dev`, where app-dev and agents-dev share the caddy-dev container's network
 *  namespace, so 127.0.0.1:8788 reaches wrangler dev directly). Never used in
 *  prod (the binding is always present there; a same-zone public fetch would
 *  522). */
function realtimeOrigin(): string {
  return (
    process.env.REALTIME_ORIGIN ||
    process.env.APP_URL ||
    "http://127.0.0.1:8788"
  );
}

/**
 * Publish an event to all WebSocket subscribers on a realtime channel.
 *
 * Prefers the `REALTIME` service binding (prod — direct worker-to-worker); falls
 * back to an HTTP POST only under `next dev`, where there's no binding and the
 * same-zone-loop problem doesn't apply.
 *
 * Best-effort and NON-THROWING: a missing live push must never fail the
 * request. The caller has already persisted its source-of-truth (e.g. the
 * notification row in D1); the websocket fan-out is purely an instant-delivery
 * optimization. If the shared secret is unset, or the POST fails / times out,
 * we LOG and return — we never throw.
 */
export async function publish(
  channel: string,
  event: Record<string, unknown>,
): Promise<void> {
  const secret = process.env.AGENTS_INTERNAL_SECRET;
  if (!secret) {
    // Realtime push is optional infra — degrade gracefully when it isn't wired.
    log.debug("Realtime publish skipped — AGENTS_INTERNAL_SECRET not set", {
      channel,
    });
    return;
  }

  const init: RequestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agents-internal-secret": secret,
    },
    body: JSON.stringify({ channel, event }),
    // Bound the hop: a HUNG (not erroring) agents Worker must not stall a
    // caller that awaits publish() — e.g. a campaign batch consumer publishing
    // progress per batch. AbortSignal.timeout aborts the fetch/binding call;
    // the catch below turns the AbortError into the usual best-effort
    // log-and-return.
    signal: AbortSignal.timeout(2000),
  };

  try {
    const binding = realtimeBinding();
    // Service binding in prod (direct, no edge loop); HTTP fetch only in dev.
    // The binding ignores the URL host and routes by pathname.
    const res = binding
      ? await binding.fetch("https://agents.internal/realtime/internal/publish", init)
      : await fetch(`${realtimeOrigin().replace(/\/$/, "")}/realtime/internal/publish`, init);

    if (!res.ok) {
      log.warn("Realtime publish failed", { channel, status: res.status });
      return;
    }

    const { delivered } = (await res.json().catch(() => ({ delivered: 0 }))) as {
      delivered?: number;
    };
    log.debug("Realtime event published", {
      channel,
      delivered: delivered ?? 0,
      via: binding ? "binding" : "http",
    });
  } catch (error) {
    // Worker unreachable (e.g. mid-restart in dev) — log and move on.
    log.warn("Realtime publish error", {
      channel,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
