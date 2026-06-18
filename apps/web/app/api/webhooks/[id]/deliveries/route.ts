import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { UnauthorizedError, NotFoundError, errorResponse } from "@/lib/errors";
import { getWebhook, getDeliveries } from "@/lib/webhooks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const { id } = await params;
    const webhook = await getWebhook(session.user.id, id);
    if (!webhook) throw new NotFoundError("Webhook not found");

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);
    const deliveries = await getDeliveries(id, limit);

    return NextResponse.json({ deliveries });
  } catch (error) {
    return errorResponse(error);
  }
}
