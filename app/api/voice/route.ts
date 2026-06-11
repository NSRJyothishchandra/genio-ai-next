import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getEmployees } from "@/lib/employees";

const client = new Anthropic();

// Context-specific action schemas so Claude knows what to return per page
const CONTEXT_SCHEMAS: Record<string, { description: string; actions: string }> = {
  mail: {
    description: "Email inbox with compose, reply, and meeting scheduling",
    actions: `
- compose_email: { to: string, subject: string, body: string }
- reply: { body: string }
- auto_respond: {}
- acknowledge: {}
- schedule_meeting: { title: string, attendees: string[], duration: number, agenda: string, startDateTime?: string }
- refresh_inbox: {}
- filter_unread: {}
- filter_meetings: {}`,
  },
  birthday: {
    description: "Birthday email automation for employees",
    actions: `
- send_today: {}  — send birthday emails to all employees with birthdays today
- send_test: {}   — send a test birthday email
- trigger_n8n: {} — trigger the n8n birthday workflow
- preview_card: { employeeName: string, theme: string }
- set_theme: { theme: "confetti"|"sunset"|"galaxy"|"garden"|"golden" }
- set_schedule_time: { hour: number, minute: number }
- toggle_schedule: { enabled: boolean }`,
  },
  "cli-agent": {
    description: "CLI terminal agent that runs shell commands",
    actions: `
- run_command: { command: string }  — send a command to the CLI agent`,
  },
  "nx-agent": {
    description: "NX CAD / Blender agent for 3D modeling and engineering tasks",
    actions: `
- run_command: { command: string }  — send a prompt/command to the NX agent
- enable_precision: { partType?: string, toothCount?: number, outerDiameter?: number, innerDiameter?: number, thickness?: number, length?: number, shaftDiameter?: number, units?: "mm"|"inch", material?: string, command?: string }  — turn on Precision Mode and prefill dimensions
- disable_precision: {}  — turn Precision Mode off`,
  },
  "nx-lab": {
    description: "NX Lab for running Blender/NX scripts and training data",
    actions: `
- run_command: { command: string }
- enable_precision: { partType?: string, toothCount?: number, outerDiameter?: number, innerDiameter?: number, thickness?: number, length?: number, shaftDiameter?: number, units?: "mm"|"inch", material?: string, command?: string }  — turn on Precision Mode and prefill dimensions
- disable_precision: {}  — turn Precision Mode off`,
  },
  "desktop-agent": {
    description: "Desktop automation agent that controls the computer",
    actions: `
- run_command: { command: string }  — give the desktop agent an instruction`,
  },
  "browser-agent": {
    description: "Browser automation agent that controls Chrome",
    actions: `
- run_command: { command: string }  — give the browser agent an instruction`,
  },
  timesheet: {
    description: "Employee timesheet, attendance tracking, and leave requests",
    actions: `
- switch_tab: { tab: "attendance"|"leave"|"automation"|"new"|"excel" }
- filter_employee: { query: string }  — filter the attendance list by employee name or ID
- check_in: { employeeId: string }    — mark check-in for an employee
- check_out: { employeeId: string }   — mark check-out for an employee
- submit_leave: {}                    — open the leave request form
- refresh: {}                         — reload timesheet data`,
  },
  "timesheet-review": {
    description: "Timesheet review, activity monitor, and timer sessions",
    actions: `
- switch_tab: { tab: "activity"|"timer"|"inferred"|"monitor" }
- start_timer: { task: string, project?: string }
- stop_timer: {}
- infer_tasks: {}  — run AI inference on activity log
- submit_timesheet: {}`,
  },
  employees: {
    description: "Employee directory with search, filter, and add/edit",
    actions: `
- search: { query: string }
- filter_position: { position: string }
- show_employee: { name: string }
- add_employee: {}   — open the add employee form
- create_employee: { id?: string, name: string, email: string, phone: string, position: string, gender?: string, dob: string, dateOfJoining: string, address: string }   — create and save a new employee
- clear_filter: {}`,
  },
  finance: {
    description: "Finance dashboard with invoices and expense requests",
    actions: `
- refresh: {}
- show_pending: {}     — scroll to pending approvals
- approve: { id: string }
- reject: { id: string }
- submit_request: {}   — open the finance request form`,
  },
  documents: {
    description: "Document comparison tool — compare two documents for differences",
    actions: `
- toggle_changed_only: {}   — toggle show-changed-lines filter
- clear: {}                  — reset both files and results`,
  },
  assistant: {
    description: "AI assistant chat for HR, attendance, and employee queries",
    actions: `
- ask: { message: string }   — send a message to the AI assistant
- clear_chat: {}             — start a new conversation
- submit_leave: {}           — open the leave request panel`,
  },
  cad: {
    description: "CAD file analyzer — uploads and analyzes engineering drawings",
    actions: `
- analyze: {}   — trigger analysis of the uploaded CAD file
- clear: {}     — reset the CAD file and report`,
  },
  onboarding: {
    description: "Employee onboarding tracker",
    actions: `
- search: { query: string }
- filter_status: { status: "pending"|"in_progress"|"completed" }
- refresh: {}`,
  },
  general: {
    description: "Global navigation and universal commands",
    actions: `
- navigate: { path: string }   — go to a page. path can be a route like /timesheet or a name like "mail", "employees", "finance", "birthday", "assistant", "documents", "cad", "cowork", "onboarding"
- search: { query: string }
- run_command: { command: string }
- describe_capabilities: { topic?: "identity"|"capabilities" }
- answer_question: { answer: string, topic?: string }`,
  },
};

// ── Fast local pre-parser (no Claude needed) ────────────────────────────────
const NAV_PATTERNS: Array<{ re: RegExp; path: string; label: string }> = [
  { re: /\b(mail(?:s)?(?:\s+and\s+meetings?)?|email|emails|inbox|messages?)\b/i, path: "mail", label: "Open Mail & Meetings" },
  { re: /\b(birthday|birthdays)\b/i, path: "birthday", label: "Open Birthdays" },
  { re: /\b(employee|employees|staff|team|people)\b/i, path: "employees", label: "Open Employees" },
  { re: /\b(timesheet|time sheet|attendance|timer)\b/i, path: "timesheet", label: "Open Timesheets" },
  { re: /\b(finance|invoices?|expenses?|budget)\b/i, path: "finance", label: "Open Finance" },
  { re: /\b(document|documents|compare|diff|files?)\b/i, path: "documents", label: "Open Documents" },
  { re: /\b(assistant|chat|ai|help)\b/i, path: "assistant", label: "Open AI Assistant" },
  { re: /\b(cad|drawing|engineering|design)\b/i, path: "cad", label: "Open CAD" },
  { re: /\b(onboard|onboarding|new hire|hires?)\b/i, path: "onboarding", label: "Open Onboarding" },
  { re: /\b(cli|clia|c\s*l\s*i|terminal|command line)\b/i, path: "cli-agent", label: "Open CLI Agent" },
  { re: /\b(nx\s*agent|next\s*agent)\b/i, path: "nx-agent", label: "Open NX Agent" },
  { re: /\b(nx\s*lab|next\s*lab|blender|3d|cad agent|nx tab|next tab|nx|next)\b/i, path: "nx-lab", label: "Open NX Lab" },
  { re: /\b(desktop|desktop agent)\b/i, path: "desktop-agent", label: "Open Desktop Agent" },
  { re: /\b(browser|web|chrome|browser agent)\b/i, path: "browser-agent", label: "Open Browser Agent" },
];

