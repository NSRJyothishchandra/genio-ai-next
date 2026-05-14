import { NextResponse } from "next/server";
import { sendMail, isSmtpConfigured } from "@/lib/mail-send";

export async function POST(request: Request) {
  if (!isSmtpConfigured()) {
    return NextResponse.json({ error: "SMTP not configured" }, { status: 503 });
  }
  try {
    const { to, subject, body, inReplyTo } = await request.json();
    if (!to || !body) {
      return NextResponse.json({ error: "to and body are required" }, { status: 400 });
    }
    await sendMail({
      to: Array.isArray(to) ? to : [to],
      subject: subject?.startsWith("Re:") ? subject : `Re: ${subject || ""}`,
      html: body,
      replyTo: inReplyTo,
    });
    return NextResponse.json({ sent: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
