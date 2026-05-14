import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export type EmailIntent =
  | "meeting_request"
  | "meeting_confirmation"
  | "meeting_cancellation"
  | "general_inquiry"
  | "urgent_response"
  | "notification"
  | "other";

export interface EmailAnalysis {
  intent: EmailIntent;
  summary: string;
  urgency: "high" | "medium" | "low";
  requiresResponse: boolean;
  isMeetingRelated: boolean;
  extractedParticipants: string[];
  extractedDates: string[];
  extractedTopics: string[];
  suggestedAction: string;
}

export async function analyzeEmail(
  subject: string,
  body: string,
  from: string
): Promise<EmailAnalysis> {
  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: "You are an email analysis assistant. Return only valid JSON.",
    messages: [
      {
        role: "user",
        content: `Analyze this email and return a JSON object:
{
  "intent": "meeting_request|meeting_confirmation|meeting_cancellation|general_inquiry|urgent_response|notification|other",
  "summary": "one sentence summary",
  "urgency": "high|medium|low",
  "requiresResponse": true|false,
  "isMeetingRelated": true|false,
  "extractedParticipants": ["email or name"],
  "extractedDates": ["date/time string"],
  "extractedTopics": ["topic"],
  "suggestedAction": "what to do"
}

From: ${from}
Subject: ${subject}
Body: ${body.slice(0, 3000)}`,
      },
    ],
  });

  const text = msg.content[0].type === "text" ? msg.content[0].text.trim() : "{}";
  // Strip markdown code fences if present
  const json = text.replace(/^```json?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(json) as EmailAnalysis;
  } catch {
    return {
      intent: "other",
      summary: "Could not analyze email",
      urgency: "low",
      requiresResponse: false,
      isMeetingRelated: false,
      extractedParticipants: [],
      extractedDates: [],
      extractedTopics: [],
      suggestedAction: "Review manually",
    };
  }
}

export async function draftEmailResponse(
  subject: string,
  body: string,
  fromName: string,
  instruction?: string
): Promise<string> {
  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Draft a professional email response from Bonfiglioli HR to ${fromName}.
${instruction ? `Instruction: ${instruction}` : "Write a helpful, professional reply."}

Original email:
Subject: ${subject}
Body: ${body.slice(0, 2000)}

Return only the HTML body starting with a greeting (e.g. <p>Dear ...,</p>). No subject line.`,
      },
    ],
  });
  return msg.content[0].type === "text"
    ? msg.content[0].text
    : "<p>Thank you for your email. We will get back to you shortly.</p>";
}

export interface MeetingDetails {
  title: string;
  attendees: string[];
  preferredDates: string[];
  duration: number;
  agenda: string;
}

export async function extractMeetingDetails(
  subject: string,
  body: string
): Promise<MeetingDetails> {
  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    system: "Return only valid JSON.",
    messages: [
      {
        role: "user",
        content: `Extract meeting details from this email as JSON:
{
  "title": "meeting title",
  "attendees": ["email@example.com"],
  "preferredDates": ["natural language date/time preference"],
  "duration": 60,
  "agenda": "brief agenda"
}

Subject: ${subject}
Body: ${body.slice(0, 2000)}`,
      },
    ],
  });
  const text = msg.content[0].type === "text" ? msg.content[0].text.trim() : "{}";
  const json = text.replace(/^```json?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(json) as MeetingDetails;
  } catch {
    return { title: subject, attendees: [], preferredDates: [], duration: 60, agenda: "" };
  }
}
