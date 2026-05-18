import { NextRequest } from "next/server";
import { createExpenseRequest, getFinanceSnapshot, runFinanceBatch, updateFinanceDecision } from "@/lib/finance";
import { getEmployee } from "@/lib/employees";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(getFinanceSnapshot());
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  if (body.action === "decision") {
    const item = updateFinanceDecision(body.kind, body.id, body.decision);
    if (!item) {
      return Response.json({ error: "Finance item not found" }, { status: 404 });
    }
    return Response.json({ item, snapshot: getFinanceSnapshot() });
  }

  if (body.action === "run_batch") {
    const run = runFinanceBatch(body.id);
    if (!run) {
      return Response.json({ error: "Payment batch not found" }, { status: 404 });
    }
    return Response.json({ run, snapshot: getFinanceSnapshot() });
  }

  if (body.action === "create_request") {
    if (!body.employeeId || !body.amount || !body.type) {
      return Response.json({ error: "Employee, amount, and bill type are required" }, { status: 400 });
    }

    const employee = getEmployee(body.employeeId);
    if (!employee) {
      return Response.json({ error: "Employee not found" }, { status: 404 });
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return Response.json({ error: "Enter a valid amount" }, { status: 400 });
    }

    const expense = createExpenseRequest({
      employeeId: employee.id,
      employeeName: employee.name,
      department: body.department || employee.position || "General",
      amount,
      currency: body.currency || "INR",
      type: body.type,
      notes: body.notes || "",
    });

    return Response.json({ expense, snapshot: getFinanceSnapshot() });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
