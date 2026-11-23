import { NextResponse, type NextRequest } from "next/server";

/**
 * Hands the request path to server components as `x-tbook-pathname`. Layouts
 * don't know the URL, but the admin shell needs it on the very first render
 * to draw the event/group sidebar section and breadcrumbs already filled in
 * (otherwise they pop in after hydration and push the page around).
 * Always overwritten here, so a client can't spoof it.
 */
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-tbook-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/admin/:path*"] };
