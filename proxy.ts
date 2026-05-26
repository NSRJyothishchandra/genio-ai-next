import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, isValidSessionToken } from "./lib/admin-auth";

const PROTECTED_PAGE_PREFIXES = [
  // Original admin pages
  "/birthday",
  "/onboarding",
  "/timesheet/review",
  "/mail",
  // Newly moved to admin
  "/employees",
  "/timesheet",
  "/finance",
  "/assistant",
  "/integrations",
];

const PROTECTED_API_PREFIXES = [
  // Original admin APIs
  "/api/birthday",
  "/api/onboarding",
  "/api/activity",
  "/api/mail",
  // Newly moved to admin
  "/api/employees",
  "/api/timesheet",
  "/api/finance",
  "/api/claude",
  "/api/voice",
  "/api/integrations",
  "/api/requests",
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
