import { NextRequest } from "next/server";
import { upsertOnboardingRecord } from "@/lib/employees";
import { addTimesheetEntry } from "@/lib/timesheet";

// This endpoint receives events FROM n8n workflows
export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-webhook-secret");
  if (process.env.N8N_WEBHOOK_SECRET && secret !== process.env.N8N_WEBHOOK_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { event, data } = body;

  switch (event) {
    case "birthday_check": {
      // n8n triggered a birthday check — returns today's birthdays
      const { getTodaysBirthdays } = await import("@/lib/employees");
      return Response.json({ birthdays: getTodaysBirthdays(), timestamp: new Date().toISOString() });
    }

    case "onboarding_document_uploaded": {
      if (!data?.employeeId) return Response.json({ error: "employeeId required" }, { status: 400 });
      const record = upsertOnboardingRecord({
        employeeId: data.employeeId,
        documents: data.documents ?? [],
        checklist: data.checklist ?? {},
      });
      return Response.json({ success: true, record });
    }

    case "timesheet_sync": {
      if (!data?.entries) return Response.json({ error: "entries required" }, { status: 400 });
      const added = data.entries.map((entry: Record<string, unknown>) =>
        addTimesheetEntry({
          employeeId: String(entry.employeeId),
          employeeName: String(entry.employeeName ?? entry.employeeId),
          taskNo: String(entry.taskNo ?? ""),
          description: String(entry.description ?? ""),
          status: String(entry.status ?? "In Progress"),
          estimatedHours: Number(entry.estimatedHours) || 0,
          actualHours: Number(entry.actualHours) || 0,
          date: String(entry.date ?? new Date().toISOString().split("T")[0]),
          month: String(entry.month ?? ""),
          year: Number(entry.year) || new Date().getFullYear(),
          projectNo: entry.projectNo ? String(entry.projectNo) : undefined,
        })
      );
      return Response.json({ success: true, added: added.length });
    }

    case "employee_question": {
      // n8n passes a chat question, forward to Claude
      const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/claude`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: data?.question }),
      });
      const result = await response.json();
      return Response.json({ answer: result.response });
    }

    default:
      return Response.json({ error: `Unknown event: ${event}`, supportedEvents: ["birthday_check", "onboarding_document_uploaded", "timesheet_sync", "employee_question"] }, { status: 400 });
  }
}

export async function GET() {
  return Response.json({
    status: "n8n webhook receiver is active",
    endpoint: "/api/n8n/webhook",
    method: "POST",
    authentication: "Header: x-webhook-secret",
    supportedEvents: ["birthday_check", "onboarding_document_uploaded", "timesheet_sync", "employee_question"],
  });
}
