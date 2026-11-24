import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Optimistic routing only: checks for the presence of a session cookie to
 * avoid rendering protected pages for signed-out visitors. Real authorization
 * happens in src/server/session.ts on every request.
 */
const AUTH_PAGES = ["/login", "/signup"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request));

  if (!hasSession && !AUTH_PAGES.includes(pathname)) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  // Signed-in users visiting /login are redirected by the page itself after a
  // real session check; doing it here would loop on a stale cookie.
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/login",
    "/signup",
    "/dashboard/:path*",
    "/workflows/:path*",
    "/executions/:path*",
    "/assets/:path*",
    "/collections/:path*",
    "/integrations/:path*",
    "/settings/:path*",
    "/activity/:path*",
  ],
};
