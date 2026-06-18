import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { UnauthorizedError, NotFoundError, BadRequestError, errorResponse } from "@/lib/errors";
import { getWebhook, updateWebhook, deleteWebhook } from "@/lib/webhooks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const { id } = await params;
    const webhook = await getWebhook(session.user.id, id);
    if (!webhook) throw new NotFoundError("Webhook not found");

    // Strip secret from response
    const { secret, ...safe } = webhook;
    return NextResponse.json({ webhook: safe });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const { id } = await params;
    const body = await request.json();

    if (body.url) {
      try {
        new URL(body.url);
      } catch {
        throw new BadRequestError("Invalid URL");
      }

      if (!body.url.startsWith("https://") && !(process.env.NODE_ENV !== "production" && body.url.startsWith("http://localhost"))) {
        throw new BadRequestError("Webhook URL must use HTTPS");
      }

      // Block internal/private IP ranges (SSRF protection)
      const parsed = new URL(body.url);
      const hostname = parsed.hostname;
      const blockedPatterns = [
        /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
        /^169\.254\./, /^0\./, /^::1$/, /^localhost$/i,
        /^metadata\.google\.internal$/i, /^metadata\.internal$/i,
      ];
      if (process.env.NODE_ENV === "production" && blockedPatterns.some((p) => p.test(hostname))) {
        throw new BadRequestError("Webhook URL cannot target internal addresses");
      }
    }

    const updated = await updateWebhook(session.user.id, id, body);
    if (!updated) throw new NotFoundError("Webhook not found");

    const webhook = await getWebhook(session.user.id, id);
    const { secret, ...safe } = webhook!;
    return NextResponse.json({ webhook: safe });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const { id } = await params;
    const deleted = await deleteWebhook(session.user.id, id);
    if (!deleted) throw new NotFoundError("Webhook not found");

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
