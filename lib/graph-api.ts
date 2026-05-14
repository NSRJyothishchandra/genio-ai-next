// Microsoft Graph API — requires Azure AD app with application permissions:
// Mail.Read, Mail.Send, Calendars.ReadWrite, OnlineMeetings.ReadWrite
// Env vars: GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_USER_EMAIL

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

let cachedToken: { token: string; expiresAt: number } | null = null;

export function isGraphConfigured(): boolean {
  return !!(
    process.env.GRAPH_TENANT_ID &&
    process.env.GRAPH_CLIENT_ID &&
    process.env.GRAPH_CLIENT_SECRET &&
    process.env.GRAPH_USER_EMAIL
  );
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const resp = await fetch(
    `https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GRAPH_CLIENT_ID!,
        client_secret: process.env.GRAPH_CLIENT_SECRET!,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    }
  );
  if (!resp.ok) throw new Error(`Graph token error: ${await resp.text()}`);
  const data = await resp.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function gFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  return fetch(`${GRAPH_BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
}

export interface GraphEmail {
  id: string;
  subject: string;
  bodyPreview: string;
  from: { emailAddress: { name: string; address: string } };
  toRecipients: { emailAddress: { name: string; address: string } }[];
  ccRecipients: { emailAddress: { name: string; address: string } }[];
  receivedDateTime: string;
  isRead: boolean;
  hasAttachments: boolean;
  body: { content: string; contentType: string };
}

export async function getInboxEmails(limit = 25, skip = 0): Promise<GraphEmail[]> {
  const user = process.env.GRAPH_USER_EMAIL!;
  const resp = await gFetch(
    `/users/${user}/messages?$top=${limit}&$skip=${skip}&$orderby=receivedDateTime desc` +
    `&$select=id,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments,body`
  );
  if (!resp.ok) throw new Error(`Inbox fetch failed: ${await resp.text()}`);
  const data = await resp.json();
  return data.value as GraphEmail[];
}

export async function getEmailById(id: string): Promise<GraphEmail> {
  const user = process.env.GRAPH_USER_EMAIL!;
  const resp = await gFetch(`/users/${user}/messages/${id}`);
  if (!resp.ok) throw new Error(`Email fetch failed: ${await resp.text()}`);
  return resp.json();
}

export async function markEmailRead(id: string): Promise<void> {
  const user = process.env.GRAPH_USER_EMAIL!;
  await gFetch(`/users/${user}/messages/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ isRead: true }),
  });
}

export async function sendEmail(
  to: string[],
  subject: string,
  htmlBody: string,
  cc?: string[]
): Promise<void> {
  const user = process.env.GRAPH_USER_EMAIL!;
  const resp = await gFetch(`/users/${user}/sendMail`, {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: htmlBody },
        toRecipients: to.map((a) => ({ emailAddress: { address: a } })),
        ccRecipients: (cc || []).map((a) => ({ emailAddress: { address: a } })),
      },
    }),
  });
  if (!resp.ok) throw new Error(`Send failed: ${await resp.text()}`);
}

export async function replyToEmail(messageId: string, htmlBody: string): Promise<void> {
  const user = process.env.GRAPH_USER_EMAIL!;
  const resp = await gFetch(`/users/${user}/messages/${messageId}/reply`, {
    method: "POST",
    body: JSON.stringify({
      message: { body: { contentType: "HTML", content: htmlBody } },
    }),
  });
  if (!resp.ok) throw new Error(`Reply failed: ${await resp.text()}`);
}

export interface BusySlot {
  start: string;
  end: string;
  status: string;
}

export interface AttendeeSchedule {
  email: string;
  busySlots: BusySlot[];
}

export async function getCalendarAvailability(
  attendees: string[],
  startTime: string,
  endTime: string
): Promise<AttendeeSchedule[]> {
  const user = process.env.GRAPH_USER_EMAIL!;
  const resp = await gFetch(`/users/${user}/calendar/getSchedule`, {
    method: "POST",
    body: JSON.stringify({
      schedules: attendees,
      startTime: { dateTime: startTime, timeZone: "Asia/Kolkata" },
      endTime: { dateTime: endTime, timeZone: "Asia/Kolkata" },
      availabilityViewInterval: 30,
    }),
  });
  if (!resp.ok) throw new Error(`Calendar fetch failed: ${await resp.text()}`);
  const data = await resp.json();
  return (data.value || []).map((item: Record<string, unknown>) => ({
    email: item.scheduleId as string,
    busySlots: (item.scheduleItems as BusySlot[]) || [],
  }));
}

export interface TeamsMeeting {
  id: string;
  joinUrl: string;
  subject: string;
  startDateTime: string;
  endDateTime: string;
}

export async function createTeamsMeeting(
  subject: string,
  startDateTime: string,
  endDateTime: string,
  attendees: string[],
  agenda?: string
): Promise<TeamsMeeting> {
  const user = process.env.GRAPH_USER_EMAIL!;
  const resp = await gFetch(`/users/${user}/events`, {
    method: "POST",
    body: JSON.stringify({
      subject,
      body: {
        contentType: "HTML",
        content: agenda ? `<p>${agenda}</p>` : `<p>Teams meeting: ${subject}</p>`,
      },
      start: { dateTime: startDateTime, timeZone: "Asia/Kolkata" },
      end: { dateTime: endDateTime, timeZone: "Asia/Kolkata" },
      attendees: attendees.map((email) => ({
        emailAddress: { address: email },
        type: "required",
      })),
      isOnlineMeeting: true,
      onlineMeetingProvider: "teamsForBusiness",
    }),
  });
  if (!resp.ok) throw new Error(`Meeting creation failed: ${await resp.text()}`);
  const data = await resp.json();
  return {
    id: data.id,
    joinUrl: data.onlineMeeting?.joinUrl || data.webLink,
    subject: data.subject,
    startDateTime: data.start.dateTime,
    endDateTime: data.end.dateTime,
  };
}
