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
 * MILESTONE 1: a single test cron (see wrangler.toml `[triggers]`). The ping is
 * unconditional and slot-agnostic; the route ignores the `slot` field for now.
 * Per-slot routing + planPing decision logic land in later milestones.
 *
 * Unlike geology there is no Sentry wrapper here — MaddieHQ does not depend on
 * @sentry/cloudflare. If server-side capture is added later, wrap `worker` the
 * same way geology does.
 */
import { default as handler } from "./.open-next/worker.js";

const worker = {
  fetch: handler.fetch,

  async scheduled(event, env, ctx) {
    const req = new Request("https://maddiehq.oqodo.com/api/coomander/run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-secret": env.COOMANDER_RUN_SECRET ?? "",
      },
      body: JSON.stringify({ slot: "check" }),
    });
    const res = await handler.fetch(req, env, ctx);
    const body = await res.text().catch(() => "");
    console.log(`[cron] coomander cron="${event.cron}" -> ${res.status} ${body}`);
  },
};

export default worker;
