export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { elaboratePattern } from "@/lib/ai/analyze-content";
import { BadRequestError, UnauthorizedError, errorResponse } from "@/lib/errors";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const body = (await request.json().catch(() => ({}))) as {
      title?: string;
      description?: string;
      evidence?: string;
    };

    if (!body.title || !body.description) {
      throw new BadRequestError("Missing title or description");
    }

    const elaboration = await elaboratePattern(session.user.id, {
      title: body.title,
      description: body.description,
      evidence: body.evidence ?? "",
    });

    return NextResponse.json({ elaboration });
  } catch (error) {
    return errorResponse(error);
  }
}
