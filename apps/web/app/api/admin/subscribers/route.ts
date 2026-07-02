export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { eq, like, desc, count } from "drizzle-orm";
import { logAdminAction } from "@/lib/admin";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { newsletterSubscribers } from "@/lib/schema";
import { queryFirst, executeChanges } from "@/lib/db-helpers";
import { parseTags, serializeTags } from "@/lib/audiences";

export async function GET(req: NextRequest) {
  const { error } = await requirePermission(req, PERMISSIONS.ADMIN_CRM);
  if (error) return error;

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") ?? "";
  const tag = (searchParams.get("tag") ?? "").trim();
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const limit = Math.min(10000, Math.max(1, Number(searchParams.get("limit") ?? "50")));
  const offset = (page - 1) * limit;

  const where = search ? like(newsletterSubscribers.email, `%${search}%`) : undefined;

  // Tag filtering (#596/#222): tags are a JSON blob, so it can't be pushed into
  // portable SQL. Load the full search-filtered set, narrow by tag in JS, and
  // paginate — so total/pagination/CSV reflect the WHOLE tagged list, not just
  // the current page. (A subscriber "list" is a tag, so this must be complete.)
  if (tag) {
    const allRows = await db
      .select({
        id: newsletterSubscribers.id,
        email: newsletterSubscribers.email,
        status: newsletterSubscribers.status,
        tags: newsletterSubscribers.tags,
        created_at: newsletterSubscribers.created_at,
      })
      .from(newsletterSubscribers)
      .where(where)
      .orderBy(desc(newsletterSubscribers.created_at))
      .all();

    const matching = allRows.filter((s) => parseTags(s.tags).includes(tag));
    const pageRows = matching
      .slice(offset, offset + limit)
      .map((s) => ({ ...s, tags: parseTags(s.tags) }));
    return NextResponse.json({ data: pageRows, total: matching.length, page, limit });
  }

  const totalRow = await queryFirst(
    db
      .select({ count: count() })
      .from(newsletterSubscribers)
      .where(where)
  );
  const total = totalRow?.count ?? 0;

  const rows = await db
    .select({
      id: newsletterSubscribers.id,
      email: newsletterSubscribers.email,
      status: newsletterSubscribers.status,
      tags: newsletterSubscribers.tags,
      created_at: newsletterSubscribers.created_at,
    })
    .from(newsletterSubscribers)
    .where(where)
    .orderBy(desc(newsletterSubscribers.created_at))
    .limit(limit)
    .offset(offset);

  // Return tags as a parsed string[] so the admin UI doesn't re-parse JSON.
  const subscribers = rows.map((s) => ({ ...s, tags: parseTags(s.tags) }));

  return NextResponse.json({ data: subscribers, total, page, limit });
}

/**
 * Replace a subscriber's tag set (#596/#222). Tags are how lists/segments are
 * modeled, so this is the membership-management primitive. Body: { email, tags }.
 */
export async function PATCH(req: NextRequest) {
  const { session, error } = await requirePermission(req, PERMISSIONS.ADMIN_CRM);
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }
  if (!Array.isArray(body.tags)) {
    return NextResponse.json({ error: "tags must be an array of strings" }, { status: 400 });
  }
  const tags = serializeTags(body.tags.filter((t): t is string => typeof t === "string"));

  const db = getDb();
  const changes = await executeChanges(
    db.update(newsletterSubscribers).set({ tags }).where(eq(newsletterSubscribers.email, email))
  );
  if (changes === 0) {
    return NextResponse.json({ error: "Subscriber not found" }, { status: 404 });
  }

  await logAdminAction(session.user.id, "subscriber_tags_update", "subscriber", email, {
    tags: parseTags(tags),
  });

  const subscriber = await queryFirst(
    db
      .select({
        id: newsletterSubscribers.id,
        email: newsletterSubscribers.email,
        status: newsletterSubscribers.status,
        tags: newsletterSubscribers.tags,
        created_at: newsletterSubscribers.created_at,
      })
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.email, email))
  );

  return NextResponse.json({ data: subscriber ? { ...subscriber, tags: parseTags(subscriber.tags) } : null });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requirePermission(req, PERMISSIONS.ADMIN_CRM);
  if (error) return error;

  const body = await req.json();
  const email = (body.email ?? "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const db = getDb();
  const status = body.status ?? "active";
  try {
    await db
      .insert(newsletterSubscribers)
      .values({ email, status });
  } catch {
    return NextResponse.json({ error: "Email already subscribed" }, { status: 409 });
  }

  // Fetch the inserted row by email (works for both SQLite and PG)
  const subscriber = await queryFirst(
    db
      .select({
        id: newsletterSubscribers.id,
        email: newsletterSubscribers.email,
        status: newsletterSubscribers.status,
        created_at: newsletterSubscribers.created_at,
      })
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.email, email))
  );

  await logAdminAction(session.user.id, "subscriber_add", "subscriber", email);

  return NextResponse.json({ data: subscriber }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { session, error } = await requirePermission(req, PERMISSIONS.ADMIN_CRM);
  if (error) return error;

  const email = new URL(req.url).searchParams.get("email") ?? "";
  if (!email) {
    return NextResponse.json({ error: "email query param required" }, { status: 400 });
  }

  const changes = await executeChanges(
    getDb()
      .delete(newsletterSubscribers)
      .where(eq(newsletterSubscribers.email, email))
  );
  if (changes === 0) {
    return NextResponse.json({ error: "Subscriber not found" }, { status: 404 });
  }

  await logAdminAction(session.user.id, "subscriber_delete", "subscriber", email);

  return NextResponse.json({ data: { deleted: true } });
}
