export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { UnauthorizedError, errorResponse } from "@/lib/errors";
import {
  exchangeCodeForToken,
  storeToken,
  upgradeToLongLivedToken,
} from "@/lib/platforms/instagram";

const STATE_COOKIE = "ig_oauth_state";

function resolveRedirectUri(request: Request): string {
  const explicit = process.env.INSTAGRAM_OAUTH_REDIRECT_URI;
  if (explicit) return explicit;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}/api/platforms/instagram/oauth/callback`;
}

function failureRedirect(request: Request, code: string): NextResponse {
  const dest = new URL("/app/insights", request.url);
  dest.searchParams.set("error", code);
  const res = NextResponse.redirect(dest);
  res.cookies.delete(STATE_COOKIE);
  return res;
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      console.warn("[ig-oauth] user denied or provider error", { error });
      return failureRedirect(request, error);
    }

    if (!code || !state) {
      return failureRedirect(request, "missing_code_or_state");
    }

    const cookieState = request.headers
      .get("cookie")
      ?.split(/;\s*/)
      .find((c) => c.startsWith(`${STATE_COOKIE}=`))
      ?.split("=")[1];

    if (!cookieState || cookieState !== state) {
      return new NextResponse("Invalid OAuth state", { status: 400 });
    }

    const clientId = process.env.INSTAGRAM_CLIENT_ID;
    const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return failureRedirect(request, "server_not_configured");
    }

    const redirectUri = resolveRedirectUri(request);

    let shortLived;
    try {
      shortLived = await exchangeCodeForToken({
        clientId,
        clientSecret,
        code,
        redirectUri,
      });
    } catch (err) {
      console.warn("[ig-oauth] code exchange failed", { err: (err as Error).message });
      return failureRedirect(request, "code_exchange_failed");
    }

    let longLived;
    try {
      longLived = await upgradeToLongLivedToken({
        clientSecret,
        shortLivedToken: shortLived.access_token,
      });
    } catch (err) {
      console.warn("[ig-oauth] long-lived upgrade failed", { err: (err as Error).message });
      return failureRedirect(request, "token_upgrade_failed");
    }

    try {
      await storeToken(session.user.id, longLived.access_token, longLived.expires_in);
    } catch (err) {
      console.warn("[ig-oauth] storeToken failed", { err: (err as Error).message });
      return failureRedirect(request, "token_store_failed");
    }

    const success = NextResponse.redirect(new URL("/app/insights?connected=1", request.url));
    success.cookies.delete(STATE_COOKIE);
    return success;
  } catch (error) {
    return errorResponse(error);
  }
}
