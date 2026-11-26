import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { buildCsp } from "@/lib/csp";

/**
 * 1. Content-Security-Policy with a fresh nonce for every page render.
 * 2. Optimistic auth redirect for protected pages (cookie presence only).
 *    Real authorization happens in src/server/session.ts on every request.
 */
const PROTECTED = ["/dashboard", "/workflows", "/executions", "/assets", "/collections", "/integrations", "/settings", "/activity"];
const isProtected = (path: string) => PROTECTED.some((p) => path === p || path.startsWith(p + "/"));

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isProtected(pathname) && !getSessionCookie(request)) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, {
    dev: process.env.NODE_ENV === "development",
    https: (process.env.APPLICATION_URL ?? "").startsWith("https://"),
  });
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: API routes, static files and prefetches don't need a CSP nonce.
      source: "/((?!api|_next/static|_next/image|icon.svg|orbyte-.*\\.svg|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
