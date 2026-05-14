import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, isValidSessionToken } from "./lib/admin-auth";

const PROTECTED_PAGE_PREFIXES = [
  "/birthday",
  "/onboarding",
  "/timesheet/review",
  "/mail",
];

const PROTECTED_API_PREFIXES = [
  "/api/birthday",
  "/api/onboarding",
  "/api/activity",
  "/api/mail",
];

function isProtectedPage(pathname: string) {
  if (pathname === "/login") return false;
  return PROTECTED_PAGE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isProtectedApi(pathname: string) {
  return PROTECTED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const authenticated = isValidSessionToken(token);

  if (pathname === "/login" && authenticated) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (!authenticated && isProtectedApi(pathname)) {
    return NextResponse.json({ error: "Admin login required." }, { status: 401 });
  }

  if (!authenticated && isProtectedPage(pathname)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|genio-ai-logo.png).*)"],
};
