export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { eq, desc, count, sql } from "drizzle-orm";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { jobs } from "@/lib/schema";
import { enqueueJob } from "@/lib/jobs";
import { queryFirst } from "@/lib/db-helpers";

export async function GET(req: NextRequest) {
  const { session, error } = await requirePermission(req, PERMISSIONS.ADMIN_SETTINGS);
  if (error) return error;
  void session;

  const db = getDb();

  const counts = await db
    .select({ status: jobs.status, count: count() })
    .from(jobs)
    .groupBy(jobs.status);

  const stats: Record<string, number> = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
  };
  for (const row of counts) {
    stats[row.status] = row.count;
  }

  const recentJobs = await db
    .select()
    .from(jobs)
    .orderBy(desc(jobs.createdAt))
    .limit(50);

  return NextResponse.json({ stats, jobs: recentJobs });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requirePermission(req, PERMISSIONS.ADMIN_SETTINGS);
  if (error) return error;
  void session;

  const body = (await req.json()) as { type?: string; payload?: Record<string, unknown> };
  if (!body.type || typeof body.type !== "string") {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }

  const jobId = await enqueueJob(body.type, body.payload);

  const job = await queryFirst(
    getDb()
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
  );

  return NextResponse.json({ job }, { status: 201 });
}
