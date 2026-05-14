"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import HomeLauncher from "./HomeLauncher";

interface Employee {
  id: string;
  name: string;
  position: string;
  email: string;
  dob: string;
}

interface BirthdayEmp extends Employee {
  daysUntil: number;
}

interface Stats {
  total: number;
  byGender: Record<string, number>;
  byPosition: Record<string, number>;
}

interface EmployeeRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  kind: "leave" | "attendance_correction" | "other";
  title: string;
  reason: string;
  startDate: string | null;
  endDate: string | null;
  status: "pending_manager" | "pending_admin" | "approved" | "rejected";
  createdAt: string;
}

interface RequestSummary {
  total: number;
  pendingManager: number;
  pendingAdmin: number;
  approved: number;
  rejected: number;
}

interface AutomationCard {
  title: string;
  summary: string;
  status: "completed" | "attention";
  details: string[];
  count: number;
}

interface AutomationLog {
  id: string;
  action: string;
  title: string;
  summary: string;
  status: "completed" | "attention";
  details: string[];
  createdAt: string;
}

interface AutomationSnapshot {
  cards: {
    missedCheckins: AutomationCard;
    absenceSummary: AutomationCard;
    anniversaries: AutomationCard;
    onboarding: AutomationCard;
    documentChase: AutomationCard;
    attendanceCorrections: AutomationCard;
    monthlyReport: AutomationCard;
    festivalMailer: AutomationCard;
    probation: AutomationCard;
    exitProcess: AutomationCard;
  };
  logs: AutomationLog[];
}

const EMPTY_REQUEST_FORM = {
  employeeId: "",
  kind: "leave" as "leave" | "attendance_correction" | "other",
  title: "",
  reason: "",
  startDate: "",
  endDate: "",
};

const AUTOMATION_ACTIONS = [
  { key: "missed_checkin_followup", title: "11:30 AM Check-In Follow-up", cardKey: "missedCheckins" },
  { key: "absence_summary", title: "Auto Absence Summary", cardKey: "absenceSummary" },
  { key: "work_anniversary", title: "Work Anniversary Automation", cardKey: "anniversaries" },
  { key: "day_zero_onboarding", title: "Day-Zero Onboarding", cardKey: "onboarding" },
  { key: "document_chase", title: "Document Chase", cardKey: "documentChase" },
  { key: "attendance_correction", title: "Attendance Correction", cardKey: "attendanceCorrections" },
  { key: "monthly_hr_report", title: "Monthly HR Report", cardKey: "monthlyReport" },
  { key: "festival_mailer", title: "Festival / Event Mailer", cardKey: "festivalMailer" },
  { key: "probation_reminder", title: "Probation Reminder", cardKey: "probation" },
  { key: "exit_process", title: "Exit Process Automation", cardKey: "exitProcess" },
] as const;

