"use client";

import { useEffect, useState, useCallback } from "react";
import { useVoiceCommand } from "@/app/hooks/useVoiceCommand";

interface EmployeeOption {
  id: string;
  name: string;
  position: string;
  email: string;
}

interface FinanceInvoice {
  id: string;
  vendor: string;
  category: string;
  amount: number;
  currency: string;
  dueDate: string;
  status: "pending" | "approved" | "rejected" | "completed";
  priority: "low" | "medium" | "high";
  notes: string;
}

interface FinanceExpense {
  id: string;
  employeeName: string;
  department: string;
  amount: number;
  currency: string;
  submittedAt: string;
  type: string;
  status: "pending" | "approved" | "rejected" | "completed";
  notes: string;
}

interface FinancePaymentRun {
  id: string;
  title: string;
  scheduledFor: string;
  status: "ready" | "completed";
  items: number;
  totalAmount: number;
  currency: string;
}

interface FinanceSnapshot {
  invoices: FinanceInvoice[];
  expenses: FinanceExpense[];
  paymentRuns: FinancePaymentRun[];
  cashflow: {
    monthBudget: number;
    actualSpend: number;
    committedSpend: number;
    payrollReserve: number;
    receivables: number;
  };
  summary: {
    pendingInvoiceCount: number;
    pendingInvoiceAmount: number;
    pendingExpenseCount: number;
    pendingExpenseAmount: number;
    readyRunCount: number;
    readyRunAmount: number;
    availableBudget: number;
  };
}

