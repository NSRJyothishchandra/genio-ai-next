import { NextRequest } from "next/server";

const WEBHOOK_CONFIG = {
  birthday_notification: {
    envName: "N8N_BIRTHDAY_WEBHOOK",
    url: process.env.N8N_BIRTHDAY_WEBHOOK,
  },
  onboarding_started: {
    envName: "N8N_ONBOARDING_STARTED_WEBHOOK",
    url: process.env.N8N_ONBOARDING_STARTED_WEBHOOK ?? process.env.N8N_ONBOARDING_WEBHOOK,
  },
  timesheet_submitted: {
    envName: "N8N_TIMESHEET_SUBMITTED_WEBHOOK",
    url: process.env.N8N_TIMESHEET_SUBMITTED_WEBHOOK ?? process.env.N8N_TIMESHEET_WEBHOOK,
  },
  document_requested: {
    envName: "N8N_DOCUMENT_REQUESTED_WEBHOOK",
    url: process.env.N8N_DOCUMENT_REQUESTED_WEBHOOK ?? process.env.N8N_DOCUMENT_WEBHOOK,
  },
  employee_added: {
    envName: "N8N_EMPLOYEE_ADDED_WEBHOOK",
    url: process.env.N8N_EMPLOYEE_ADDED_WEBHOOK ?? process.env.N8N_EMPLOYEE_WEBHOOK,
  },
} satisfies Record<string, { envName: string; url?: string }>;

// This endpoint triggers n8n workflows FROM this app
export async function POST(request: NextRequest) {
  const body = (await request.json()) as { workflow?: string; payload?: unknown };
  const workflow = body.workflow;
  const payload = body.payload;

  if (!workflow) {
    return Response.json({ error: "workflow is required" }, { status: 400 });
  }

  const webhook = WEBHOOK_CONFIG[workflow as keyof typeof WEBHOOK_CONFIG];
  const webhookUrl = webhook?.url;

  if (!webhookUrl) {
    return Response.json({
      simulated: true,
      message: `n8n workflow '${workflow}' triggered (simulated - configure ${webhook?.envName ?? "the matching webhook URL"} in .env.local)`,
      payload,
      timestamp: new Date().toISOString(),
    });
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.N8N_WEBHOOK_SECRET ? { "x-webhook-secret": process.env.N8N_WEBHOOK_SECRET } : {}),
      },
      body: JSON.stringify({ workflow, payload, triggeredAt: new Date().toISOString() }),
    });

    const data = await res.json().catch(() => ({}));
    return Response.json({ success: true, n8nResponse: data });
  } catch (error) {
    return Response.json({ error: "Failed to reach n8n", details: String(error) }, { status: 502 });
  }
}
