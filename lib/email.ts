import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import { getBirthdayCardContent, getThemeForEmployee, type CardTheme } from "./birthday-cards";
import { getEmployees } from "./employees";

export interface BirthdayEmailDraft {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  html: string;
  text: string;
  theme: CardTheme;
  previewUrl: string;
}

export interface BirthdayEmailResult {
  sent: boolean;
  simulated: boolean;
  draft: BirthdayEmailDraft;
  error?: string;
}

export interface LeaveRequestMailInput {
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  startDate: string;
  endDate: string;
  reason: string;
  requestId: string;
  createdAt: string;
}

type InlinePhotoAttachment = {
  cid: string;
  filename: string;
  content: Buffer;
  contentType: string;
};

type FileAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

type MailProvider = {
  label: string;
  host: string;
  port: number;
  user?: string;
  pass?: string;
  fromEmail: string;
};

export interface BirthdayMailSettings {
  customTo: string[];
  customCc: string[];
  excludedCc: string[];
}

const BIRTHDAY_SETTINGS_FILE = path.join(process.cwd(), "data", "birthday-mail-settings.json");

function getDefaultMailProviders(): MailProvider[] {
  const providers: MailProvider[] = [];

  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    providers.push({
      label: "gmail",
      host: process.env.SMTP_HOST ?? "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT ?? "587", 10),
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      fromEmail: process.env.BIRTHDAY_FROM_EMAIL ?? process.env.SMTP_USER,
    });
  }

  if (process.env.OUTLOOK_SMTP_USER && process.env.OUTLOOK_SMTP_PASS) {
    providers.push({
      label: "outlook",
      host: process.env.OUTLOOK_SMTP_HOST ?? "smtp.office365.com",
      port: parseInt(process.env.OUTLOOK_SMTP_PORT ?? "587", 10),
      user: process.env.OUTLOOK_SMTP_USER,
      pass: process.env.OUTLOOK_SMTP_PASS,
      fromEmail: process.env.OUTLOOK_FROM_EMAIL ?? process.env.OUTLOOK_SMTP_USER,
    });
  }

  return providers;
}

function getBirthdayMailProviders(): MailProvider[] {
  const providers: MailProvider[] = [];

  if (process.env.BIRTHDAY_SMTP_HOST) {
    providers.push({
      label: "birthday-local-smtp",
      host: process.env.BIRTHDAY_SMTP_HOST,
      port: parseInt(process.env.BIRTHDAY_SMTP_PORT ?? "25", 10),
      user: process.env.BIRTHDAY_SMTP_USER || undefined,
      pass: process.env.BIRTHDAY_SMTP_PASS || undefined,
      fromEmail:
        process.env.BIRTHDAY_SMTP_FROM_EMAIL ??
        process.env.BIRTHDAY_FROM_EMAIL ??
        process.env.BIRTHDAY_SMTP_USER ??
        getPrimarySenderEmail(),
    });
  }

  if (providers.length > 0) {
    return providers;
  }

  return getDefaultMailProviders();
}

function createTransporter(provider: MailProvider) {
  return nodemailer.createTransport({
    host: provider.host,
    port: provider.port,
    secure: false,
    ...(provider.user && provider.pass
      ? {
          auth: {
            user: provider.user,
            pass: provider.pass,
          },
        }
      : {}),
    tls: { rejectUnauthorized: false },
  });
}

function getPrimarySenderEmail() {
  return process.env.BIRTHDAY_FROM_EMAIL ?? process.env.SMTP_USER ?? process.env.OUTLOOK_FROM_EMAIL ?? process.env.OUTLOOK_SMTP_USER ?? "btest4651@gmail.com";
}

function getDefaultNotifyList(): string[] {
  const raw =
    process.env.BIRTHDAY_NOTIFY_EMAILS ??
    "narayana.jyothishchandra@gmail.com,testbonfiglioli@gmail.com,jyothishchandra.y@bonfiglioli.com";

  return raw
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
}

function ensureBirthdaySettingsFile() {
  const dir = path.dirname(BIRTHDAY_SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(BIRTHDAY_SETTINGS_FILE)) {
    fs.writeFileSync(
      BIRTHDAY_SETTINGS_FILE,
      JSON.stringify({ customTo: [], customCc: [], excludedCc: [] }, null, 2)
    );
  }
}

export function getBirthdayMailSettings(): BirthdayMailSettings {
  ensureBirthdaySettingsFile();
  try {
    const raw = JSON.parse(fs.readFileSync(BIRTHDAY_SETTINGS_FILE, "utf-8")) as Partial<BirthdayMailSettings>;
    return {
      customTo: Array.isArray(raw.customTo) ? raw.customTo.map((email) => String(email).trim()).filter(Boolean) : [],
      customCc: Array.isArray(raw.customCc) ? raw.customCc.map((email) => String(email).trim()).filter(Boolean) : [],
      excludedCc: Array.isArray(raw.excludedCc) ? raw.excludedCc.map((email) => String(email).trim()).filter(Boolean) : [],
    };
  } catch {
    return { customTo: [], customCc: [], excludedCc: [] };
  }
}

