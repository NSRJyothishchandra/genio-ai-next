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

export async function POST(request: Request) {
  try {
    const { transcript, context } = await request.json();
    if (!transcript?.trim()) {
      return NextResponse.json({ error: "No transcript provided" }, { status: 400 });
    }

    const schema = CONTEXT_SCHEMAS[context] || CONTEXT_SCHEMAS.general;

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

    const raw = msg.content[0].type === "text" ? msg.content[0].text.trim() : "{}";
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
