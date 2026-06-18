/**
 * In-app notification helpers.
 *
 * Usage:
 *   import { createNotification, getUnreadCount } from "@/lib/notifications";
 *   await createNotification(userId, "welcome", "Welcome!", "Thanks for signing up.");
 */

import crypto from "crypto";
import { eq, and, desc, count } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { notifications } from "@/lib/schema";
import { log } from "@/lib/logger";
import { publish } from "@/lib/realtime";
import { queryFirst, executeChanges } from "@/lib/db-helpers";

export type NotificationType = "info" | "success" | "warning" | "error";

/**
 * Create a notification for a user.
 */
export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  message = "",
): Promise<string> {
  const db = getDb();
  const id = crypto.randomUUID();
  await db.insert(notifications).values({ id, userId, type, title, message });
  log.info("Notification created", { id, userId, type, title });

  // Publish to SSE subscribers for instant delivery
  publish(`notifications:${userId}`, {
    type: "new-notification",
    notification: { id, userId, type, title, message, read: 0, createdAt: Math.floor(Date.now() / 1000) },
  });

  return id;
}

/**
 * Get notifications for a user, newest first.
 */
export async function getNotifications(
  userId: string,
  limit = 50,
  offset = 0,
) {
  const db = getDb();
  return await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);
}

/**
 * Get unread notification count for a user.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const db = getDb();
  const row = await queryFirst(
    db
      .select({ count: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.read, 0)))
  );
  return row?.count ?? 0;
}

/**
 * Mark a single notification as read.
 */
export async function markRead(userId: string, notificationId: string): Promise<boolean> {
  const db = getDb();
  const changes = await executeChanges(
    db
      .update(notifications)
      .set({ read: 1 })
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
  );
  return changes > 0;
}

/**
 * Mark all notifications as read for a user.
 */
export async function markAllRead(userId: string): Promise<number> {
  const db = getDb();
  return await executeChanges(
    db
      .update(notifications)
      .set({ read: 1 })
      .where(and(eq(notifications.userId, userId), eq(notifications.read, 0)))
  );
}
