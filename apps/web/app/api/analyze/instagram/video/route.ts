export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { processVideoPosts } from "@/lib/ai/video-analysis";
import { UnauthorizedError, errorResponse } from "@/lib/errors";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const result = await processVideoPosts(session.user.id);
    return NextResponse.json({ status: "ok", result });
  } catch (error) {
    return errorResponse(error);
  }
}
