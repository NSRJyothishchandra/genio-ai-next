import { NextResponse } from "next/server";
import { fetchInbox, fetchEmailByUid, isImapConfigured } from "@/lib/imap-reader";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isImapConfigured()) {
    return NextResponse.json({
      configured: false,
      emails: [],
      hint: "Add SMTP credentials (SMTP_USER + SMTP_PASS, or OUTLOOK_SMTP_USER + OUTLOOK_SMTP_PASS) to .env.local",
    });
  }
  try {
    const { searchParams } = new URL(request.url);

    // Single email by UID
    const uid = searchParams.get("uid");
    if (uid) {
      const email = await fetchEmailByUid(parseInt(uid));
      return NextResponse.json({ configured: true, email });
    }

    // Inbox list
    const limit = Math.min(parseInt(searchParams.get("limit") || "25"), 50);
    const emails = await fetchInbox(limit);
    return NextResponse.json({ configured: true, emails });
  } catch (e) {
    return NextResponse.json({ configured: true, error: String(e), emails: [] }, { status: 500 });
  }
}
