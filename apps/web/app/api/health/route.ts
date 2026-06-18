import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { user as userTable } from "@/lib/schema";

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Health check endpoint.
 * @openapi
 * /api/health:
 *   get:
 *     summary: Health check
 *     description: Returns the health status of the application, database, and auth system.
 *     tags:
 *       - System
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 db:
 *                   type: boolean
 *                 auth:
 *                   type: boolean
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       503:
 *         description: Service is degraded
 */
export async function GET() {
  let dbOk = false;
  let authOk = false;

  // Both checks via Drizzle so the same code path works across sqlite, pg,
  // and d1. Querying the `user` table verifies both that the connection
  // is alive (dbOk) and that the auth schema is in place (authOk).
  try {
    const db = getDb();
    await db.select({ id: userTable.id }).from(userTable).limit(1);
    dbOk = true;
    authOk = true;
  } catch (error) {
    console.error("Health check error:", error);
  }

  const ok = dbOk && authOk;
  const status = ok ? 200 : 503;

  return NextResponse.json(
    {
      ok,
      db: dbOk,
      auth: authOk,
      timestamp: new Date().toISOString(),
    },
    { status }
  );
}
