export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import crypto from "crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { UnauthorizedError, BadRequestError, errorResponse } from "@/lib/errors";

const STATE_COOKIE = "ig_oauth_state";
const STATE_TTL_SECONDS = 600;
const IG_SCOPES = "instagram_business_basic,instagram_business_manage_insights";

function resolveRedirectUri(request: Request): string {
  const explicit = process.env.INSTAGRAM_OAUTH_REDIRECT_URI;
  if (explicit) return explicit;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}/api/platforms/instagram/oauth/callback`;
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const clientId = process.env.INSTAGRAM_CLIENT_ID;
    if (!clientId) {
      throw new BadRequestError(
        "INSTAGRAM_CLIENT_ID is not configured on the server.",
      );
    }

    const state = crypto.randomBytes(24).toString("hex");
    const redirectUri = resolveRedirectUri(request);

    const authorizeUrl = new URL("https://api.instagram.com/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("scope", IG_SCOPES);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("state", state);

    const response = NextResponse.redirect(authorizeUrl.toString());
    response.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: STATE_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
