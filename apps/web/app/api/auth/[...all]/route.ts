import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { authRateLimit } from "@/lib/rate-limit";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handler = toNextJsHandler(auth);

export const GET = handler.GET;

export async function POST(request: NextRequest) {
  const limited = authRateLimit.check(request);
  if (limited) return limited;
  return handler.POST(request);
}
