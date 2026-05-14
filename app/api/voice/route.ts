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
  employees: {
    description: "Employee directory with search and filter",
    actions: `
- search: { query: string }
- filter_department: { department: string }
- show_employee: { name: string }`,
  },
  general: {
    description: "General voice command",
    actions: `
- navigate: { path: string }
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