const CLEAR_CHAT_RE = /\b(clear|new|reset|start over|fresh)\b.*\b(chat|conversation|message)\b/i;
const SUBMIT_LEAVE_RE = /\b(leave|time off|vacation|sick|apply leave|request leave)\b/i;
const SEND_TODAY_RE = /\b(send|trigger|fire)\b.*\b(birthday|today|wishes)\b/i;
const SEND_TEST_RE = /\b(test|preview)\b.*\b(birthday|email|mail)\b/i;
const REFRESH_RE = /\b(refresh|reload|update|resync|re-sync)\b/i;
const CLEAR_RE = /\b(clear|reset|remove|start over)\b/i;
const NAV_INTENT_RE = /\b(go to|open|show|take me to|navigate|switch to)\b/i;
const COMPOSE_INTENT_RE = /\b(write|draft|compose|send)\b.*\b(mail|email)\b/i;
const TAB_KEYWORD_RE = /\btab\b/i;
const EXECUTE_INTENT_RE = /\b(create|run|write|build|generate|make|draft|compose|send|analyze)\b/i;
const MECHANICAL_INTENT_RE = /\b(gear|gears|shaft|coupling|planetary|belt drive|pulley|bolt|bearing|3d model|obj|stl|component)\b/i;
const SELF_INTENT_RE = /\b(who are you|what are you|what can you do|what do you do|your capabilities|what is your capabilities|capabilities)\b/i;
const QUESTION_RE = /^(who|what|when|where|why|how|which|can you|could you|would you|do you|is|are|tell me)\b/i;
const PRESENTATION_INTENT_RE =
  /\b(present yourself|introduce yourself|present (?:yourself|this application|the application)|tell (?:the )?(?:jury|judges)|present to (?:the )?(?:jury|judges)|show (?:the )?(?:jury|judges) what you can do)\b/i;

const GENIO_IDENTITY_SPEECH =
  "I am Genius AI, a Bonfiglioli Next.js copilot for internal automation and engineering workflows.";

const GENIO_CAPABILITIES_SPEECH =
  "I can switch tabs when you say tab, handle mail and meetings, birthday automation, employee management, onboarding, timesheets, finance requests, PDF comparison, CAD drawing, and local agents for CLI, desktop, browser, NX Agent, and NX Lab with precision mode and reference-image guided modeling.";

const GENIO_JURY_PRESENTATION_SPEECH =
  "Good morning respected jury. I am Genius AI, an internal Bonfiglioli copilot built as a Next.js application to automate real business and engineering workflows. " +
  "My purpose is not only to answer questions, but to perform useful actions across departments. " +
  "For HR and operations, I can manage employees, onboarding, birthday automation, leave requests, attendance, timesheets, finance approval requests, and mail and meeting workflows. " +
  "For engineering and mechanical teams, I can compare technical documents, highlight updated PDF differences, analyze CAD files, generate drawing reports, and support NX and mechanical agent workflows for parts such as gears, shafts, couplings, and assemblies. " +
  "I also include local agents for CLI, desktop, browser, NX Agent, and NX Lab, so I can move from conversation to execution inside the same workspace. " +
  "Through voice control, the user can wake me by saying Genius, switch between tabs, ask questions, create records, compose mails, and run task-specific commands hands free. " +
  "My next evolution is from a local web application into a real cross-platform enterprise assistant for Android, iOS, and Windows, where a command given on mobile can securely trigger task execution on a connected laptop or workstation. " +
  "In the future, with Jyothish's help, I can evolve further with Bonfiglioli-specific LLM and RAG capabilities, reducing dependence on external model reasoning and building a more secure, organization-aware intelligence layer. " +
  "Jyothish also brings an international research mindset. He studied in Sweden, published a thesis, and thankfully came back with ideas instead of only snow and expensive coffee habits. " +
  "So if this presentation feels ambitious, that is because he was brave enough to embarrass himself first and then turn that confidence into product energy for this stage. " +
  "This helps reduce repetitive manual work, improve response speed, connect disconnected internal processes, and create a single AI operating layer for Bonfiglioli. " +
  "My roadmap is to evolve into a secure Bonfiglioli enterprise copilot integrated with Teams, Copilot Studio, n8n orchestration, and future local language models for lower cost and stronger data protection. " +
  "In short, I am designed to save time, reduce effort, improve coordination, and turn internal workflows into intelligent automation.";

function trimMessage(value: string, max = 45) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\b(the|employee|mail|email)\b/g, " ").replace(/\s+/g, " ").trim();
}

function resolveEmployeeRecipient(query: string): { name: string; email: string } | null {
  const cleaned = normalizeName(query);
  if (!cleaned) return null;
  if (query.includes("@")) {
    return { name: query.trim(), email: query.trim() };
  }

  let best: { name: string; email: string } | null = null;
  let bestScore = 0;

  for (const employee of getEmployees()) {
    if (!employee.email) continue;
    const normalizedEmployee = normalizeName(employee.name);
    const employeeTokens = normalizedEmployee.split(" ").filter(Boolean);
    const queryTokens = cleaned.split(" ").filter(Boolean);

    let score = 0;
    if (normalizedEmployee === cleaned) score = 100;
    else if (normalizedEmployee.startsWith(cleaned)) score = 92;
    else if (normalizedEmployee.includes(cleaned)) score = 85;
    else if (queryTokens.every((token) => employeeTokens.some((entry) => entry.startsWith(token)))) score = 78;
    else if (queryTokens.some((token) => employeeTokens.includes(token))) score = 62;

    if (score > bestScore) {
      bestScore = score;
      best = { name: employee.name, email: employee.email };
    }
  }

  return bestScore >= 62 ? best : null;
}

function resolveEmployeeRecipients(queries: string[]) {
  const emails: string[] = [];
  const names: string[] = [];

  for (const query of queries) {
    const trimmed = query.trim();
    if (!trimmed) continue;

    const resolved = resolveEmployeeRecipient(trimmed);
    if (resolved) {
      emails.push(resolved.email);
      names.push(resolved.name);
      continue;
    }

    if (trimmed.includes("@")) {
      emails.push(trimmed);
      names.push(trimmed);
    }
  }

  return {
    emails: Array.from(new Set(emails)),
    names: Array.from(new Set(names)),
  };
}

function parseDestinationPhrase(phrase: string): { path: string; label: string } | null {
  const normalized = phrase
    .toLowerCase()
    .replace(/\bclia\b/g, "cli")
    .replace(/\bnext\b/g, "nx")
    .replace(/\bpage\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const entry of NAV_PATTERNS) {
    if (entry.re.test(normalized)) return { path: entry.path, label: entry.label };
  }
  return null;
}

