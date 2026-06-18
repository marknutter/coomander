import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { newsletterSubscribers } from "@/lib/schema";
import { removeContact } from "@/lib/marketing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function unsubscribeByToken(token: string): Promise<{ email: string } | null> {
  const db = getDb();

  const rows = await db
    .select({ id: newsletterSubscribers.id, email: newsletterSubscribers.email })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.unsubscribe_token, token))
    .all();

  const subscriber = rows[0];
  if (!subscriber) return null;

  await db.update(newsletterSubscribers)
    .set({
      status: "unsubscribed",
      unsubscribed_at: new Date().toISOString(),
    })
    .where(eq(newsletterSubscribers.unsubscribe_token, token))
    .run();

  removeContact(subscriber.email);
  return { email: subscriber.email };
}

// GET /api/unsubscribe?token=xxx — one-click unsubscribe (CAN-SPAM/GDPR)
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const result = await unsubscribeByToken(token);
  if (!result) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 404 });
  }

  return NextResponse.redirect(new URL("/unsubscribed", req.url));
}

// POST /api/unsubscribe?token=xxx — RFC 8058 List-Unsubscribe-Post
export async function POST(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const result = await unsubscribeByToken(token);
  if (!result) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 404 });
  }

  return NextResponse.json({ data: { unsubscribed: true } });
}