export default function Dashboard() {
  const [authLoaded, setAuthLoaded] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [todayBdays, setTodayBdays] = useState<Employee[]>([]);
  const [upcomingBdays, setUpcomingBdays] = useState<BirthdayEmp[]>([]);
  const [requests, setRequests] = useState<EmployeeRequest[]>([]);
  const [requestSummary, setRequestSummary] = useState<RequestSummary | null>(null);
  const [requestForm, setRequestForm] = useState(EMPTY_REQUEST_FORM);
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [automation, setAutomation] = useState<AutomationSnapshot | null>(null);
  const [runningAutomation, setRunningAutomation] = useState<string | null>(null);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }

  async function loadDashboard() {
    const [employeeResponse, birthdayResponse, requestResponse, automationResponse] = await Promise.all([
      fetch("/api/employees", { cache: "no-store" }),
      fetch("/api/birthday", { cache: "no-store" }),
      fetch("/api/requests", { cache: "no-store" }),
      fetch("/api/automation", { cache: "no-store" }),
    ]);

    const employeeData = await employeeResponse.json();
    const birthdayData = await birthdayResponse.json();
    const requestData = await requestResponse.json();
    const automationData = await automationResponse.json();

    setStats(employeeData.stats);
    setEmployees(employeeData.employees ?? []);
    setTodayBdays(birthdayData.today ?? []);
    setUpcomingBdays(birthdayData.upcoming ?? []);
    setRequests(requestData.requests ?? []);
    setRequestSummary(requestData.summary ?? null);
    setAutomation(automationData);
  }

  useEffect(() => {
    let mounted = true;

    async function initializePage() {
      try {
        const authResponse = await fetch("/api/auth/me", { cache: "no-store" });
        const authData = await authResponse.json();
        if (!mounted) return;

        const authenticated = Boolean(authData?.authenticated);
        setIsAdmin(authenticated);
        setAuthLoaded(true);

        if (authenticated) {
          await loadDashboard();
        }
      } catch {
        if (!mounted) return;
        setIsAdmin(false);
        setAuthLoaded(true);
      }
    }

    void initializePage();

    return () => {
      mounted = false;
    };
  }, []);

  async function sendBirthdayWishes() {
    setSending(true);
    const response = await fetch("/api/birthday", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sendAll: true }),
    });
    const data = await response.json();
    setSending(false);
    showToast(`Birthday flow processed for ${data.sent ?? 0} employee(s)`);
  }

  async function submitRequest(event: React.FormEvent) {
    event.preventDefault();
    setSubmittingRequest(true);
    const payload = {
      action: "create",
      ...requestForm,
      startDate: requestForm.kind === "other" ? null : requestForm.startDate || null,
      endDate: requestForm.kind === "other" ? null : requestForm.endDate || null,
    };

    const response = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    setSubmittingRequest(false);

    if (!response.ok) {
      showToast(data.error ?? "Failed to create request");
      return;
    }

    setRequestForm(EMPTY_REQUEST_FORM);
    await loadDashboard();
    showToast(`${data.request.kind.replace("_", " ")} request sent to manager`);
  }

  async function handleDecision(id: string, actor: "manager" | "admin", decision: "approve" | "reject") {
    const response = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "decision", id, actor, decision }),
    });
    const data = await response.json();

    if (!response.ok) {
      showToast(data.error ?? "Failed to update request");
      return;
    }

    await loadDashboard();
    showToast(`${actor} ${decision}d request for ${data.request.employeeName}`);
  }

  async function runAutomation(action: string, title: string) {
    setRunningAutomation(action);
    const response = await fetch("/api/automation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await response.json();
    setRunningAutomation(null);

    if (!response.ok) {
      showToast(data.error ?? "Failed to run automation");
      return;
    }

    setAutomation(data.snapshot);
    showToast(`${title} completed`);
  }

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const managerQueue = requests.filter((request) => request.status === "pending_manager");
  const adminQueue = requests.filter((request) => request.status === "pending_admin");

  if (!authLoaded) {
    return (
      <div className="page-content" style={{ display: "grid", placeItems: "center", minHeight: "70vh" }}>
        <div className="card" style={{ maxWidth: 420, width: "100%" }}>
          <div className="card-body" style={{ textAlign: "center", padding: 32 }}>
            <div style={{ fontSize: 24, fontWeight: 900, marginBottom: 8 }}>Loading workspace...</div>
            <div style={{ color: "var(--text-muted)" }}>
              Checking whether admin controls should be unlocked for this session.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return <HomeLauncher />;
  }

  return (
    <>
      {toast ? (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 999, background: "var(--success)", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14 }}>
          {toast}
        </div>
      ) : null}

      <div className="topbar">
        <div>
          <div className="topbar-title">HR Dashboard</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{today}</div>
        </div>
        <div className="topbar-right">
          <Link href="/onboarding" className="btn btn-primary">+ New Onboarding</Link>
        </div>
      </div>

      <div className="page-content">
        {todayBdays.length > 0 ? (
          <div className="bday-card mb-6" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
                Birthday automation ready for {todayBdays.map((employee) => employee.name).join(", ")}
              </div>
              <div style={{ fontSize: 14, opacity: 0.92 }}>Employee email is the main receiver. Other employees stay in CC.</div>
            </div>
            <button onClick={sendBirthdayWishes} disabled={sending} className="btn" style={{ background: "#fff", color: "var(--primary)", fontWeight: 700 }}>
              {sending ? "Sending..." : "Run Birthday Send"}
            </button>
          </div>
        ) : null}

        <div className="stat-grid">
          <div className="stat-card">
            <div className="flex-between">
              <div className="stat-label">Total Employees</div>
              <span className="stat-icon">👥</span>
            </div>
            <div className="stat-value">{stats?.total ?? "-"}</div>
            <div className="stat-sub">{stats?.byGender?.Male ?? 0}M · {stats?.byGender?.Female ?? 0}F</div>
          </div>
          <div className="stat-card">
            <div className="flex-between">
              <div className="stat-label">Pending Manager</div>
              <span className="stat-icon">🧑‍💼</span>
            </div>
            <div className="stat-value">{requestSummary?.pendingManager ?? 0}</div>
            <div className="stat-sub">Waiting manager action</div>
          </div>
          <div className="stat-card">
            <div className="flex-between">
              <div className="stat-label">Pending Admin</div>
              <span className="stat-icon">🛡️</span>
            </div>
            <div className="stat-value">{requestSummary?.pendingAdmin ?? 0}</div>
            <div className="stat-sub">Waiting admin approval</div>
          </div>
          <div className="stat-card">
            <div className="flex-between">
              <div className="stat-label">Birthdays Today</div>
              <span className="stat-icon">🎂</span>
            </div>
            <div className="stat-value">{todayBdays.length}</div>
            <div className="stat-sub">{upcomingBdays.length} upcoming this week</div>
          </div>
        </div>

        <div className="card mb-6">
          <div className="card-header">
            <div>
              <div className="card-title">Automation Center</div>
              <div className="card-subtitle">Operational automations for Bonfiglioli HR and people ops</div>
            </div>
          </div>
          <div className="card-body">
            <div className="grid-2" style={{ gap: 14 }}>
              {AUTOMATION_ACTIONS.map((item) => {
                const card = automation?.cards[item.cardKey as keyof AutomationSnapshot["cards"]];
                return (
                  <div key={item.key} className="request-card">
                    <div className="request-card-head">
                      <div>
                        <div className="request-title">{item.title}</div>
                        <div className="request-meta">{card?.summary ?? "Loading..."}</div>
                      </div>
                      <span className={`badge ${card?.status === "attention" ? "badge-yellow" : "badge-green"}`}>
                        {card?.count ?? 0}
                      </span>
                    </div>
                    <div className="request-body">
                      {(card?.details ?? []).slice(0, 2).map((detail) => (
                        <div key={detail} style={{ marginBottom: 4 }}>{detail}</div>
                      ))}
                    </div>
                    <div className="request-actions">
                      <button className="btn btn-primary btn-sm" disabled={runningAutomation === item.key} onClick={() => runAutomation(item.key, item.title)}>
                        {runningAutomation === item.key ? "Running..." : "Run Automation"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="grid-2 mb-6">
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Employee Request Desk</div>
                <div className="card-subtitle">Leave, attendance correction, and other requests</div>
              </div>
            </div>
            <div className="card-body">
              <form onSubmit={submitRequest}>
                <div className="form-group">
                  <label className="form-label">Employee</label>
                  <select className="form-select" value={requestForm.employeeId} onChange={(event) => setRequestForm((previous) => ({ ...previous, employeeId: event.target.value }))} required>
                    <option value="">Select employee...</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name} ({employee.id})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Request Type</label>
                    <select className="form-select" value={requestForm.kind} onChange={(event) => setRequestForm((previous) => ({ ...previous, kind: event.target.value as typeof previous.kind }))}>
                      <option value="leave">Leave Request</option>
                      <option value="attendance_correction">Attendance Correction</option>
                      <option value="other">Other Request</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Title</label>
                    <input className="form-input" value={requestForm.title} onChange={(event) => setRequestForm((previous) => ({ ...previous, title: event.target.value }))} placeholder="Short request title" required />
                  </div>
                </div>
                {requestForm.kind !== "other" ? (
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">{requestForm.kind === "leave" ? "Leave Start Date" : "Correction Date"}</label>
                      <input className="form-input" type="date" value={requestForm.startDate} onChange={(event) => setRequestForm((previous) => ({ ...previous, startDate: event.target.value }))} required />
                    </div>
                    <div className="form-group">
                      <label className="form-label">{requestForm.kind === "leave" ? "Leave End Date" : "Optional End Date"}</label>
                      <input className="form-input" type="date" value={requestForm.endDate} onChange={(event) => setRequestForm((previous) => ({ ...previous, endDate: event.target.value }))} />
                    </div>
                  </div>
                ) : null}
                <div className="form-group">
                  <label className="form-label">Reason / Request Details</label>
                  <textarea className="form-textarea" value={requestForm.reason} onChange={(event) => setRequestForm((previous) => ({ ...previous, reason: event.target.value }))} placeholder="Explain the request for manager and admin review" required />
                </div>
                <button className="btn btn-primary" type="submit" disabled={submittingRequest}>
                  {submittingRequest ? "Sending..." : "Send Request"}
                </button>
              </form>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Automation Log</div>
                <div className="card-subtitle">Most recent automation runs</div>
              </div>
            </div>
            <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {(automation?.logs ?? []).length === 0 ? (
                <div className="text-muted">No automation runs yet.</div>
              ) : (
                automation!.logs.slice(0, 6).map((log) => (
                  <div key={log.id} className="timeline-row">
                    <div className="timeline-dot" style={{ background: log.status === "attention" ? "var(--warning)" : "var(--success)" }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{log.title}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{log.summary}</div>
                    </div>
                    <span className={`badge ${log.status === "attention" ? "badge-yellow" : "badge-green"}`}>
                      {new Date(log.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="grid-2 mb-6">
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Manager Approval Queue</div>
                <div className="card-subtitle">First checkpoint before HR admin</div>
              </div>
            </div>
            <div className="card-body">
              {managerQueue.length === 0 ? (
                <div className="text-muted">No requests waiting for manager approval.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {managerQueue.map((request) => (
                    <div key={request.id} className="request-card">
                      <div className="request-card-head">
                        <div>
                          <div className="request-title">{request.employeeName} - {request.title}</div>
                          <div className="request-meta">{request.kind.replace("_", " ")} · {request.employeeId} · {new Date(request.createdAt).toLocaleString("en-IN")}</div>
                        </div>
                        <span className="badge badge-yellow">Pending Manager</span>
                      </div>
                      <div className="request-body">{request.reason}</div>
                      {request.startDate ? (
                        <div className="request-date-row">
                          <span>{request.startDate}</span>
                          <span>{request.endDate || request.startDate}</span>
                        </div>
                      ) : null}
                      <div className="request-actions">
                        <button className="btn btn-primary btn-sm" onClick={() => handleDecision(request.id, "manager", "approve")}>Approve to Admin</button>
                        <button className="btn btn-outline btn-sm" onClick={() => handleDecision(request.id, "manager", "reject")}>Reject</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Admin Approval Queue</div>
                <div className="card-subtitle">Final HR decision</div>
              </div>
            </div>
            <div className="card-body">
              {adminQueue.length === 0 ? (
                <div className="text-muted">No requests waiting for admin approval.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {adminQueue.map((request) => (
                    <div key={request.id} className="request-card">
                      <div className="request-card-head">
                        <div>
                          <div className="request-title">{request.employeeName} - {request.title}</div>
                          <div className="request-meta">{request.kind.replace("_", " ")} · {request.employeeEmail}</div>
                        </div>
                        <span className="badge badge-blue">Pending Admin</span>
                      </div>
                      <div className="request-body">{request.reason}</div>
                      {request.startDate ? (
                        <div className="request-date-row">
                          <span>{request.startDate}</span>
                          <span>{request.endDate || request.startDate}</span>
                        </div>
                      ) : null}
                      <div className="request-actions">
                        <button className="btn btn-primary btn-sm" onClick={() => handleDecision(request.id, "admin", "approve")}>Approve Request</button>
                        <button className="btn btn-outline btn-sm" onClick={() => handleDecision(request.id, "admin", "reject")}>Reject</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Recent Request Timeline</div>
          </div>
          <div className="card-body">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {requests.slice(0, 6).map((request) => (
                <div key={request.id} className="timeline-row">
                  <div className="timeline-dot" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{request.employeeName} · {request.title}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {request.kind.replace("_", " ")} · {request.status.replace("_", " ")} · {new Date(request.createdAt).toLocaleString("en-IN")}
                    </div>
                  </div>
                  <span className={`badge ${request.status === "approved" ? "badge-green" : request.status === "rejected" ? "badge-red" : request.status === "pending_admin" ? "badge-blue" : "badge-yellow"}`}>
                    {request.status.replace("_", " ")}
                  </span>
                </div>
              ))}
              {requests.length === 0 ? <div className="text-muted">No employee requests yet.</div> : null}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
