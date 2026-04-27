import { NextRequest } from "next/server";
import {
  addTimesheetEntry,
  exportTimesheetToExcel,
  generateDemoAttendance,
  getAttendanceRecords,
  getAttendanceSummary,
  getTimesheetEntries,
  getTimesheetFromExcel,
  markAttendanceEvent,
} from "@/lib/timesheet";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const employeeId = searchParams.get("employeeId") ?? undefined;
  const month = searchParams.get("month") ?? undefined;
  const year = searchParams.get("year") ? parseInt(searchParams.get("year")!) : undefined;
  const source = searchParams.get("source");
  const exportXlsx = searchParams.get("export");
  const date = searchParams.get("date") ?? undefined;

  if (source === "excel") {
    return Response.json({ summaries: getTimesheetFromExcel() });
  }

  const entries = getTimesheetEntries(employeeId, month, year);

  if (exportXlsx && employeeId) {
    const buffer = exportTimesheetToExcel(entries, employeeId);
    return new Response(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="timesheet-${employeeId}-${month ?? "all"}.xlsx"`,
      },
    });
  }

  const totalHours = entries.reduce((s, e) => s + e.actualHours, 0);
  const estimatedHours = entries.reduce((s, e) => s + e.estimatedHours, 0);

  return Response.json({
    entries,
    total: entries.length,
    totalHours,
    estimatedHours,
    attendance: getAttendanceRecords(date),
    attendanceSummary: getAttendanceSummary(date),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action } = body;

  if (action === "demo_generate") {
    const attendance = generateDemoAttendance(body.date);
    return Response.json({
      attendance,
      attendanceSummary: getAttendanceSummary(body.date),
    });
  }

  if (action === "check_in" || action === "lunch_start" || action === "lunch_end" || action === "check_out") {
    if (!body.employeeId || !body.employeeName) {
      return Response.json({ error: "employeeId and employeeName are required" }, { status: 400 });
    }

    try {
      const attendance = markAttendanceEvent(body.employeeId, body.employeeName, action);
      return Response.json({ attendance });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Attendance update failed" },
        { status: 400 }
      );
    }
  }

  const { employeeId, employeeName, taskNo, description, status, estimatedHours, actualHours, date, month, year, projectNo } = body;

  if (!employeeId || !description) {
    return Response.json({ error: "employeeId and description are required" }, { status: 400 });
  }

  const entry = addTimesheetEntry({
    employeeId,
    employeeName: employeeName ?? employeeId,
    taskNo: taskNo ?? `TASK-${Date.now()}`,
    description,
    status: status ?? "In Progress",
    estimatedHours: Number(estimatedHours) || 0,
    actualHours: Number(actualHours) || 0,
    date: date ?? new Date().toISOString().split("T")[0],
    month: month ?? new Date().toLocaleString("default", { month: "long" }),
    year: year ?? new Date().getFullYear(),
    projectNo,
  });

  // Trigger n8n if configured
  if (process.env.N8N_TIMESHEET_WEBHOOK) {
    fetch(process.env.N8N_TIMESHEET_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "timesheet_submitted", entry }),
    }).catch(console.error);
  }

  return Response.json({ entry }, { status: 201 });
}
