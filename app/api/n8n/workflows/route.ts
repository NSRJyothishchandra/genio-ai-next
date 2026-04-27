import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

const WORKFLOW_DIR = path.join(process.cwd(), "n8n-workflows");

const WORKFLOW_META: Record<string, { label: string; desc: string; icon: string; tags: string[] }> = {
  "birthday-notification": {
    label: "Birthday Notification (AI)",
    desc: "Runs daily at 9 AM, detects birthdays, uses Claude AI to write personalized messages, auto-sends emails",
    icon: "🎂",
    tags: ["Schedule", "Claude AI", "Email", "Auto"],
  },
  "onboarding-started": {
    label: "Onboarding Started (AI)",
    desc: "Webhook trigger when new employee joins. AI generates welcome email + document request email",
    icon: "🚀",
    tags: ["Webhook", "Claude AI", "Email", "Documents"],
  },
  "timesheet-reminder": {
    label: "Timesheet Reminder & Analysis (AI)",
    desc: "Runs every Friday 4 PM, finds employees missing timesheets, AI writes reminder emails + analyzes submissions",
    icon: "⏰",
    tags: ["Schedule", "Webhook", "Claude AI", "Email"],
  },
  "document-request": {
    label: "Document Request (AI)",
    desc: "Webhook trigger for document requests. AI writes personalized document checklists and follow-up emails",
    icon: "📄",
    tags: ["Webhook", "Claude AI", "Email", "Checklist"],
  },
  "employee-added": {
    label: "Employee Added — Full AI Agent",
    desc: "Complete AI onboarding agent: creates 30-60-90 day plan, IT checklist, team announcement, all via Claude",
    icon: "👤",
    tags: ["Webhook", "Claude AI", "Email", "Onboarding Plan"],
  },
};

// GET /api/n8n/workflows — list all or download one
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const file = searchParams.get("file");

  if (file) {
    // Serve workflow JSON for download
    const safeFile = file.replace(/[^a-z0-9-]/g, ""); // sanitize
    const filePath = path.join(WORKFLOW_DIR, `${safeFile}.json`);
    if (!fs.existsSync(filePath)) {
      return Response.json({ error: "Workflow not found" }, { status: 404 });
    }
    const content = fs.readFileSync(filePath, "utf-8");
    // Inject the app URL so n8n can connect back
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
    const patched = content.replace(/\$\{process\.env\.PROJECTA_APP_URL\}/g, appUrl);

    return new Response(patched, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${safeFile}.json"`,
      },
    });
  }

  // List all workflows
  const files = fs.existsSync(WORKFLOW_DIR)
    ? fs.readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith(".json"))
    : [];

  const workflows = files.map((f) => {
    const id = f.replace(".json", "");
    const meta = WORKFLOW_META[id];
    let nodeCount = 0;
    try {
      const content = JSON.parse(fs.readFileSync(path.join(WORKFLOW_DIR, f), "utf-8"));
      nodeCount = content.nodes?.length ?? 0;
    } catch {}
    return {
      id,
      file: f,
      label: meta?.label ?? id,
      desc: meta?.desc ?? "",
      icon: meta?.icon ?? "⚡",
      tags: meta?.tags ?? [],
      nodeCount,
      downloadUrl: `/api/n8n/workflows?file=${id}`,
    };
  });

  return Response.json({ workflows, count: workflows.length });
}

// POST /api/n8n/workflows — auto-import into n8n via API
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { workflowId, n8nUrl, n8nApiKey } = body;

  if (!n8nUrl || !n8nApiKey) {
    return Response.json({ error: "n8nUrl and n8nApiKey required" }, { status: 400 });
  }

  const safeId = workflowId.replace(/[^a-z0-9-]/g, "");
  const filePath = path.join(WORKFLOW_DIR, `${safeId}.json`);
  if (!fs.existsSync(filePath)) {
    return Response.json({ error: "Workflow not found" }, { status: 404 });
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
  const workflow = JSON.parse(content.replace(/\$\{process\.env\.PROJECTA_APP_URL\}/g, appUrl));

  // Import into n8n via its REST API
  try {
    const res = await fetch(`${n8nUrl}/api/v1/workflows`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-N8N-API-KEY": n8nApiKey,
      },
      body: JSON.stringify(workflow),
    });

    if (!res.ok) {
      const err = await res.text();
      return Response.json({ error: `n8n API error: ${err}`, status: res.status }, { status: 502 });
    }

    const created = await res.json();
    return Response.json({
      success: true,
      workflowId: created.id,
      name: created.name,
      n8nUrl: `${n8nUrl}/workflow/${created.id}`,
    });
  } catch (err) {
    return Response.json({ error: String(err), hint: "Is n8n running and API key correct?" }, { status: 502 });
  }
}
