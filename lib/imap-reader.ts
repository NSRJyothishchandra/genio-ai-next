// IMAP email reader — auto-derives config from existing SMTP env vars.
// Priority: explicit IMAP_* vars → Outlook SMTP creds → Gmail SMTP creds → Birthday SMTP creds
//
// Optional overrides in .env.local:
//   IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASS, IMAP_TLS (true/false)

import { ImapFlow } from "imapflow";

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

function smtpHostToImap(smtpHost: string): string {
  // smtp.gmail.com → imap.gmail.com
  // smtp.office365.com → outlook.office365.com
  if (smtpHost.includes("office365") || smtpHost.includes("outlook")) {
    return "outlook.office365.com";
  }
  return smtpHost.replace(/^smtp\./, "imap.");
}

export function getImapConfig(): ImapConfig | null {
  // 1. Explicit IMAP_* overrides
  if (process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASS) {
    return {
      host: process.env.IMAP_HOST,
      port: parseInt(process.env.IMAP_PORT || "993"),
      secure: process.env.IMAP_TLS !== "false",
      user: process.env.IMAP_USER,
      pass: process.env.IMAP_PASS,
    };
  }

  // 2. Outlook SMTP creds → Outlook IMAP
  if (process.env.OUTLOOK_SMTP_USER && process.env.OUTLOOK_SMTP_PASS) {
    return {
      host: smtpHostToImap(process.env.OUTLOOK_SMTP_HOST || "smtp.office365.com"),
      port: 993,
      secure: true,
      user: process.env.OUTLOOK_SMTP_USER,
      pass: process.env.OUTLOOK_SMTP_PASS,
    };
  }

  // 3. Gmail SMTP creds → Gmail IMAP
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    return {
      host: smtpHostToImap(process.env.SMTP_HOST || "smtp.gmail.com"),
      port: 993,
      secure: true,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    };
  }

  // 4. Birthday SMTP creds
  if (process.env.BIRTHDAY_SMTP_USER && process.env.BIRTHDAY_SMTP_PASS && process.env.BIRTHDAY_SMTP_HOST) {
    return {
      host: smtpHostToImap(process.env.BIRTHDAY_SMTP_HOST),
      port: parseInt(process.env.IMAP_PORT || "993"),
      secure: true,
      user: process.env.BIRTHDAY_SMTP_USER,
      pass: process.env.BIRTHDAY_SMTP_PASS,
    };
  }

  return null;
}

export function isImapConfigured(): boolean {
  return getImapConfig() !== null;
}

export interface InboxEmail {
  uid: number;
  messageId: string;
  subject: string;
  from: { name: string; address: string };
  to: { name: string; address: string }[];
  date: string;
  bodyPreview: string;
  isRead: boolean;
  hasAttachments: boolean;
}

export interface FullEmail extends InboxEmail {
  bodyHtml: string;
  bodyText: string;
  contentType: "html" | "text";
}

function makeClient(cfg: ImapConfig) {
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    tls: { rejectUnauthorized: false },
  });
}

export async function fetchInbox(limit = 25): Promise<InboxEmail[]> {
  const cfg = getImapConfig();
  if (!cfg) throw new Error("IMAP not configured");

  const client = makeClient(cfg);
  await client.connect();

  const emails: InboxEmail[] = [];

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const total = client.mailbox?.exists ?? 0;
      if (total === 0) return [];

      const start = Math.max(1, total - limit + 1);
      const range = `${start}:${total}`;

      for await (const msg of client.fetch(range, {
        uid: true,
        flags: true,
        envelope: true,
        bodyStructure: true,
        bodyParts: ["TEXT"],
      })) {
        const env = msg.envelope;
        const preview = (msg.bodyParts?.get("TEXT") as Buffer | undefined)
          ?.toString("utf8")
          .replace(/[\r\n]+/g, " ")
          .slice(0, 200) || "";

        emails.push({
          uid: msg.uid,
          messageId: env?.messageId || String(msg.uid),
          subject: env?.subject || "(no subject)",
          from: {
            name: env?.from?.[0]?.name || env?.from?.[0]?.address || "",
            address: env?.from?.[0]?.address || "",
          },
          to: (env?.to || []).map((a) => ({ name: a.name || "", address: a.address || "" })),
          date: env?.date?.toISOString() || new Date().toISOString(),
          bodyPreview: preview,
          isRead: msg.flags?.has("\\Seen") ?? false,
          hasAttachments: msg.bodyStructure?.childNodes?.some((n: { type?: string }) => n.type === "attachment") ?? false,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  return emails.reverse(); // newest first
}

export async function fetchEmailByUid(uid: number): Promise<FullEmail | null> {
  const cfg = getImapConfig();
  if (!cfg) throw new Error("IMAP not configured");

  const client = makeClient(cfg);
  await client.connect();

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      // Mark as read
      await client.messageFlagsAdd({ uid }, ["\\Seen"], { uid: true });

      let result: FullEmail | null = null;

      for await (const msg of client.fetch(
        { uid },
        { uid: true, flags: true, envelope: true, source: true },
        { uid: true }
      )) {
        const env = msg.envelope;
        const rawSource = (msg.source as Buffer | undefined)?.toString("utf8") || "";

        // Simple HTML / text extraction from raw source
        const htmlMatch = rawSource.match(/Content-Type: text\/html[^]*?(?:\r?\n\r?\n)([\s\S]*?)(?=\r?\n--|\s*$)/i);
        const textMatch = rawSource.match(/Content-Type: text\/plain[^]*?(?:\r?\n\r?\n)([\s\S]*?)(?=\r?\n--|\s*$)/i);

        const bodyHtml = htmlMatch?.[1]?.trim() || "";
        const bodyText = textMatch?.[1]?.trim() || rawSource.slice(0, 2000);

        result = {
          uid: msg.uid,
          messageId: env?.messageId || String(msg.uid),
          subject: env?.subject || "(no subject)",
          from: {
            name: env?.from?.[0]?.name || "",
            address: env?.from?.[0]?.address || "",
          },
          to: (env?.to || []).map((a) => ({ name: a.name || "", address: a.address || "" })),
          date: env?.date?.toISOString() || new Date().toISOString(),
          bodyPreview: bodyText.slice(0, 200),
          isRead: true,
          hasAttachments: false,
          bodyHtml,
          bodyText,
          contentType: bodyHtml ? "html" : "text",
        };
        break;
      }

      return result;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}
