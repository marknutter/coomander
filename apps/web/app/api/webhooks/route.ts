import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { UnauthorizedError, BadRequestError, errorResponse } from "@/lib/errors";
import { createWebhook, getWebhooks } from "@/lib/webhooks";
import { assertSafeWebhookUrl } from "@/lib/ssrf";

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

    if (!url.startsWith("https://") && !(process.env.NODE_ENV !== "production" && url.startsWith("http://localhost"))) {
      throw new BadRequestError("Webhook URL must use HTTPS");
    }

    // SSRF protection: single source of truth (lib/ssrf.ts). Rejects non-http(s)
    // schemes, IP literals in private/loopback/link-local/CGNAT ranges, and DNS
    // names that resolve to such addresses. Throws on rejection → 400.
    try {
      await assertSafeWebhookUrl(url);
    } catch (err) {
      throw new BadRequestError(err instanceof Error ? err.message : "Invalid URL");
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