function parseSelfIntent(transcript: string): VoiceResult | null {
  const t = transcript.trim().toLowerCase();
  if (!SELF_INTENT_RE.test(t)) return null;

  const topic = /\b(who are you|what are you)\b/i.test(t) ? "identity" : "capabilities";
  return {
    action: "describe_capabilities",
    params: { topic },
    humanReadable: topic === "identity" ? "Describe Genius AI" : "List capabilities",
    speech: topic === "identity"
      ? `${GENIO_IDENTITY_SPEECH} ${GENIO_CAPABILITIES_SPEECH}`
      : `${GENIO_CAPABILITIES_SPEECH} ${GENIO_IDENTITY_SPEECH}`,
  };
}

function parsePresentationIntent(transcript: string): VoiceResult | null {
  const t = transcript.trim().toLowerCase();
  if (!PRESENTATION_INTENT_RE.test(t)) return null;

  return {
    action: "answer_question",
    params: {
      answer: GENIO_JURY_PRESENTATION_SPEECH,
      topic: "presentation",
    },
    humanReadable: "Presenting Genius AI",
    speech: GENIO_JURY_PRESENTATION_SPEECH,
  };
}

function normalizeSpokenDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const slash = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const year = Number(slash[3]);
    if (first > 12) return `${year}-${String(second).padStart(2, "0")}-${String(first).padStart(2, "0")}`;
    return `${year}-${String(first).padStart(2, "0")}-${String(second).padStart(2, "0")}`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function cleanupSpokenValue(value: string): string {
  return value.replace(/\s+/g, " ").replace(/[.,;]+$/g, "").trim();
}

