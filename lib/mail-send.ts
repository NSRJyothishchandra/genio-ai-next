// General-purpose email sender — reuses the existing SMTP transporter from lib/email.ts
// Works with Gmail, Outlook, or any SMTP already configured.

import nodemailer from "nodemailer";

type Provider = {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  fromEmail: string;
};

function getProvider(): Provider | null {
  // Same priority order as lib/email.ts
  if (process.env.OUTLOOK_SMTP_USER && process.env.OUTLOOK_SMTP_PASS) {
    return {
      host: process.env.OUTLOOK_SMTP_HOST || "smtp.office365.com",
      port: parseInt(process.env.OUTLOOK_SMTP_PORT || "587"),
      user: process.env.OUTLOOK_SMTP_USER,
      pass: process.env.OUTLOOK_SMTP_PASS,
      fromEmail: process.env.OUTLOOK_FROM_EMAIL || process.env.OUTLOOK_SMTP_USER,
    };
  }
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    return {
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT || "587"),
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      fromEmail: process.env.BIRTHDAY_FROM_EMAIL || process.env.SMTP_USER,
    };
  }
  if (process.env.BIRTHDAY_SMTP_HOST) {
    return {
      host: process.env.BIRTHDAY_SMTP_HOST,
      port: parseInt(process.env.BIRTHDAY_SMTP_PORT || "25"),
      user: process.env.BIRTHDAY_SMTP_USER || undefined,
      pass: process.env.BIRTHDAY_SMTP_PASS || undefined,
      fromEmail:
        process.env.BIRTHDAY_SMTP_FROM_EMAIL ||
        process.env.BIRTHDAY_FROM_EMAIL ||
        process.env.BIRTHDAY_SMTP_USER ||
        "noreply@bonfiglioli.com",
    };
  }
  return null;
}

export function isSmtpConfigured(): boolean {
  return getProvider() !== null;
}

function makeTransport(p: Provider) {
  return nodemailer.createTransport({
    host: p.host,
    port: p.port,
    secure: false,
    ...(p.user && p.pass ? { auth: { user: p.user, pass: p.pass } } : {}),
    tls: { rejectUnauthorized: false },
  });
}

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  cc?: string | string[];
  replyTo?: string;
  attachments?: {
    filename: string;
    content: string | Buffer;
    contentType?: string;
  }[];
}

export async function sendMail(opts: SendMailOptions): Promise<void> {
  const p = getProvider();
  if (!p) throw new Error("No SMTP provider configured");
  const transport = makeTransport(p);
  await transport.sendMail({
    from: `"Bonfiglioli Genio AI" <${p.fromEmail}>`,
    to: Array.isArray(opts.to) ? opts.to.join(", ") : opts.to,
    cc: opts.cc ? (Array.isArray(opts.cc) ? opts.cc.join(", ") : opts.cc) : undefined,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    replyTo: opts.replyTo,
    attachments: opts.attachments,
  });
}

// Build a RFC 5545 .ics calendar invite string
export interface IcsEvent {
  uid: string;
  subject: string;
  description?: string;
  location?: string;
  startIso: string; // e.g. "2025-05-20T10:00:00"
  endIso: string;
  organizerEmail: string;
  organizerName?: string;
  attendeeEmails: string[];
  meetingUrl?: string; // optional Teams/Meet/Zoom link
}

function toIcsDate(iso: string): string {
  // "2025-05-20T10:00:00" → "20250520T100000"
  return iso.replace(/[-:]/g, "").replace(/\.\d+/, "").slice(0, 15);
}

export function buildIcs(evt: IcsEvent): string {
  const description = [
    evt.description || "",
    evt.meetingUrl ? `\n\nJoin online: ${evt.meetingUrl}` : "",
  ]
    .join("")
    .trim();

  const attendeeLines = evt.attendeeEmails
    .map((e) => `ATTENDEE;RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:${e}`)
    .join("\r\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Bonfiglioli Genio AI//EN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${evt.uid}`,
    `DTSTART:${toIcsDate(evt.startIso)}`,
    `DTEND:${toIcsDate(evt.endIso)}`,
    `SUMMARY:${evt.subject}`,
    description ? `DESCRIPTION:${description.replace(/\n/g, "\\n")}` : "",
    evt.location ? `LOCATION:${evt.location}` : "",
    evt.meetingUrl ? `URL:${evt.meetingUrl}` : "",
    `ORGANIZER;CN=${evt.organizerName || "Bonfiglioli HR"}:mailto:${evt.organizerEmail}`,
    attendeeLines,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}

export async function sendMeetingInvite(evt: IcsEvent): Promise<void> {
  const p = getProvider();
  if (!p) throw new Error("No SMTP provider configured");

  const startStr = new Date(evt.startIso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const html = `
<p>You have been invited to a meeting.</p>
<table style="font-family:Arial,sans-serif;font-size:14px;border-collapse:collapse;">
  <tr><td style="padding:5px 16px 5px 0;font-weight:700;color:#64748b;">Meeting</td><td>${evt.subject}</td></tr>
  <tr><td style="padding:5px 16px 5px 0;font-weight:700;color:#64748b;">When</td><td>${startStr} IST</td></tr>
  ${evt.description ? `<tr><td style="padding:5px 16px 5px 0;font-weight:700;color:#64748b;">Details</td><td>${evt.description}</td></tr>` : ""}
  ${evt.meetingUrl ? `<tr><td style="padding:5px 16px 5px 0;font-weight:700;color:#64748b;">Join</td><td><a href="${evt.meetingUrl}" style="color:#6366f1;">${evt.meetingUrl}</a></td></tr>` : ""}
</table>
<p style="font-size:12px;color:#94a3b8;margin-top:16px;">— Bonfiglioli Genio AI</p>`;

  const icsContent = buildIcs(evt);

  const transport = makeTransport(p);
  await transport.sendMail({
    from: `"Bonfiglioli Genio AI" <${p.fromEmail}>`,
    to: evt.attendeeEmails.join(", "),
    subject: `Meeting Invite: ${evt.subject}`,
    html,
    attachments: [
      {
        filename: "invite.ics",
        content: icsContent,
        contentType: "text/calendar; method=REQUEST",
      },
    ],
  });
}
