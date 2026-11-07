import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";

/**
 * Optimistic gate only. A cookie's presence is not proof of a valid session;
 * every protected page and action still re-authorizes against the database.
 * This exists so a request with no session cookie is redirected before the
 * partially prerendered shell can flush a 200 response.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE_NAME)) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  const response = NextResponse.redirect(loginUrl, 307);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/catalogue/:path*",
    "/cart/:path*",
    "/orders/:path*",
    "/retailers/:path*",
    "/users/:path*",
    "/products/:path*",
    "/inventory/:path*",
    "/schemes/:path*",
    "/audit-logs/:path*",
    "/account/:path*",
  ],
};
