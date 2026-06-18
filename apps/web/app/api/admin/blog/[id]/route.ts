import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { logAdminAction } from "@/lib/admin";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { blogPosts, user } from "@/lib/schema";
import { queryFirst } from "@/lib/db-helpers";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requirePermission(req, PERMISSIONS.ADMIN_CRM);
  if (error) return error;

  const { id } = await params;
  const db = getDb();

  const post = await queryFirst(
    db
      .select({
        id: blogPosts.id,
        title: blogPosts.title,
        slug: blogPosts.slug,
        content: blogPosts.content,
        status: blogPosts.status,
        author_id: blogPosts.author_id,
        author_email: user.email,
        published_at: blogPosts.published_at,
        created_at: blogPosts.created_at,
        updated_at: blogPosts.updated_at,
      })
      .from(blogPosts)
      .leftJoin(user, eq(user.id, blogPosts.author_id))
      .where(eq(blogPosts.id, Number(id)))
  );

  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  return NextResponse.json({ data: post });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requirePermission(req, PERMISSIONS.ADMIN_CRM);
  if (error) return error;

  const { id } = await params;
  const numericId = Number(id);
  const db = getDb();

  const existing = await queryFirst(
    db
      .select()
      .from(blogPosts)
      .where(eq(blogPosts.id, numericId))
  );

  if (!existing) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  const body = await req.json();
  const title = body.title ?? existing.title;
  const slug = body.slug ?? existing.slug;
  const content = body.content ?? existing.content;
  const newStatus = body.status ?? existing.status;
  const postStatus = newStatus === "published" ? "published" : "draft";

  let publishedAt = existing.published_at;
  if (postStatus === "published" && existing.status !== "published") {
    publishedAt = new Date().toISOString();
  } else if (postStatus === "draft") {
    publishedAt = null;
  }

  try {
    await db.update(blogPosts)
      .set({
        title,
        slug,
        content,
        status: postStatus,
        published_at: publishedAt,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(blogPosts.id, numericId));
  } catch {
    return NextResponse.json({ error: "Slug already exists" }, { status: 409 });
  }

  const updated = await queryFirst(db.select().from(blogPosts).where(eq(blogPosts.id, numericId)));

  await logAdminAction(session.user.id, "blog_post_update", "blog_post", id, { title, status: postStatus });

  return NextResponse.json({ data: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requirePermission(req, PERMISSIONS.ADMIN_CRM);
  if (error) return error;

  const { id } = await params;
  const numericId = Number(id);
  const db = getDb();

  const existing = await queryFirst(
    db
      .select({ title: blogPosts.title })
      .from(blogPosts)
      .where(eq(blogPosts.id, numericId))
  );

  if (!existing) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  await db.delete(blogPosts).where(eq(blogPosts.id, numericId));

  await logAdminAction(session.user.id, "blog_post_delete", "blog_post", id, { title: existing.title });

  return NextResponse.json({ data: { deleted: true } });
}
