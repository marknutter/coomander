/**
 * In-process pub/sub for real-time SSE delivery.
 *
 * Uses an in-memory Map of channel → subscriber controllers.
 * This works for single-process deployments only.
 *
 * TODO: For multi-process deployments (e.g. behind a load balancer or in a
 * cluster), replace this with a Redis-backed pub/sub (e.g. ioredis subscribe/publish)
 * so events propagate across all Node processes.
 *
 * Usage:
 *   import { subscribe, unsubscribe, publish } from "@/lib/realtime";
 *   const controller = subscribe("notifications:user123");
 *   publish("notifications:user123", { type: "new-notification", data: { ... } });
 *   unsubscribe("notifications:user123", controller);
 */

import { log } from "@/lib/logger";

type Controller = ReadableStreamDefaultController;

const channels = new Map<string, Set<Controller>>();

/**
 * Subscribe a stream controller to a channel.
 */
export function subscribe(channel: string, controller: Controller): void {
  if (!channels.has(channel)) {
    channels.set(channel, new Set());
  }
  channels.get(channel)!.add(controller);
  log.debug("SSE subscriber added", { channel, count: channels.get(channel)!.size });
}

/**
 * Unsubscribe a stream controller from a channel.
 */
export function unsubscribe(channel: string, controller: Controller): void {
  const subs = channels.get(channel);
  if (!subs) return;
  subs.delete(controller);
  if (subs.size === 0) {
    channels.delete(channel);
  }
  log.debug("SSE subscriber removed", { channel, remaining: subs.size });
}

/**
 * Publish an event to all subscribers on a channel.
 * Automatically removes dead controllers that throw on enqueue.
 */
export function publish(channel: string, data: Record<string, unknown>): void {
  const subs = channels.get(channel);
  if (!subs || subs.size === 0) return;

  const message = `data: ${JSON.stringify(data)}\n\n`;
  const encoder = new TextEncoder();
  const encoded = encoder.encode(message);

  for (const controller of subs) {
    try {
      controller.enqueue(encoded);
    } catch {
      // Controller is closed / errored — remove it
      subs.delete(controller);
    }
  }

  log.debug("SSE event published", { channel, subscribers: subs.size });
}