export function updateBirthdayMailSettings(
  updates: Partial<BirthdayMailSettings>
): BirthdayMailSettings {
  const current = getBirthdayMailSettings();
  const next: BirthdayMailSettings = {
    customTo: Array.isArray(updates.customTo) ? updates.customTo : current.customTo,
    customCc: Array.isArray(updates.customCc) ? updates.customCc : current.customCc,
    excludedCc: Array.isArray(updates.excludedCc) ? updates.excludedCc : current.excludedCc,
  };
  fs.writeFileSync(BIRTHDAY_SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}

function isDeliverableEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return false;
  if (
    normalized.endsWith("@test.com") ||
    normalized.endsWith("@example.com") ||
    normalized.endsWith("@localhost")
  ) {
    return false;
  }
  return true;
}

export function getBirthdayNotifyList(mainRecipientEmail?: string): string[] {
  const normalizedMain = mainRecipientEmail?.trim().toLowerCase();
  const settings = getBirthdayMailSettings();
  const excluded = new Set(settings.excludedCc.map((email) => email.toLowerCase()));

  return Array.from(
    new Set(
      [
        ...getEmployees().map((employee) => employee.email?.trim()),
        ...settings.customCc,
      ]
        .filter(Boolean)
        .filter(isDeliverableEmail)
        .filter((email) => email.toLowerCase() !== normalizedMain)
        .filter((email) => !excluded.has(email.toLowerCase()))
    )
  );
}

function getBirthdayEmailSubject(name: string) {
  return `Happy Birthday ${name}! - Bonfiglioli`;
}

function getBirthdayEmailText(name: string, fromTeam: string, previewUrl: string) {
  return [
    `Happy Birthday, ${name}!`,
    "",
    "Wishing you a wonderful day filled with joy, good health, and success.",
    `The entire ${fromTeam} team is sending warm wishes your way.`,
    "",
    `Birthday card preview: ${previewUrl}`,
    "",
    "Best regards,",
    fromTeam,
  ].join("\n");
}