function formatCurrency(amount: number, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function statusBadge(status: string) {
  switch (status) {
    case "approved":
    case "completed":
      return "badge badge-green";
    case "rejected":
      return "badge badge-red";
    case "ready":
      return "badge badge-blue";
    default:
      return "badge badge-yellow";
  }
}

export default function FinancePage() {
  const [snapshot, setSnapshot] = useState<FinanceSnapshot | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [requestForm, setRequestForm] = useState({
    employeeId: "",
    department: "",
    type: "Travel",
    amount: "",
    notes: "",
  });

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }

  async function loadFinance() {
    const [financeResponse, employeeResponse] = await Promise.all([
      fetch("/api/finance", { cache: "no-store" }),
      fetch("/api/employees", { cache: "no-store" }),
    ]);
    const financeData = await financeResponse.json();
    const employeeData = await employeeResponse.json();
    setSnapshot(financeData);
    setEmployees(employeeData.employees ?? []);
  }

  useEffect(() => {
    void loadFinance();
  }, []);

  useVoiceCommand(useCallback((action) => {
    const p = action.params;
    switch (action.action) {
      case "refresh":
        void loadFinance();
        break;
      case "show_pending":
        // scroll to pending section
        document.querySelector("[data-finance-pending]")?.scrollIntoView({ behavior: "smooth" });
        break;
      case "approve":
        if (p.id && snapshot) {
          const inv = snapshot.invoices.find(i => i.id === String(p.id));
          if (inv) void takeDecision("invoice", inv.id, "approve");
        }
        break;
      case "reject":
        if (p.id && snapshot) {
          const inv = snapshot.invoices.find(i => i.id === String(p.id));
          if (inv) void takeDecision("invoice", inv.id, "reject");
        }
        break;
      case "submit_request":
        // scroll to request form
        document.querySelector("[data-finance-request]")?.scrollIntoView({ behavior: "smooth" });
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]));

  async function takeDecision(kind: "invoice" | "expense", id: string, decision: "approve" | "reject") {
    setBusyId(id);
    const response = await fetch("/api/finance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "decision", kind, id, decision }),
    });
    const data = await response.json();
    setBusyId(null);

    if (!response.ok) {
      showToast(data.error ?? "Unable to update finance item");
      return;
    }

    setSnapshot(data.snapshot);
    showToast(`${kind} ${decision}d`);
  }

  async function runBatch(id: string) {
    setBusyId(id);
    const response = await fetch("/api/finance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "run_batch", id }),
    });
    const data = await response.json();
    setBusyId(null);

    if (!response.ok) {
      showToast(data.error ?? "Unable to run payment batch");
      return;
    }

    setSnapshot(data.snapshot);
    showToast("Payment batch completed");
  }

  async function submitRequest(event: React.FormEvent) {
    event.preventDefault();
    setBusyId("finance-request");
    const response = await fetch("/api/finance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_request",
        ...requestForm,
        amount: Number(requestForm.amount),
      }),
    });
    const data = await response.json();
    setBusyId(null);

    if (!response.ok) {
      showToast(data.error ?? "Unable to create bill approval request");
      return;
    }

    setSnapshot(data.snapshot);
    setRequestForm({
      employeeId: "",
      department: "",
      type: "Travel",
      amount: "",
      notes: "",
    });
    showToast("Bill approval request sent to finance");
  }

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      {toast ? (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 999, background: "var(--success)", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14 }}>
          {toast}
        </div>
      ) : null}

      <div className="topbar">
        <div>
          <div className="topbar-title">Finance Operations</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{today}</div>
        </div>
        <div className="topbar-right">
          <span className="badge badge-blue">Bonfiglioli Finance Desk</span>
        </div>
      </div>

      <div className="page-content">
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-label">Pending Invoices</div>
            <div className="stat-value">{snapshot?.summary.pendingInvoiceCount ?? 0}</div>
            <div className="stat-sub">{formatCurrency(snapshot?.summary.pendingInvoiceAmount ?? 0)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Pending Expenses</div>
            <div className="stat-value">{snapshot?.summary.pendingExpenseCount ?? 0}</div>
            <div className="stat-sub">{formatCurrency(snapshot?.summary.pendingExpenseAmount ?? 0)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Ready Payment Runs</div>
            <div className="stat-value">{snapshot?.summary.readyRunCount ?? 0}</div>
            <div className="stat-sub">{formatCurrency(snapshot?.summary.readyRunAmount ?? 0)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Available Budget</div>
            <div className="stat-value">{formatCurrency(snapshot?.summary.availableBudget ?? 0)}</div>
            <div className="stat-sub">Month budget headroom</div>
          </div>
        </div>

        <div className="grid-2" style={{ marginBottom: 24 }}>
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Raise Bill Approval Request</div>
                <div className="card-subtitle">Employees can submit bill amount, purpose, and notes for finance review</div>
              </div>
            </div>
            <div className="card-body">
              <form onSubmit={submitRequest} style={{ display: "grid", gap: 12 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Employee</label>
                  <select
                    className="form-select"
                    value={requestForm.employeeId}
                    onChange={(event) => {
                      const selected = employees.find((employee) => employee.id === event.target.value);
                      setRequestForm((current) => ({
                        ...current,
                        employeeId: event.target.value,
                        department: selected?.position ?? current.department,
                      }));
                    }}
                    required
                  >
                    <option value="">Select employee</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name} ({employee.id})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid-2" style={{ gap: 12 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Bill Type</label>
                    <select
                      className="form-select"
                      value={requestForm.type}
                      onChange={(event) => setRequestForm((current) => ({ ...current, type: event.target.value }))}
                    >
                      <option>Travel</option>
                      <option>Meals</option>
                      <option>Accommodation</option>
                      <option>Training</option>
                      <option>Medical</option>
                      <option>Vendor Advance</option>
                      <option>Miscellaneous</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Amount (INR)</label>
                    <input
                      className="form-input"
                      type="number"
                      min="1"
                      value={requestForm.amount}
                      onChange={(event) => setRequestForm((current) => ({ ...current, amount: event.target.value }))}
                      placeholder="25000"
                      required
                    />
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Department</label>
                  <input
                    className="form-input"
                    value={requestForm.department}
                    onChange={(event) => setRequestForm((current) => ({ ...current, department: event.target.value }))}
                    placeholder="Engineering / HR / Procurement"
                    required
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Bill Notes / Purpose</label>
                  <textarea
                    className="form-textarea"
                    value={requestForm.notes}
                    onChange={(event) => setRequestForm((current) => ({ ...current, notes: event.target.value }))}
                    placeholder="Explain what this bill is for and why approval is required"
                    required
                  />
                </div>

                <button className="btn btn-primary" disabled={busyId === "finance-request"} type="submit">
                  {busyId === "finance-request" ? "Sending..." : "Send for Finance Approval"}
                </button>
              </form>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Cashflow Overview</div>
                <div className="card-subtitle">Live budget and commitments snapshot</div>
              </div>
            </div>
            <div className="card-body" style={{ display: "grid", gap: 12 }}>
              <div className="flex-between"><span>Month Budget</span><strong>{formatCurrency(snapshot?.cashflow.monthBudget ?? 0)}</strong></div>
              <div className="flex-between"><span>Actual Spend</span><strong>{formatCurrency(snapshot?.cashflow.actualSpend ?? 0)}</strong></div>
              <div className="flex-between"><span>Committed Spend</span><strong>{formatCurrency(snapshot?.cashflow.committedSpend ?? 0)}</strong></div>
              <div className="flex-between"><span>Payroll Reserve</span><strong>{formatCurrency(snapshot?.cashflow.payrollReserve ?? 0)}</strong></div>
              <div className="flex-between"><span>Receivables</span><strong>{formatCurrency(snapshot?.cashflow.receivables ?? 0)}</strong></div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Payment Automation</div>
                <div className="card-subtitle">Trigger finance batches after approvals clear</div>
              </div>
            </div>
            <div className="card-body" style={{ display: "grid", gap: 12 }}>
              {(snapshot?.paymentRuns ?? []).map((run) => (
                <div key={run.id} className="request-card">
                  <div className="request-card-head">
                    <div>
                      <div className="request-title">{run.title}</div>
                      <div className="request-meta">
                        {run.id} • {new Date(run.scheduledFor).toLocaleString("en-IN")} • {run.items} items
                      </div>
                    </div>
                    <span className={statusBadge(run.status)}>{run.status}</span>
                  </div>
                  <div className="request-body">{formatCurrency(run.totalAmount, run.currency)}</div>
                  {run.status === "ready" ? (
                    <button className="btn btn-primary btn-sm" disabled={busyId === run.id} onClick={() => void runBatch(run.id)}>
                      {busyId === run.id ? "Running..." : "Run Payment Batch"}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid-2">
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Invoice Approval Queue</div>
                <div className="card-subtitle">Vendor invoices waiting for finance action</div>
              </div>
            </div>
            <div className="card-body" style={{ display: "grid", gap: 12 }}>
              {(snapshot?.invoices ?? []).map((invoice) => (
                <div key={invoice.id} className="request-card">
                  <div className="request-card-head">
                    <div>
                      <div className="request-title">{invoice.vendor}</div>
                      <div className="request-meta">
                        {invoice.id} • {invoice.category} • Due {invoice.dueDate}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span className={`badge ${invoice.priority === "high" ? "badge-red" : invoice.priority === "medium" ? "badge-yellow" : "badge-blue"}`}>
                        {invoice.priority}
                      </span>
                      <span className={statusBadge(invoice.status)}>{invoice.status}</span>
                    </div>
                  </div>
                  <div className="request-body">
                    <strong>{formatCurrency(invoice.amount, invoice.currency)}</strong>
                    <div style={{ marginTop: 6 }}>{invoice.notes}</div>
                  </div>
                  {invoice.status === "pending" ? (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn btn-primary btn-sm" disabled={busyId === invoice.id} onClick={() => void takeDecision("invoice", invoice.id, "approve")}>
                        Approve
                      </button>
                      <button className="btn btn-outline btn-sm" disabled={busyId === invoice.id} onClick={() => void takeDecision("invoice", invoice.id, "reject")}>
                        Reject
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Expense Claims</div>
                <div className="card-subtitle">Employee reimbursements and finance clearance</div>
              </div>
            </div>
            <div className="card-body" style={{ display: "grid", gap: 12 }}>
              {(snapshot?.expenses ?? []).map((expense) => (
                <div key={expense.id} className="request-card">
                  <div className="request-card-head">
                    <div>
                      <div className="request-title">{expense.employeeName}</div>
                      <div className="request-meta">
                        {expense.id} • {expense.department} • {expense.type}
                      </div>
                    </div>
                    <span className={statusBadge(expense.status)}>{expense.status}</span>
                  </div>
                  <div className="request-body">
                    <strong>{formatCurrency(expense.amount, expense.currency)}</strong>
                    <div style={{ marginTop: 6 }}>{expense.notes}</div>
                  </div>
                  {expense.status === "pending" ? (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn btn-primary btn-sm" disabled={busyId === expense.id} onClick={() => void takeDecision("expense", expense.id, "approve")}>
                        Approve
                      </button>
                      <button className="btn btn-outline btn-sm" disabled={busyId === expense.id} onClick={() => void takeDecision("expense", expense.id, "reject")}>
                        Reject
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
