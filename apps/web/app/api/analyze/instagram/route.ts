export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  analyzeUnanalyzedPosts,
  generateContentReport,
  getLatestReport,
} from "@/lib/ai/analyze-content";
import { UnauthorizedError, errorResponse } from "@/lib/errors";

type Action = "analyze" | "report" | "full";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const body = (await request.json().catch(() => ({}))) as { action?: Action };
    const action: Action = body.action ?? "full";
    const userId = session.user.id;

    if (action === "analyze") {
      const result = await analyzeUnanalyzedPosts(userId);
      return NextResponse.json({ status: "ok", result });
    }

    if (action === "report") {
      const report = await generateContentReport(userId);
      return NextResponse.json({ status: "ok", report });
    }

    const analyzeResult = await analyzeUnanalyzedPosts(userId);
    const report = await generateContentReport(userId);
    return NextResponse.json({ status: "ok", analyzeResult, report });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const report = await getLatestReport(session.user.id);

    if (!report) {
      return NextResponse.json({
        report: null,
        message: "No analysis report yet. Run POST /api/analyze/instagram to generate one.",
      });
    }

    return NextResponse.json({ report });
  } catch (error) {
    return errorResponse(error);
  }
}