function resolveInlinePhoto(photoUrl?: string): InlinePhotoAttachment | undefined {
  if (!photoUrl) return undefined;

  try {
    const filePath = path.join(process.cwd(), "public", photoUrl.replace(/^\//, ""));
    if (!fs.existsSync(filePath)) return undefined;

    const content = fs.readFileSync(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const contentType =
      extension === ".png"
        ? "image/png"
        : extension === ".webp"
          ? "image/webp"
          : "image/jpeg";

    return {
      cid: "birthday-photo",
      filename: path.basename(filePath),
      content,
      contentType,
    };
  } catch {
    return undefined;
  }
}

function resolveWelcomeMailAttachment(): FileAttachment | undefined {
  const filePath = path.join(
    "C:\\Users\\Projecta0003\\Downloads",
    "Ideathon'26_Jyothish",
    "Ideathon'26",
    "Welcome Mail Template.pdf"
  );

  try {
    if (!fs.existsSync(filePath)) return undefined;

    return {
      filename: "Welcome Mail Template.pdf",
      content: fs.readFileSync(filePath),
      contentType: "application/pdf",
    };
  } catch {
    return undefined;
  }
}

async function sendViaProviders(options: {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType?: string;
    cid?: string;
  }>;
  senderName: string;
  providerGroup?: "default" | "birthday";
}) {
  const providers =
    options.providerGroup === "birthday" ? getBirthdayMailProviders() : getDefaultMailProviders();

  if (providers.length === 0) {
    console.log(`[Email Simulated] No SMTP providers configured`);
    console.log(`  -> To: ${options.to.join(", ")}`);
    if (options.cc?.length) console.log(`  -> CC: ${options.cc.join(", ")}`);
    console.log(`  -> Subject: ${options.subject}`);
    return { sent: true, simulated: true };
  }

  const results = await Promise.all(
    providers.map(async (provider) => {
      const transporter = createTransporter(provider);
      const info = await transporter.sendMail({
        from: `"${options.senderName}" <${provider.fromEmail}>`,
        to: options.to.join(", "),
        ...(options.cc?.length ? { cc: options.cc.join(", ") } : {}),
        subject: options.subject,
        html: options.html,
        text: options.text,
        attachments: options.attachments,
      });

      const rejected = [...(info.rejected ?? []), ...(info.pending ?? [])].map(String);
      if (rejected.length > 0) {
        throw new Error(`${provider.label} rejected or deferred recipient(s): ${rejected.join(", ")}`);
      }

      console.log(
        `[Email Delivery] ${provider.label} accepted: ${[...(info.accepted ?? [])].map(String).join(", ")}`
      );
      return provider.label;
    })
  );

  console.log(`[Email Sent] Providers used: ${results.join(", ")}`);
  return { sent: true, simulated: false };
}

async function sendBirthdayMail(options: {
  to: string[];
  cc: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType?: string;
    cid?: string;
  }>;
}) {
  return sendViaProviders({
    to: options.to,
    cc: options.cc,
    subject: options.subject,
    html: options.html,
    text: options.text,
    senderName: "Bonfiglioli HR",
    attachments: options.attachments,
    providerGroup: "birthday",
  });
}

export function createBirthdayEmailDraft(
  employeeEmail: string,
  name: string,
  employeeId = "EMP000",
  theme?: CardTheme,
  photoSrc?: string
): BirthdayEmailDraft {
  const cardTheme = theme ?? getThemeForEmployee(employeeId);
  const senderEmail = getPrimarySenderEmail();
  const fromTeam = "Bonfiglioli";
  const settings = getBirthdayMailSettings();
  const notifyList = getBirthdayNotifyList(employeeEmail);
  const toRecipients = Array.from(
    new Set(
      [employeeEmail, ...settings.customTo]
        .map((email) => email.trim())
        .filter(isDeliverableEmail)
    )
  );
  const ccRecipients = notifyList;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
  const previewUrl = `${appUrl}/api/birthday/card?name=${encodeURIComponent(name)}&theme=${cardTheme}&id=${encodeURIComponent(employeeId)}`;
  const cardContent = getBirthdayCardContent(name, cardTheme, fromTeam, photoSrc);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${getBirthdayEmailSubject(name)}</title>
</head>
<body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:640px;margin:0 auto 18px">
    <div
      style="
        background:#ffffff;
        border:1px solid #e5e7eb;
        border-radius:18px;
        padding:18px 20px;
        color:#334155;
        font-size:14px;
        line-height:1.7;
      "
    >
      <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#4f46e5">
        Bonfiglioli HR
      </div>
      <p style="margin:10px 0 0">
        Please find the birthday card and wishes below for <strong>${name}</strong>.
      </p>
    </div>
  </div>
  ${cardContent}
</body>
</html>`;

  return {
    from: `"Bonfiglioli HR" <${senderEmail}>`,
    to: toRecipients,
    cc: ccRecipients,
    subject: getBirthdayEmailSubject(name),
    html,
    text: getBirthdayEmailText(name, fromTeam, previewUrl),
    theme: cardTheme,
    previewUrl,
  };
}

export async function sendBirthdayEmail(
  employeeEmail: string,
  name: string,
  employeeId = "EMP000",
  theme?: CardTheme
): Promise<BirthdayEmailResult> {
  const { getEmployee } = await import("./employees");
  const employee = getEmployee(employeeId);
  const inlinePhoto = resolveInlinePhoto(employee?.photoUrl);
  const photoSrc = inlinePhoto ? `cid:${inlinePhoto.cid}` : undefined;
  const draft = createBirthdayEmailDraft(employeeEmail, name, employeeId, theme, photoSrc);

  try {
    const result = await sendBirthdayMail({
      to: draft.to,
      cc: draft.cc,
      subject: draft.subject,
      html: draft.html,
      text: draft.text,
      attachments: inlinePhoto
        ? [
            {
              filename: inlinePhoto.filename,
              content: inlinePhoto.content,
              contentType: inlinePhoto.contentType,
              cid: inlinePhoto.cid,
            },
          ]
        : undefined,
    });

    return { sent: result.sent, simulated: result.simulated, draft };
  } catch (error) {
    console.error("Birthday email failed:", error);
    return {
      sent: false,
      simulated: false,
      draft,
      error: error instanceof Error ? error.message : "Birthday email failed",
    };
  }
}

export async function sendOnboardingEmail(to: string, name: string, onboardingUrl: string): Promise<boolean> {
  try {
    const welcomeAttachment = resolveWelcomeMailAttachment();
    const result = await sendViaProviders({
      to: [to],
      cc: getDefaultNotifyList().filter((email) => email !== to),
      subject: `Welcome to Bonfiglioli, ${name}! - Complete Your Onboarding`,
      senderName: "Bonfiglioli HR",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px;background:#f9f9f9;border-radius:12px">
          <h1 style="color:#6366f1">Welcome to Bonfiglioli, ${name}!</h1>
          <p style="font-size:16px;color:#333">We're excited to have you join us. Please complete your onboarding by uploading the required documents.</p>
          <h3 style="color:#333">Documents Required:</h3>
          <ul style="color:#555;line-height:2">
            <li>Aadhaar Card</li>
            <li>PAN Card</li>
            <li>Bank Account Details</li>
            <li>Signed Offer Letter</li>
            <li>Signed NDA</li>
            <li>Professional Photo</li>
          </ul>
          <div style="text-align:center;margin-top:24px">
            <a href="${onboardingUrl}" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Complete Onboarding -&gt;</a>
          </div>
        </div>`,
      text: `Welcome to Bonfiglioli, ${name}! Please complete your onboarding here: ${onboardingUrl}`,
      attachments: welcomeAttachment ? [welcomeAttachment] : undefined,
    });
    return result.sent;
  } catch (error) {
    console.error("Onboarding email failed:", error);
    return false;
  }
}

