// @ts-nocheck
/**
 * Custom Worker entrypoint (#151) — wraps the OpenNext-generated worker to add a
 * Cloudflare Cron Trigger handler for the Coomander ping loop. Per OpenNext's
 * "Custom Worker" how-to: re-export `fetch` unchanged, add `scheduled()`.
 *
 * `wrangler.toml` `main` points here (not `.open-next/worker.js`). The import
 * below resolves at deploy time, AFTER `opennextjs-cloudflare build` has emitted
 * `.open-next/worker.js`. (@ts-nocheck because that file does not exist at
 * project-typecheck time, only after a build.)
 *
 * The scheduled handler invokes the app's own `/api/coomander/run` route
 * in-process via `handler.fetch` (no external network hop), passing the shared
 * secret. That reuses the route's auth + Cloudflare context (D1 binding, env)
 * exactly as a real request would.
 *
 * The fired cron expression maps to a slot (tight-preset times). The run route
 * then fans out to opted-in users and applies each user's nag preset (planPing)
 * before deciding whether to actually send. Keep CRON_SLOT in sync with
 * wrangler.toml `[triggers]` and lib/coomander/scheduling.ts CRON_SLOT_MAP.
 *
 * Unlike geology there is no Sentry wrapper here — MaddieHQ does not depend on
 * @sentry/cloudflare. If server-side capture is added later, wrap `worker` the
 * same way geology does.
 */
import { default as handler } from "./.open-next/worker.js";

// Tight-preset cron (UTC) -> slot. Mirror of scheduling.ts CRON_SLOT_MAP.
const CRON_SLOT = {
  "0 12 * * *": "morning",
  "0 18 * * *": "midday",
  "0 21 * * *": "check",
  "0 1 * * *": "evening",
};

const worker = {
  fetch: handler.fetch,

  async scheduled(event, env, ctx) {
    const slot = CRON_SLOT[event.cron] ?? "check";
    const req = new Request("https://maddiehq.oqodo.com/api/coomander/run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-secret": env.COOMANDER_RUN_SECRET ?? "",
      },
      body: JSON.stringify({ slot }),
    });
    const res = await handler.fetch(req, env, ctx);
    const body = await res.text().catch(() => "");
    console.log(`[cron] coomander cron="${event.cron}" slot="${slot}" -> ${res.status} ${body}`);
  },
};

export default worker;
