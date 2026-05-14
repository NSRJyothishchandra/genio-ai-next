import { NextResponse } from "next/server";
import { sendMeetingInvite, isSmtpConfigured } from "@/lib/mail-send";
import { randomUUID } from "crypto";

export async function POST(request: Request) {
  if (!isSmtpConfigured()) {
    return NextResponse.json({ error: "SMTP not configured" }, { status: 503 });
  }
  try {
    const { subject, startDateTime, endDateTime, attendees, agenda, meetingUrl } =
      await request.json();

    if (!subject || !startDateTime || !endDateTime || !attendees?.length) {
      return NextResponse.json(
        { error: "subject, startDateTime, endDateTime, attendees required" },
        { status: 400 }
      );
    }

    const organizerEmail =
      process.env.OUTLOOK_SMTP_USER ||
      process.env.SMTP_USER ||
      process.env.BIRTHDAY_FROM_EMAIL ||
      "hr@bonfiglioli.com";

    await sendMeetingInvite({
      uid: randomUUID(),
      subject,
      description: agenda,
      startIso: startDateTime,
      endIso: endDateTime,
      organizerEmail,
      organizerName: "Bonfiglioli HR",
      attendeeEmails: attendees,
      meetingUrl,
    });

    return NextResponse.json({ invited: true, attendees });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
