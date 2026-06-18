import { NextRequest, NextResponse } from "next/server";
import { eq, like, desc, count } from "drizzle-orm";
import { logAdminAction } from "@/lib/admin";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { newsletterSubscribers } from "@/lib/schema";
import { queryFirst, executeChanges } from "@/lib/db-helpers";

export async function GET(req: NextRequest) {
  const { error } = await requirePermission(req, PERMISSIONS.ADMIN_CRM);
  if (error) return error;

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? "50")));
  const offset = (page - 1) * limit;

  const where = search ? like(newsletterSubscribers.email, `%${search}%`) : undefined;

  const totalRow = await queryFirst(
    db
      .select({ count: count() })
      .from(newsletterSubscribers)
      .where(where)
  );
  const total = totalRow?.count ?? 0;

  const subscribers = await db
    .select({
      id: newsletterSubscribers.id,
      email: newsletterSubscribers.email,
      status: newsletterSubscribers.status,
      created_at: newsletterSubscribers.created_at,
    })
    .from(newsletterSubscribers)
    .where(where)
    .orderBy(desc(newsletterSubscribers.created_at))
    .limit(limit)
    .offset(offset);

  return NextResponse.json({ data: subscribers, total, page, limit });
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
