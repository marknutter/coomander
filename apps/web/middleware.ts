import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Next.js 16 introduced `proxy.ts` as the new middleware convention, but
// proxy.ts is hardcoded to the Node.js runtime — and OpenNext (Cloudflare
// adapter) requires Edge runtime for middleware. So we keep the older
// `middleware.ts` convention here, which defaults to Edge and is fully
// supported by both Vercel and OpenNext.
//
// Function name is `middleware` (the old convention's required export).
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect /app/* and /settings/* routes
  if (pathname.startsWith("/app") || pathname.startsWith("/settings")) {
    const sessionCookie = getSessionCookie(request);

    if (!sessionCookie) {
      return NextResponse.redirect(new URL("/auth?tab=login", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/settings/:path*"],
};
