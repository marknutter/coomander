import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { rateLimit } from "@/lib/rate-limit";
import { getDb } from "@/lib/db";
import { newsletterSubscribers } from "@/lib/schema";

export async function POST(req: NextRequest) {
  const limited = rateLimit.check(req);
  if (limited) return limited;

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
  }

  try {
    await getDb()
      .insert(newsletterSubscribers)
      .values({ email, status: "active", unsubscribe_token: randomUUID() });
  } catch (err) {
    // UNIQUE constraint → already subscribed; treat as success to avoid leaking subscriber info
    const code = (err as { code?: string }).code;
    if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT" || code === "23505") {
      return NextResponse.json({ data: { subscribed: true } });
    }
    throw err;
  }

  return NextResponse.json({ data: { subscribed: true } }, { status: 201 });
}
