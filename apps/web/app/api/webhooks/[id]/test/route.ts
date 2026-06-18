import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { UnauthorizedError, NotFoundError, errorResponse } from "@/lib/errors";
import { sendTestWebhook } from "@/lib/webhooks";

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

    try {
      const delivery = await sendTestWebhook(session.user.id, id);
      return NextResponse.json({ delivery });
    } catch (err) {
      if (err instanceof Error && err.message === "Webhook not found") {
        throw new NotFoundError("Webhook not found");
      }
      // Return the delivery result even if the test failed
      return NextResponse.json({
        delivery: null,
        error: err instanceof Error ? err.message : "Test delivery failed",
      });
    }
  } catch (error) {
    return errorResponse(error);
  }
}