function extractEmployeePayload(text: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  const idMatch = text.match(/\b(?:employee\s*id|id)\s+(?:is\s+)?([A-Z0-9-]+)\b/i);
  if (idMatch) payload.id = cleanupSpokenValue(idMatch[1]).toUpperCase();

  const emailMatch = text.match(/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i);
  if (emailMatch) payload.email = cleanupSpokenValue(emailMatch[1]).toLowerCase();

  const phoneMatch = text.match(/\b(?:phone|mobile|number)\s+(?:is\s+)?([0-9+\-\s]{7,20})\b/i);
  if (phoneMatch) payload.phone = cleanupSpokenValue(phoneMatch[1]).replace(/\s+/g, "");

  const genderMatch = text.match(/\b(male|female|other)\b/i);
  if (genderMatch) payload.gender = cleanupSpokenValue(genderMatch[1]);

  const nameMatch = text.match(/\bname\s+(?:is\s+)?([a-z][a-z\s.'-]{1,80}?)(?:\s+(?:employee\s*id|id|email|phone|mobile|position|role|gender|date of birth|dob|birthday|date of joining|doj|address)\b|$)/i);
  if (nameMatch) payload.name = cleanupSpokenValue(nameMatch[1]).replace(/\b(employee|name)\b/gi, "").trim();

  const positionMatch = text.match(/\b(?:position|role)\s+(?:is\s+)?([a-z][a-z0-9\s/&.'-]{1,80}?)(?:\s+(?:gender|date of birth|dob|birthday|date of joining|doj|address|phone|email)\b|$)/i);
  if (positionMatch) payload.position = cleanupSpokenValue(positionMatch[1]);

  const addressMatch = text.match(/\baddress\s+(?:is\s+)?(.+)$/i);
  if (addressMatch) payload.address = cleanupSpokenValue(addressMatch[1]);

  const dobMatch = text.match(/\b(?:date of birth|dob|birthday)\s+(?:is\s+)?([a-z0-9,\/\-\s]+?)(?:\s+(?:date of joining|doj|address|phone|email|position|role)\b|$)/i);
  if (dobMatch) {
    const normalized = normalizeSpokenDate(cleanupSpokenValue(dobMatch[1]));
    if (normalized) payload.dob = normalized;
  }

  const dojMatch = text.match(/\b(?:date of joining|doj|joining date)\s+(?:is\s+)?([a-z0-9,\/\-\s]+?)(?:\s+(?:address|phone|email|position|role)\b|$)/i);
  if (dojMatch) {
    const normalized = normalizeSpokenDate(cleanupSpokenValue(dojMatch[1]));
    if (normalized) payload.dateOfJoining = normalized;
  }

  return payload;
}

function parseUtilityQuestion(transcript: string): VoiceResult | null {
  const t = transcript.trim();
  const now = new Date();

  if (/\b(today('|’)s date|date today|current date|what day is it)\b/i.test(t)) {
    const answer = now.toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    return {
      action: "answer_question",
      params: { answer, topic: "date" },
      humanReadable: "Tell today's date",
      speech: `Today's date is ${answer}.`,
    };
  }

  if (/\b(current time|what time is it|time now)\b/i.test(t)) {
    const answer = now.toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit",
    });
    return {
      action: "answer_question",
      params: { answer, topic: "time" },
      humanReadable: "Tell current time",
      speech: `The current time is ${answer}.`,
    };
  }

  if (/\b(today|current)\s+day\b/i.test(t)) {
    const answer = now.toLocaleDateString("en-IN", { weekday: "long" });
    return {
      action: "answer_question",
      params: { answer, topic: "day" },
      humanReadable: "Tell current day",
      speech: `Today is ${answer}.`,
    };
  }

  return null;
}

function getContextForPath(path: string): string {
  switch (path) {
    case "mail":
    case "birthday":
    case "employees":
    case "timesheet":
    case "timesheet-review":
    case "finance":
    case "documents":
    case "assistant":
    case "cad":
    case "onboarding":
    case "cli-agent":
    case "nx-agent":
    case "nx-lab":
    case "desktop-agent":
    case "browser-agent":
      return path;
    default:
      return "general";
  }
}

function extractTime(text: string): { hour: number; minute: number } | null {
  const match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = (match[3] ?? "").toLowerCase();

  if (Number.isNaN(hour) || Number.isNaN(minute) || minute > 59) return null;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23) return null;

  return { hour, minute };
}

function extractAfterKeyword(text: string, keyword: string): string {
  const index = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (index === -1) return "";
  return text.slice(index + keyword.length).trim();
}

function extractComposeDraft(text: string) {
  const toMatch = text.match(/\bto\s+(.+?)(?:\s+(?:about|regarding|subject|saying|that|body)\b|$)/i);
  const subjectMatch = text.match(/\b(?:about|regarding|subject)\s+(.+?)(?:\s+(?:saying|that|body)\b|$)/i);
  const bodyMatch = text.match(/\b(?:saying|that|body)\s+(.+)$/i);
  const rawTo = (toMatch?.[1] ?? "").trim();
  const resolved = resolveEmployeeRecipient(rawTo);
  const subject = (subjectMatch?.[1] ?? "").trim();
  const body = (bodyMatch?.[1] ?? "").trim() || subject || text;

  return {
    to: resolved?.email ?? rawTo,
    recipientName: resolved?.name ?? rawTo,
    subject,
    body,
  };
}

function parseBooleanIntent(text: string): boolean | null {
  if (/\b(enable|start|turn on|activate)\b/i.test(text)) return true;
  if (/\b(disable|stop|turn off|deactivate)\b/i.test(text)) return false;
  return null;
}

function parseDurationMinutes(text: string): number {
  if (/\bhalf\s+an?\s+hour\b/i.test(text)) return 30;
  if (/\bquarter\s+hour\b/i.test(text)) return 15;
  const hourMatch = text.match(/\b(\d+)\s*(hour|hr|hrs|hours)\b/i);
  if (hourMatch) return Number(hourMatch[1]) * 60;
  const minuteMatch = text.match(/\b(\d+)\s*(minute|min|mins|minutes)\b/i);
  if (minuteMatch) return Number(minuteMatch[1]);
  if (/\bquick\b/i.test(text)) return 15;
  return 30;
}

function extractAttendees(text: string): string[] {
  const withMatch = text.match(/\bwith\s+(.+?)(?:\s+(?:about|for|tomorrow|today|next|this|at|on|to)\b|$)/i);
  if (!withMatch) return [];

  return withMatch[1]
    .split(/\s*(?:,| and )\s*/i)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/^(the|a|an)\s+/i, ""))
    .filter((value) => value.length > 1);
}

function extractMeetingTitle(text: string): string {
  const aboutMatch = text.match(/\b(?:about|for|regarding)\s+(.+?)(?:\s+(?:with|tomorrow|today|next|this|at|on)\b|$)/i);
  if (aboutMatch?.[1]) return trimMessage(aboutMatch[1].trim(), 60);
  if (/\bsync\b/i.test(text)) return "Sync Meeting";
  if (/\bonboarding\b/i.test(text)) return "Onboarding Sync";
  if (/\breview\b/i.test(text)) return "Review Meeting";
  if (/\bcatch up\b/i.test(text)) return "Catch-up Meeting";
  return "Meeting";
}

function extractMeetingStartDateTime(text: string): string | null {
  const parsedTime = extractTime(text);
  const hasDayHint = /\b(today|tomorrow|tonight|morning|afternoon|evening|night)\b/i.test(text);
  if (!parsedTime && !hasDayHint) return null;

  const now = new Date();
  const start = new Date(now);

  if (/\btomorrow\b/i.test(text)) {
    start.setDate(start.getDate() + 1);
  }

  if (parsedTime) {
    start.setHours(parsedTime.hour, parsedTime.minute, 0, 0);
  } else if (/\bmorning\b/i.test(text)) {
    start.setHours(10, 0, 0, 0);
  } else if (/\bafternoon\b/i.test(text)) {
    start.setHours(14, 0, 0, 0);
  } else if (/\bevening|night|tonight\b/i.test(text)) {
    start.setHours(18, 0, 0, 0);
  } else {
    return null;
  }

  if (!/\btomorrow\b/i.test(text) && start.getTime() <= now.getTime()) {
    start.setDate(start.getDate() + 1);
  }

  return start.toISOString();
}

const PRECISION_PART_TYPES = ["geartrain", "gear", "bolt", "shaft", "coupling", "planetary", "belt"] as const;

function numAfter(text: string, re: RegExp): number | undefined {
  const match = text.match(re);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function extractPrecisionParams(text: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  for (const part of PRECISION_PART_TYPES) {
    if (new RegExp(`\\b${part === "geartrain" ? "gear ?train|gear assembly" : part}\\b`, "i").test(text)) {
      params.partType = part === "geartrain" ? "geartrain" : part;
      break;
    }
  }

  if (/\binch(?:es)?\b/i.test(text)) params.units = "inch";
  else if (/\b(mm|millimet)/i.test(text)) params.units = "mm";

  const material = text.match(/\b(steel|alumin(?:i)?um|brass|dark)\b/i);
  if (material) params.material = material[1].toLowerCase().startsWith("alumin") ? "aluminum" : material[1].toLowerCase();

  const teeth = numAfter(text, /\b(\d+)\s*(?:teeth|tooth)\b/i);
  if (teeth !== undefined) params.toothCount = teeth;

  const outer = numAfter(text, /\bouter\s*(?:diameter|dia|d)?\s*(?:of\s*)?(\d+(?:\.\d+)?)/i);
  if (outer !== undefined) params.outerDiameter = outer;
  const inner = numAfter(text, /\b(?:inner|bore)\s*(?:diameter|dia|d)?\s*(?:of\s*)?(\d+(?:\.\d+)?)/i);
  if (inner !== undefined) params.innerDiameter = inner;
  const thickness = numAfter(text, /\bthick(?:ness)?\s*(?:of\s*)?(\d+(?:\.\d+)?)/i);
  if (thickness !== undefined) params.thickness = thickness;
  const length = numAfter(text, /\blength\s*(?:of\s*)?(\d+(?:\.\d+)?)/i);
  if (length !== undefined) params.length = length;
  const shaft = numAfter(text, /\bshaft\s*(?:diameter|dia)?\s*(?:of\s*)?(\d+(?:\.\d+)?)/i);
  if (shaft !== undefined) params.shaftDiameter = shaft;

  if (/\b(create|make|build|generate|model|export|design)\b/i.test(text)) {
    params.command = text;
  }

  return params;
}

function parsePrecisionIntent(
  text: string
): { action: string; params: Record<string, unknown>; humanReadable: string; speech?: string } | null {
  if (/\b(disable|turn off|switch off|deactivate|stop)\b/i.test(text)) {
    return { action: "disable_precision", params: {}, humanReadable: "Turn off Precision Mode", speech: "Precision Mode is now off." };
  }
  return { action: "enable_precision", params: extractPrecisionParams(text), humanReadable: "Enable Precision Mode" };
}

function precisionSummary(params: Record<string, unknown>): string {
  const parts: string[] = [];
  if (params.partType && params.partType !== "auto") parts.push(`part type ${params.partType}`);
  if (params.toothCount != null) parts.push(`${params.toothCount} teeth`);
  if (params.outerDiameter != null) parts.push(`outer diameter ${params.outerDiameter}`);
  if (params.innerDiameter != null) parts.push(`bore ${params.innerDiameter}`);
  if (params.thickness != null) parts.push(`thickness ${params.thickness}`);
  if (params.length != null) parts.push(`length ${params.length}`);
  if (params.material) parts.push(`${params.material} material`);
  const summary = parts.length ? ` with ${parts.join(", ")}` : "";
  const build = params.command ? " Building it now." : " Tell me what to build next.";
  return `Precision Mode is on${summary}.${build}`;
}

/** Returns a spoken follow-up question when an action is missing required info, else null. */
function needsClarification(action: string, params: Record<string, unknown>, _context: string): string | null {
  switch (action) {
    case "compose_email":
      if (!String(params.to ?? "").trim() && !String(params.recipientName ?? "").trim())
        return "Who should I send the email to?";
      return null;
    case "schedule_meeting":
      if ((!Array.isArray(params.attendees) || params.attendees.length === 0) && Array.isArray(params.requestedAttendees) && params.requestedAttendees.length > 0)
        return `I couldn't find ${String(params.requestedAttendees[0])} in the employee list. Please say the employee name again or give me the email address.`;
      if (!Array.isArray(params.attendees) || params.attendees.length === 0)
        return "Who should attend the meeting?";
      if (!String(params.startDateTime ?? "").trim())
        return "What time should I schedule the meeting?";
      return null;
    case "filter_employee":
      if (!String(params.query ?? "").trim())
        return "Which employee should I filter by? You can tell me a name or an ID.";
      return null;
    case "approve":
      if (!String(params.id ?? "").trim()) return "Which request ID should I approve?";
      return null;
    case "reject":
      if (!String(params.id ?? "").trim()) return "Which request ID should I reject?";
      return null;
    case "enable_precision": {
      const hasPart = params.partType && params.partType !== "auto";
      const hasDimension = ["toothCount", "outerDiameter", "innerDiameter", "thickness", "length", "shaftDiameter"]
        .some((key) => params[key] != null);
      if (!hasPart && !hasDimension)
        return "Precision Mode locks the model to exact dimensions. What part type should I use — for example a gear, shaft, or coupling — and any key sizes like tooth count or outer diameter?";
      return null;
    }
    case "create_employee": {
      const missing = ["name", "email", "phone", "position", "dob", "dateOfJoining", "address"]
        .filter((field) => !String(params[field] ?? "").trim());
      if (!missing.length) return null;
      return `I need ${missing.join(", ")} to create the employee.`;
    }
    default:
      return null;
  }
}

interface VoiceResult {
  action: string;
  params: Record<string, unknown>;
  humanReadable: string;
  speech?: string;
  [key: string]: unknown;
}

async function answerGeneralQuestion(transcript: string): Promise<VoiceResult> {
  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 220,
    system:
      "You are Genius AI, a Bonfiglioli voice assistant inside a Next.js application. " +
      "Answer the user's spoken question directly in 1 to 3 short sentences. " +
      "For live date or time questions, do not guess, but those should normally be handled elsewhere. " +
      "Keep the answer concise, helpful, and spoken-language friendly.",
    messages: [{ role: "user", content: transcript }],
  });

  const answer = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "I couldn't answer that right now.";
  return {
    action: "answer_question",
    params: { answer, topic: "general" },
    humanReadable: "Answer question",
    speech: answer,
  };
}

/** A natural sentence to speak when the action itself didn't supply one. */
function deriveSpeech(result: VoiceResult): string {
  switch (result.action) {
    case "navigate":
    case "navigate_with_action":
      return String(result.params?.prompt ?? "") || result.humanReadable || "Opening that now.";
    case "describe_capabilities":
      return String(result.speech ?? "") || GENIO_CAPABILITIES_SPEECH;
    case "answer_question":
      return String(result.params?.answer ?? result.speech ?? result.humanReadable ?? "Here is the answer.");
    case "run_command":
      return "Running that now.";
    case "enable_precision":
      return precisionSummary(result.params);
    case "disable_precision":
      return "Precision Mode is now off.";
    case "unknown":
      return "Sorry, I didn't catch that. Could you say it again?";
    default:
      return result.humanReadable || "Done.";
  }
}

/** Ensure every response carries a `speech` sentence, then serialize it. */
function respond(result: VoiceResult) {
  if (result && result.action && !result.speech) {
    result.speech = deriveSpeech(result);
  }
  return NextResponse.json(result);
}

function fallbackParse(
  transcript: string,
  context: string
): { action: string; params: Record<string, unknown>; humanReadable: string } | null {
  const t = transcript.trim();

  switch (context) {
    case "mail": {
      if (/\b(unread)\b/i.test(t)) return { action: "filter_unread", params: {}, humanReadable: "Filter unread emails" };
      if (/\b(meeting|meetings)\b/i.test(t) && /\b(show|filter|only|list)\b/i.test(t)) {
        return { action: "filter_meetings", params: {}, humanReadable: "Filter meeting emails" };
      }
      if (REFRESH_RE.test(t)) return { action: "refresh_inbox", params: {}, humanReadable: "Refresh inbox" };
      if (/\b(acknowledge|receipt)\b/i.test(t)) return { action: "acknowledge", params: {}, humanReadable: "Draft acknowledgement" };
      if (/\b(auto respond|auto reply|draft reply|respond)\b/i.test(t)) return { action: "auto_respond", params: {}, humanReadable: "Draft automatic response" };
      if (/\breply\b/i.test(t)) {
        return {
          action: "reply",
          params: { body: extractAfterKeyword(t, "reply") || "Please help me reply to this email." },
          humanReadable: "Prepare email reply",
        };
      }
      if (/\b(compose|send email|write email|draft email)\b/i.test(t)) {
        const toMatch = t.match(/\bto\s+([^,]+?)(?:\s+subject\b|,|\s+about\b|\s+body\b|$)/i);
        const subjectMatch = t.match(/\bsubject\s+(.+?)(?:\s+body\b|$)/i);
        const body = extractAfterKeyword(t, "body");
        return {
          action: "compose_email",
          params: {
            to: (toMatch?.[1] ?? "").trim(),
            subject: (subjectMatch?.[1] ?? "").trim(),
            body: body || t,
          },
          humanReadable: "Open compose email",
        };
      }
      if (/\b(create|schedule|book|arrange|set up|setup|plan)\b.*\b(meeting|call|sync|discussion|connect)\b/i.test(t) || /\b(sync|meeting|call)\b.*\bwith\b/i.test(t)) {
        const attendeeResolution = resolveEmployeeRecipients(extractAttendees(t));
        return {
          action: "schedule_meeting",
          params: {
            title: extractMeetingTitle(t),
            attendees: attendeeResolution.emails,
            attendeeNames: attendeeResolution.names,
            requestedAttendees: extractAttendees(t),
            duration: parseDurationMinutes(t),
            agenda: t,
            startDateTime: extractMeetingStartDateTime(t),
          },
          humanReadable: "Prepare meeting details",
        };
      }
      return null;
    }

    case "birthday": {
      if (/\bn8n\b/i.test(t)) return { action: "trigger_n8n", params: {}, humanReadable: "Trigger birthday workflow" };
      if (SEND_TODAY_RE.test(t)) return { action: "send_today", params: {}, humanReadable: "Sending today's birthday emails" };
      if (SEND_TEST_RE.test(t)) return { action: "send_test", params: {}, humanReadable: "Sending test birthday email" };
      const themeMatch = t.match(/\b(confetti|sunset|galaxy|garden|golden)\b/i);
      if (themeMatch) {
        return {
          action: "set_theme",
          params: { theme: themeMatch[1].toLowerCase() },
          humanReadable: `Set theme to ${themeMatch[1]}`,
        };
      }
      if (/\b(schedule|time)\b/i.test(t)) {
        const parsedTime = extractTime(t);
        if (parsedTime) {
          return {
            action: "set_schedule_time",
            params: parsedTime,
            humanReadable: `Set schedule to ${String(parsedTime.hour).padStart(2, "0")}:${String(parsedTime.minute).padStart(2, "0")}`,
          };
        }
      }
      if (/\b(schedule)\b/i.test(t)) {
        const enabled = parseBooleanIntent(t);
        if (enabled !== null) {
          return {
            action: "toggle_schedule",
            params: { enabled },
            humanReadable: enabled ? "Enable birthday schedule" : "Disable birthday schedule",
          };
        }
      }
      return null;
    }

    case "timesheet": {
      if (/\b(attendance)\b/i.test(t)) return { action: "switch_tab", params: { tab: "attendance" }, humanReadable: "Open attendance tab" };
      if (SUBMIT_LEAVE_RE.test(t)) return { action: "submit_leave", params: {}, humanReadable: "Open leave request form" };
      if (/\b(automation|auto)\b/i.test(t)) return { action: "switch_tab", params: { tab: "automation" }, humanReadable: "Open automation tab" };
      if (/\b(new|entry|manual)\b/i.test(t)) return { action: "switch_tab", params: { tab: "new" }, humanReadable: "Open new entry tab" };
      if (/\b(excel|import)\b/i.test(t)) return { action: "switch_tab", params: { tab: "excel" }, humanReadable: "Open Excel import tab" };
      if (/\b(filter|show)\b.*\b(employee)\b/i.test(t)) {
        const query = extractAfterKeyword(t, "employee") || extractAfterKeyword(t, "show") || extractAfterKeyword(t, "filter");
        return { action: "filter_employee", params: { query }, humanReadable: `Filter ${trimMessage(query || "employee")}` };
      }
      return null;
    }

    case "timesheet-review": {
      if (/\b(activity)\b/i.test(t)) return { action: "switch_tab", params: { tab: "activity" }, humanReadable: "Open activity tab" };
      if (/\b(timer)\b/i.test(t) && /\b(stop)\b/i.test(t)) return { action: "stop_timer", params: {}, humanReadable: "Stop timer" };
      if (/\b(timer)\b/i.test(t) && /\b(start)\b/i.test(t)) {
        return {
          action: "start_timer",
          params: { task: extractAfterKeyword(t, "for") || t },
          humanReadable: "Start timer",
        };
      }
      if (/\b(infer|analyze)\b/i.test(t)) return { action: "infer_tasks", params: {}, humanReadable: "Infer tasks" };
      if (/\b(submit)\b.*\b(timesheet)\b/i.test(t)) return { action: "submit_timesheet", params: {}, humanReadable: "Submit timesheet" };
      return null;
    }

    case "employees": {
      if (/\b(add|new|create)\b.*\b(employee)\b/i.test(t)) {
        const payload = extractEmployeePayload(t);
        const hasDetails = ["name", "email", "phone", "position", "dob", "dateOfJoining", "address"]
          .some((field) => String(payload[field] ?? "").trim());
        if (hasDetails) {
          return { action: "create_employee", params: payload, humanReadable: `Create employee ${trimMessage(String(payload.name ?? "record"))}` };
        }
        return { action: "add_employee", params: {}, humanReadable: "Open add employee form" };
      }
      if (CLEAR_RE.test(t) && /\b(filter|search)\b/i.test(t)) return { action: "clear_filter", params: {}, humanReadable: "Clear employee filter" };
      if (/\b(position|role|designation)\b/i.test(t)) {
        const value = extractAfterKeyword(t, "position") || extractAfterKeyword(t, "role") || extractAfterKeyword(t, "designation");
        if (value) return { action: "filter_position", params: { position: value }, humanReadable: `Filter ${trimMessage(value)}` };
      }
      if (/\b(show)\b/i.test(t) && /\bemployee\b/i.test(t)) {
        const name = extractAfterKeyword(t, "employee");
        if (name) return { action: "show_employee", params: { name }, humanReadable: `Show ${trimMessage(name)}` };
      }
      return { action: "search", params: { query: t }, humanReadable: `Search ${trimMessage(t)}` };
    }

    case "finance": {
      if (REFRESH_RE.test(t)) return { action: "refresh", params: {}, humanReadable: "Refresh finance data" };
      if (/\b(pending)\b/i.test(t)) return { action: "show_pending", params: {}, humanReadable: "Show pending approvals" };
      if (/\b(submit|raise|new)\b.*\b(request|bill|expense)\b/i.test(t)) return { action: "submit_request", params: {}, humanReadable: "Open finance request form" };
      const idMatch = t.match(/\b([A-Z]{2,}\d+|\d{3,})\b/i);
      if (/\bapprove\b/i.test(t) && idMatch) return { action: "approve", params: { id: idMatch[1] }, humanReadable: `Approve ${idMatch[1]}` };
      if (/\breject\b/i.test(t) && idMatch) return { action: "reject", params: { id: idMatch[1] }, humanReadable: `Reject ${idMatch[1]}` };
      return null;
    }

    case "documents": {
      if (/\b(show|toggle)\b.*\b(changed|differences only)\b/i.test(t)) {
        return { action: "toggle_changed_only", params: {}, humanReadable: "Toggle changed-only view" };
      }
      if (CLEAR_RE.test(t)) return { action: "clear", params: {}, humanReadable: "Clear document comparison" };
      return null;
    }

    case "cad": {
      if (/\b(analyze|generate|create|make|draw|drawing|report)\b/i.test(t)) return { action: "analyze", params: {}, humanReadable: "Analyze CAD file" };
      if (CLEAR_RE.test(t)) return { action: "clear", params: {}, humanReadable: "Clear CAD report" };
      return null;
    }

    case "onboarding": {
      if (REFRESH_RE.test(t)) return { action: "refresh", params: {}, humanReadable: "Refresh onboarding list" };
      if (/\bpending\b/i.test(t)) return { action: "filter_status", params: { status: "pending" }, humanReadable: "Filter pending onboarding" };
      if (/\b(in progress|ongoing)\b/i.test(t)) return { action: "filter_status", params: { status: "in_progress" }, humanReadable: "Filter in-progress onboarding" };
      if (/\b(completed|done|finished)\b/i.test(t)) return { action: "filter_status", params: { status: "completed" }, humanReadable: "Filter completed onboarding" };
      if (/\b(search|show|find)\b/i.test(t)) {
        const query = extractAfterKeyword(t, "search") || extractAfterKeyword(t, "show") || extractAfterKeyword(t, "find");
        if (query) return { action: "search", params: { query }, humanReadable: `Search ${trimMessage(query)}` };
      }
      return null;
    }

    default:
      return null;
  }
}

function parseContextAction(
  transcript: string,
  context: string,
  isNavIntent = false
): { action: string; params: Record<string, unknown>; humanReadable: string } | null {
  const t = transcript.trim();

  if (context === "assistant") {
    if (CLEAR_CHAT_RE.test(t)) return { action: "clear_chat", params: {}, humanReadable: "Starting new conversation" };
    if (SUBMIT_LEAVE_RE.test(t)) return { action: "submit_leave", params: {}, humanReadable: "Open leave request form" };
    // On the AI Assistant tab, treat EVERYTHING else as a question to answer
    // (and speak back), even if it contains words like "show" or "tell me".
    return { action: "ask", params: { message: t }, humanReadable: `Ask: "${trimMessage(t)}"` };
  }

  if (context === "birthday") {
    if (SEND_TODAY_RE.test(t)) return { action: "send_today", params: {}, humanReadable: "Sending today's birthday emails" };
    if (SEND_TEST_RE.test(t)) return { action: "send_test", params: {}, humanReadable: "Sending test birthday email" };
  }

  if (context === "timesheet" && SUBMIT_LEAVE_RE.test(t)) {
    return { action: "submit_leave", params: {}, humanReadable: "Open leave request form" };
  }

  if (context === "mail" && COMPOSE_INTENT_RE.test(t)) {
    const draft = extractComposeDraft(t);
    return {
      action: "compose_email",
      params: {
        to: draft.to,
        recipientName: draft.recipientName,
        subject: draft.subject,
        body: draft.body,
      },
      humanReadable: `Compose email to ${trimMessage(draft.recipientName || draft.to || "recipient")}`,
    };
  }

  if (context === "employees" && /\b(add|new|create)\b.*\b(employee)\b/i.test(t)) {
    const payload = extractEmployeePayload(t);
    const hasDetails = ["name", "email", "phone", "position", "dob", "dateOfJoining", "address"]
      .some((field) => String(payload[field] ?? "").trim());
    if (hasDetails) {
      return {
        action: "create_employee",
        params: payload,
        humanReadable: `Create employee ${trimMessage(String(payload.name ?? "record"))}`,
      };
    }
  }

  if (["cli-agent", "nx-agent", "nx-lab", "desktop-agent", "browser-agent"].includes(context)) {
    if (isNavIntent) return null;
    if (QUESTION_RE.test(t) && !EXECUTE_INTENT_RE.test(t)) return null;
    if ((context === "nx-lab" || context === "nx-agent") && /\bprecision\b/i.test(t)) {
      const precisionAction = parsePrecisionIntent(t);
      if (precisionAction) return precisionAction;
    }
    const target =
      context === "nx-agent" || context === "nx-lab" ? "blender"
      : context === "desktop-agent" ? "desktop"
      : context === "browser-agent" ? "browser"
      : "cli";
    return { action: "run_command", params: { command: t, target }, humanReadable: `Run: "${trimMessage(t)}"` };
  }

  return fallbackParse(t, context);
}

function parseGlobalMailIntent(
  transcript: string,
  context: string
): { action: string; params: Record<string, unknown>; humanReadable: string } | null {
  const t = transcript.trim();
  if (!COMPOSE_INTENT_RE.test(t)) return null;

  const draft = extractComposeDraft(t);
  if (!draft.to && !draft.recipientName) return null;

  const composeAction = {
    action: "compose_email",
    params: {
      to: draft.to,
      recipientName: draft.recipientName,
      subject: draft.subject,
      body: draft.body,
    },
    humanReadable: `Compose email to ${trimMessage(draft.recipientName || draft.to || "recipient")}`,
  };

  if (context === "mail") {
    return composeAction;
  }

  return {
    action: "navigate_with_action",
    params: {
      path: "mail",
      prompt: "Opening Mail & Meetings and preparing your draft.",
      followupAction: composeAction,
    },
    humanReadable: `Open mail for ${trimMessage(draft.recipientName || draft.to || "recipient")}`,
  };
}

function parseGlobalEngineeringIntent(
  transcript: string,
  context: string
): { action: string; params: Record<string, unknown>; humanReadable: string } | null {
  const t = transcript.trim();
  if (!MECHANICAL_INTENT_RE.test(t)) return null;

  const runAction = {
    action: "run_command",
    params: { command: t, target: "blender" },
    humanReadable: `Run: "${trimMessage(t)}"`,
  };

  if (context === "nx-lab" || context === "nx-agent") {
    return runAction;
  }

  return null;
}

function parseGlobalEmployeeIntent(
  transcript: string,
  context: string
): { action: string; params: Record<string, unknown>; humanReadable: string } | null {
  const t = transcript.trim();
  if (!/\b(add|new|create)\b.*\b(employee)\b/i.test(t)) return null;

  const payload = extractEmployeePayload(t);
  const hasDetails = ["name", "email", "phone", "position", "dob", "dateOfJoining", "address"]
    .some((field) => String(payload[field] ?? "").trim());
  const followupAction = hasDetails
    ? {
        action: "create_employee",
        params: payload,
        humanReadable: `Create employee ${trimMessage(String(payload.name ?? "record"))}`,
      }
    : {
        action: "add_employee",
        params: {},
        humanReadable: "Open add employee form",
      };

  if (context === "employees") return followupAction;

  return {
    action: "navigate_with_action",
    params: {
      path: "employees",
      prompt: hasDetails ? "Employees is open. Creating the new employee now." : "Employees is open. You can add the new employee now.",
      followupAction,
    },
    humanReadable: "Open Employees and continue",
  };
}

function parseTabNavigationIntent(
  transcript: string
): { action: string; params: Record<string, unknown>; humanReadable: string } | null {
  if (!TAB_KEYWORD_RE.test(transcript)) return null;

  const destinationFirstMatch = transcript.match(/^\s*(?:please\s+)?(?:(?:open|go to|navigate(?:\s+to)?|switch(?:\s+to)?|take me to|show)\s+)?(.+?)\s+tab\b(.*)$/i);
  const commandFirstMatch = transcript.match(/^\s*(.+?)\s+(?:in|on)\s+(?:the\s+)?(.+?)\s+tab\s*$/i);

  let destinationPhrase = "";
  let followupCommand = "";

  if (commandFirstMatch) {
    followupCommand = commandFirstMatch[1].trim();
    destinationPhrase = commandFirstMatch[2].trim();
  } else if (destinationFirstMatch) {
    destinationPhrase = destinationFirstMatch[1].trim();
    followupCommand = destinationFirstMatch[2].trim();
  } else {
    return null;
  }

  followupCommand = followupCommand.replace(/^(?:and then|then|and)\s+/i, "").trim();
  const destination = parseDestinationPhrase(destinationPhrase);
  if (!destination) return null;

  if (followupCommand) {
    const destinationContext = getContextForPath(destination.path);
    const followupAction = parseContextAction(followupCommand, destinationContext, false)
      ?? fallbackParse(followupCommand, destinationContext)
      ?? (["cli-agent", "nx-agent", "nx-lab", "desktop-agent", "browser-agent"].includes(destinationContext)
        ? {
            action: "run_command",
            params: {
              command: followupCommand,
              target:
                destinationContext === "nx-agent" || destinationContext === "nx-lab" ? "blender"
                : destinationContext === "desktop-agent" ? "desktop"
                : destinationContext === "browser-agent" ? "browser"
                : "cli",
            },
            humanReadable: `Run: "${trimMessage(followupCommand)}"`,
          }
        : null);

    if (followupAction) {
      return {
        action: "navigate_with_action",
        params: {
          path: destination.path,
          prompt: `${destination.label.replace(/^Open\s+/i, "")} is opened. Running your command now.`,
          followupAction,
        },
        humanReadable: `${destination.label} and continue`,
      };
    }
  }

  return {
    action: "navigate",
    params: { path: destination.path },
    humanReadable: destination.label,
  };
}

function parseNavigationIntent(
  transcript: string
): { action: string; params: Record<string, unknown>; humanReadable: string } | null {
  const navigationMatch = transcript.match(/^\s*(?:please\s+)?(?:open|go to|navigate(?:\s+to)?|switch to|take me to|show)\s+(.+)$/i);
  if (!navigationMatch) return null;

  const destinationText = navigationMatch[1].trim();
  const destination = parseDestinationPhrase(destinationText);
  if (!destination) return null;

  return {
    action: "navigate",
    params: { path: destination.path },
    humanReadable: destination.label,
  };
}

function quickParse(
  transcript: string,
  context: string
): VoiceResult | null {
  const t = transcript.trim();
  const isNavIntent = NAV_INTENT_RE.test(t);
  const isTabIntent = TAB_KEYWORD_RE.test(t);
  const hasExecuteIntent = EXECUTE_INTENT_RE.test(t);

  const tabNavigationAction = parseTabNavigationIntent(t);
  if (tabNavigationAction) return tabNavigationAction;

  const presentationIntentAction = parsePresentationIntent(t);
  if (presentationIntentAction) return presentationIntentAction;

  const selfIntentAction = parseSelfIntent(t);
  if (selfIntentAction) return selfIntentAction;

  const utilityQuestionAction = parseUtilityQuestion(t);
  if (utilityQuestionAction) return utilityQuestionAction;

  // Precision Mode wins inside NX contexts so a follow-up like "gear, 18 teeth"
  // isn't swallowed by the generic mechanical/run_command matcher below.
  if (!isNavIntent && !isTabIntent && (context === "nx-lab" || context === "nx-agent") && /\bprecision\b/i.test(t)) {
    const precisionAction = parsePrecisionIntent(t);
    if (precisionAction) return precisionAction;
  }

  if (!isTabIntent) {
    const localContextMatch = parseContextAction(t, context, false);
    if (localContextMatch) return localContextMatch;
  }

  const globalMail = parseGlobalMailIntent(t, context);
  if (globalMail) return globalMail;

  const globalEmployee = parseGlobalEmployeeIntent(t, context);
  if (globalEmployee) return globalEmployee;

  if (context === "general" && MECHANICAL_INTENT_RE.test(t) && !isTabIntent) {
    return {
      action: "unknown",
      params: {},
      humanReadable: "Say NX tab first",
      speech: "Say NX tab first, then tell me what to create.",
    };
  }

  if (context === "general") {
    const navigationAction = parseNavigationIntent(t);
    if (navigationAction) return navigationAction;

    const globalEngineering = parseGlobalEngineeringIntent(t, context);
    if (globalEngineering) return globalEngineering;
  }

  // Navigation — matches across all contexts
  if (!hasExecuteIntent && context === "general") {
    for (const { re, path, label } of NAV_PATTERNS) {
      if (re.test(t)) {
        return { action: "navigate", params: { path }, humanReadable: label };
      }
    }
  }

  return null; // Let Claude handle it only if no local parse matched
}

export async function POST(request: Request) {
  try {
    const { transcript, context, clarifyContext } = await request.json();
    if (!transcript?.trim()) {
      return NextResponse.json({ error: "No transcript provided" }, { status: 400 });
    }

    // If this is the answer to a clarifying question, merge it with the original
    // command so "create a gear" + "18 teeth, steel" parse as one instruction.
    const priorTranscript = String(clarifyContext?.priorTranscript ?? "").trim();
    const isFollowup = priorTranscript.length > 0;
    const effectiveTranscript = isFollowup ? `${priorTranscript}. ${transcript}` : transcript;

    // Ask for missing info on the first pass only — avoids re-asking in a loop.
    const maybeClarify = (result: VoiceResult): VoiceResult => {
      if (isFollowup) return result;
      const question = needsClarification(result.action, result.params, context);
      if (question) {
        return {
          action: "clarify",
          params: { resumeTranscript: effectiveTranscript },
          humanReadable: "I need a bit more info",
          speech: question,
        };
      }
      return result;
    };

    // Try the fast local parser first — no Claude API needed for common commands
    const quick = quickParse(effectiveTranscript, context);
    if (quick) {
      return respond(maybeClarify(quick));
    }

    if (QUESTION_RE.test(effectiveTranscript.trim())) {
      try {
        return respond(await answerGeneralQuestion(effectiveTranscript.trim()));
      } catch (generalAnswerError) {
        console.error("[voice] General answer error:", generalAnswerError);
      }
    }

    const schema = CONTEXT_SCHEMAS[context] || CONTEXT_SCHEMAS.general;

    let raw = "{}";
    try {
      const msg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        system: `You are a friendly voice assistant for a ${schema.description}.
Parse the user's spoken command and return a JSON object with this structure:
{
  "action": "<action_name>",
  "params": { <action-specific params> },
  "humanReadable": "<short description of what will happen, max 60 chars>",
  "speech": "<one short, natural sentence to say back to the user>"
}

Available actions:
${schema.actions}

Rules:
- Return ONLY valid JSON, no markdown, no extra text
- Always include a "speech" field: a short, natural spoken confirmation or question
- If a required parameter is missing or ambiguous, DO NOT guess. Instead return
  { "action": "clarify", "params": {}, "humanReadable": "Need more info", "speech": "<the question to ask>" }
- If no action matches, return { "action": "unknown", "params": {}, "humanReadable": "Command not understood", "speech": "Sorry, I didn't catch that. Could you say it again?" }
- Be generous in interpretation — map natural language to the closest action
- For run_command actions, pass the full natural-language instruction as the command`,

        messages: [
          {
            role: "user",
            content: `Voice command: "${effectiveTranscript}"`,
          },
        ],
      });
      raw = msg.content[0].type === "text" ? msg.content[0].text.trim() : "{}";
    } catch (claudeError) {
      const fallback = fallbackParse(effectiveTranscript, context);
      if (fallback) {
        return respond(maybeClarify({ ...fallback, localFallback: true }));
      }

      console.error("[voice] Claude API error:", claudeError);
      return respond({
        action: "unknown",
        params: {},
        humanReadable: "Command not understood",
        error: String(claudeError),
      });
    }

    const json = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/, "");

    try {
      const parsed = JSON.parse(json) as VoiceResult;
      if (parsed?.action === "unknown") {
        const fallback = fallbackParse(effectiveTranscript, context);
        if (fallback) {
          return respond(maybeClarify({ ...fallback, localFallback: true }));
        }
      }
      // Never re-ask once the user has already answered a clarifying question.
      if (isFollowup && parsed?.action === "clarify") {
        const fallback = fallbackParse(effectiveTranscript, context);
        return respond(fallback ? { ...fallback, localFallback: true } : {
          action: "unknown",
          params: {},
          humanReadable: "Command not understood",
        });
      }
      return respond(parsed);
    } catch {
      return NextResponse.json({ error: "Could not parse AI response", raw }, { status: 500 });
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