export async function sendDocumentRequestEmail(to: string, name: string, missingDocs: string[]): Promise<boolean> {
  try {
    const result = await sendViaProviders({
      to: [to],
      cc: getDefaultNotifyList().filter((email) => email !== to),
      subject: `Action Required: Missing Onboarding Documents - ${name}`,
      senderName: "Bonfiglioli HR",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px;background:#fff3f3;border-radius:12px">
          <h2 style="color:#dc2626">Missing Documents, ${name}</h2>
          <p>Please upload the following documents to complete your onboarding:</p>
          <ul style="color:#555;line-height:2">
            ${missingDocs.map((doc) => `<li>${doc}</li>`).join("")}
          </ul>
          <div style="text-align:center;margin-top:24px">
            <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001"}/onboarding" style="background:#dc2626;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">Upload Documents -&gt;</a>
          </div>
        </div>`,
      text: `Missing onboarding documents for ${name}: ${missingDocs.join(", ")}`,
    });
    return result.sent;
  } catch (error) {
    console.error("Document request email failed:", error);
    return false;
  }
}

export async function sendLeaveRequestDraftEmail(input: LeaveRequestMailInput): Promise<boolean> {
  const leaveDeskEmail =
    process.env.LEAVE_REQUEST_TO_EMAIL ?? "narayana.jyothishchandra@gmail.com";

  try {
    const result = await sendViaProviders({
      to: [leaveDeskEmail],
      subject: `Leave Request Draft - ${input.employeeName} (${input.employeeId})`,
      senderName: "Bonfiglioli HR",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;padding:28px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px">
          <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;margin-bottom:10px">Leave Request Draft</div>
          <h1 style="margin:0 0 16px;color:#0f172a;font-size:26px">Employee Leave Request</h1>
          <p style="margin:0 0 18px;color:#334155;font-size:14px;line-height:1.7">
            A new leave request has been submitted and is ready for review.
          </p>
          <table style="width:100%;border-collapse:collapse;background:#ffffff;border-radius:12px;overflow:hidden">
            <tbody>
              <tr><td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#334155;width:180px">Request ID</td><td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;color:#0f172a">${input.requestId}</td></tr>
              <tr><td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#334155">Employee</td><td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;color:#0f172a">${input.employeeName}</td></tr>
              <tr><td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#334155">Employee ID</td><td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;color:#0f172a">${input.employeeId}</td></tr>
              <tr><td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#334155">Employee Email</td><td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;color:#0f172a">${input.employeeEmail}</td></tr>
              <tr><td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#334155">Leave Start Date</td><td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;color:#0f172a">${input.startDate}</td></tr>
              <tr><td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#334155">Leave End Date</td><td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;color:#0f172a">${input.endDate}</td></tr>
              <tr><td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#334155">Submitted At</td><td style="padding:12px 14px;border-bottom:1px solid #e2e8f0;color:#0f172a">${new Date(input.createdAt).toLocaleString("en-IN")}</td></tr>
              <tr><td style="padding:12px 14px;font-weight:700;color:#334155;vertical-align:top">Reason</td><td style="padding:12px 14px;color:#0f172a;line-height:1.7;white-space:pre-wrap">${input.reason}</td></tr>
            </tbody>
          </table>
        </div>`,
      text: [
        "Employee Leave Request",
        `Request ID: ${input.requestId}`,
        `Employee: ${input.employeeName}`,
        `Employee ID: ${input.employeeId}`,
        `Employee Email: ${input.employeeEmail}`,
        `Leave Start Date: ${input.startDate}`,
        `Leave End Date: ${input.endDate}`,
        `Submitted At: ${new Date(input.createdAt).toLocaleString("en-IN")}`,
        "",
        "Reason:",
        input.reason,
      ].join("\n"),
    });
    return result.sent;
  } catch (error) {
    console.error("Leave request email failed:", error);
    return false;
  }
}
