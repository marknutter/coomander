import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { UnauthorizedError, NotFoundError, errorResponse } from "@/lib/errors";
import { markRead } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const { id } = await params;
    const updated = await markRead(session.user.id, id);
    if (!updated) throw new NotFoundError("Notification not found");

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
