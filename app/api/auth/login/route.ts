import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, buildSessionToken, validateAdminCredentials } from "@/lib/admin-auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");

    if (!validateAdminCredentials(username, password)) {
      return NextResponse.json({ error: "Invalid admin username or password." }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set(ADMIN_SESSION_COOKIE, buildSessionToken(), {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Unable to complete admin login." }, { status: 500 });
  }
}

