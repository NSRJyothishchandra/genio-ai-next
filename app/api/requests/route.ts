import { NextRequest } from "next/server";
import { getEmployee } from "@/lib/employees";
import { createRequest, getRequests, updateRequestStatus } from "@/lib/requests";
import { sendLeaveRequestDraftEmail } from "@/lib/email";
import { ADMIN_SESSION_COOKIE, isValidSessionToken } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const requests = getRequests();
  return Response.json({
    requests,
    summary: {
      total: requests.length,
      pendingManager: requests.filter((request) => request.status === "pending_manager").length,
      pendingAdmin: requests.filter((request) => request.status === "pending_admin").length,
      approved: requests.filter((request) => request.status === "approved").length,
      rejected: requests.filter((request) => request.status === "rejected").length,
    },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action } = body;

  if (action === "create") {
    const employee = getEmployee(body.employeeId);
    if (!employee) {
      return Response.json({ error: "Employee not found" }, { status: 404 });
    }

    const record = createRequest({
      employeeId: employee.id,
      employeeName: employee.name,
      employeeEmail: employee.email,
      kind: body.kind,
      leaveType: body.leaveType,
      title: body.title,
      reason: body.reason,
      startDate: body.startDate || null,
      endDate: body.endDate || null,
      initialStatus: body.kind === "leave" && body.leaveType === "sick" ? "approved" : undefined,
    });

    if (record.kind === "leave" && record.startDate && record.endDate) {
      await sendLeaveRequestDraftEmail({
        employeeId: record.employeeId,
        employeeName: record.employeeName,
        employeeEmail: record.employeeEmail,
        startDate: record.startDate,
        endDate: record.endDate,
        reason: record.reason,
        requestId: record.id,
        createdAt: record.createdAt,
      });
    }

    return Response.json({ request: record });
  }

  if (action === "decision") {
    const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    if (!isValidSessionToken(token)) {
      return Response.json({ error: "Admin login required for approvals." }, { status: 401 });
    }

    const updated = updateRequestStatus(body.id, body.actor, body.decision);
    if (!updated) {
      return Response.json({ error: "Request not found" }, { status: 404 });
    }
    return Response.json({ request: updated });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
