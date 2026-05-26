import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

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
- schedule_meeting: { title: string, attendees: string[], duration: number, agenda: string }
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
- run_command: { command: string }  — send a prompt/command to the NX agent`,
  },
  "nx-lab": {
    description: "NX Lab for running Blender/NX scripts and training data",
    actions: `
- run_command: { command: string }`,
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
- run_command: { command: string }`,
  },
};

// ── Fast local pre-parser (no Claude needed) ────────────────────────────────
const NAV_PATTERNS: Array<{ re: RegExp; path: string; label: string }> = [
  { re: /\b(mail|email|inbox|messages?)\b/i, path: "mail", label: "Open Mail & Meetings" },
  { re: /\b(birthday|birthdays)\b/i, path: "birthday", label: "Open Birthdays" },
  { re: /\b(employee|employees|staff|team|people)\b/i, path: "employees", label: "Open Employees" },
  { re: /\b(timesheet|time sheet|attendance|timer)\b/i, path: "timesheet", label: "Open Timesheets" },
  { re: /\b(finance|invoices?|expenses?|budget)\b/i, path: "finance", label: "Open Finance" },
  { re: /\b(document|documents|compare|diff|files?)\b/i, path: "documents", label: "Open Documents" },
  { re: /\b(assistant|chat|ai|help)\b/i, path: "assistant", label: "Open AI Assistant" },
  { re: /\b(cad|drawing|engineering|design)\b/i, path: "cad", label: "Open CAD" },
  { re: /\b(onboard|onboarding|new hire|hires?)\b/i, path: "onboarding", label: "Open Onboarding" },
  { re: /\b(cli|terminal|command line)\b/i, path: "cli-agent", label: "Open CLI Agent" },
  { re: /\b(nx|blender|3d|cad agent|nx agent)\b/i, path: "nx-agent", label: "Open NX Agent" },
  { re: /\b(desktop|desktop agent)\b/i, path: "desktop-agent", label: "Open Desktop Agent" },
  { re: /\b(browser|web|chrome|browser agent)\b/i, path: "browser-agent", label: "Open Browser Agent" },
];

const CLEAR_CHAT_RE = /\b(clear|new|reset|start over|fresh)\b.*\b(chat|conversation|message)\b/i;
const SUBMIT_LEAVE_RE = /\b(leave|time off|vacation|sick|apply leave|request leave)\b/i;
const SEND_TODAY_RE = /\b(send|trigger|fire)\b.*\b(birthday|today|wishes)\b/i;
const SEND_TEST_RE = /\b(test|preview)\b.*\b(birthday|email|mail)\b/i;

function quickParse(
  transcript: string,
  context: string
): { action: string; params: Record<string, unknown>; humanReadable: string } | null {
  const t = transcript.trim();

  // Navigation — matches across all contexts
  const isNavIntent = /\b(go to|open|show|take me to|navigate|switch to)\b/i.test(t);
  if (isNavIntent || context === "general") {
    for (const { re, path, label } of NAV_PATTERNS) {
      if (re.test(t)) {
        return { action: "navigate", params: { path }, humanReadable: label };
      }
    }
  }

  // Context-specific shortcuts
  if (context === "assistant") {
    if (CLEAR_CHAT_RE.test(t)) return { action: "clear_chat", params: {}, humanReadable: "Starting new conversation" };
    if (SUBMIT_LEAVE_RE.test(t)) return { action: "submit_leave", params: {}, humanReadable: "Open leave request form" };
    // Anything else → ask
    return { action: "ask", params: { message: t }, humanReadable: `Ask: "${t.slice(0, 45)}${t.length > 45 ? "…" : ""}"` };
  }

  if (context === "birthday") {
    if (SEND_TODAY_RE.test(t)) return { action: "send_today", params: {}, humanReadable: "Sending today's birthday emails" };
    if (SEND_TEST_RE.test(t)) return { action: "send_test", params: {}, humanReadable: "Sending test birthday email" };
  }

  if (context === "timesheet") {
    if (SUBMIT_LEAVE_RE.test(t)) return { action: "submit_leave", params: {}, humanReadable: "Open leave request form" };
  }

  // Cowork agents — pass full instruction
  if (["cli-agent", "nx-agent", "nx-lab", "desktop-agent", "browser-agent"].includes(context)) {
    return { action: "run_command", params: { command: t }, humanReadable: `Run: "${t.slice(0, 45)}${t.length > 45 ? "…" : ""}"` };
  }

  return null; // Let Claude handle it
}

export async function POST(request: Request) {
  try {
    const { transcript, context } = await request.json();
    if (!transcript?.trim()) {
      return NextResponse.json({ error: "No transcript provided" }, { status: 400 });
    }

    // Try the fast local parser first — no Claude API needed for common commands
    const quick = quickParse(transcript, context);
    if (quick) {
      return NextResponse.json(quick);
    }

    const schema = CONTEXT_SCHEMAS[context] || CONTEXT_SCHEMAS.general;

    let raw = "{}";
    try {
      const msg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        system: `You are a voice command parser for a ${schema.description}.
Parse the user's spoken command and return a JSON object with this structure:
{
  "action": "<action_name>",
  "params": { <action-specific params> },
  "humanReadable": "<short description of what will happen, max 60 chars>"
}

Available actions:
${schema.actions}

Rules:
- Return ONLY valid JSON, no markdown, no extra text
- If no action matches, return { "action": "unknown", "params": {}, "humanReadable": "Command not understood" }
- Be generous in interpretation — map natural language to the closest action
- For run_command actions, pass the full natural-language instruction as the command`,

        messages: [
          {
            role: "user",
            content: `Voice command: "${transcript}"`,
          },
        ],
      });
      raw = msg.content[0].type === "text" ? msg.content[0].text.trim() : "{}";
    } catch (claudeError) {
      // Claude API unavailable — fall back to a generic unknown action so the
      // UI shows a clear error rather than a silent failure.
      console.error("[voice] Claude API error:", claudeError);
      return NextResponse.json({
        action: "unknown",
        params: {},
        humanReadable: "Voice service temporarily unavailable",
        error: String(claudeError),
      });
    }

    const json = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/, "");

    try {
      const parsed = JSON.parse(json);
      return NextResponse.json(parsed);
    } catch {
      return NextResponse.json({ error: "Could not parse AI response", raw }, { status: 500 });
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
