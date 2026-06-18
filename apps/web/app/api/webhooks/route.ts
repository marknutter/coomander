import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { UnauthorizedError, BadRequestError, errorResponse } from "@/lib/errors";
import { createWebhook, getWebhooks } from "@/lib/webhooks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const webhooks = await getWebhooks(session.user.id);
    // Strip secrets from response
    const safe = webhooks.map(({ secret, ...rest }) => rest);

    return NextResponse.json({ webhooks: safe });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const { url, events } = await request.json();
    if (!url || typeof url !== "string") throw new BadRequestError("URL is required");

    try {
      new URL(url);
    } catch {
      throw new BadRequestError("Invalid URL");
    }

    if (!url.startsWith("https://") && !(process.env.NODE_ENV !== "production" && url.startsWith("http://localhost"))) {
      throw new BadRequestError("Webhook URL must use HTTPS");
    }

    // Block internal/private IP ranges (SSRF protection)
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    const blockedPatterns = [
      /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
      /^169\.254\./, /^0\./, /^::1$/, /^localhost$/i,
      /^metadata\.google\.internal$/i, /^metadata\.internal$/i,
    ];
    if (process.env.NODE_ENV === "production" && blockedPatterns.some((p) => p.test(hostname))) {
      throw new BadRequestError("Webhook URL cannot target internal addresses");
    }

    const webhook = await createWebhook(
      session.user.id,
      url,
      Array.isArray(events) ? events : [],
    );

    return NextResponse.json({ webhook }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
