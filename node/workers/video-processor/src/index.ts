// Cloudflare Worker that hosts the VideoProcessor Container Class and
// exposes a simple HTTP API. The main coomander Worker reaches it via
// a service binding (`env.VIDEO_PROCESSOR` from getCloudflareContext()).

import { Container, getContainer } from "@cloudflare/containers";

export class VideoProcessor extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "3m";
}

export interface Env {
  VIDEO_PROCESSOR: DurableObjectNamespace<VideoProcessor>;
  SHARED_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname !== "/process-video" || request.method !== "POST") {
      return new Response("Not Found", { status: 404 });
    }

    // Shared-secret check — the calling Worker passes this header.
    const provided = request.headers.get("x-internal-secret");
    if (!env.SHARED_SECRET || provided !== env.SHARED_SECRET) {
      return new Response("Forbidden", { status: 403 });
    }

    // Route every video to a container instance — getContainer picks one
    // and spins it up on demand. The Container Class proxies HTTP to the
    // container's :8080 server.
    const instance = getContainer(env.VIDEO_PROCESSOR);
    const containerRequest = new Request("http://container/process-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: request.body,
    });
    return instance.fetch(containerRequest);
  },
};
