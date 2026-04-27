"use client";
import { useEffect, useState } from "react";

interface TimesheetEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  taskNo: string;
  description: string;
  status: string;
  estimatedHours: number;
  actualHours: number;
  date: string;
  month: string;
  year: number;
  projectNo?: string;
}

interface ExcelSummary {
  employeeId: string;
  employeeName: string;
  totalEstimated: number;
  totalActual: number;
  entries: TimesheetEntry[];
}

interface AttendanceEvent {
  action: "check_in" | "lunch_start" | "lunch_end" | "check_out";
  timestamp: string;
  label: string;
}

interface AttendanceRecord {
  employeeId: string;
  employeeName: string;
  date: string;
  checkInAt: string | null;
  lunchStartAt: string | null;
  lunchEndAt: string | null;
  checkOutAt: string | null;
  officeHours: number;
  onTimeCheckIn: boolean | null;
  completedDay: boolean;
  status: "not_started" | "checked_in" | "at_lunch" | "checked_out";
  notifications: AttendanceEvent[];
}

interface AttendanceSummary {
  totalTracked: number;
  checkedIn: number;
  lateCheckIns: number;
  checkedOut: number;
  completedOfficeHours: number;
  requiredOfficeHours: number;
  latestCheckIn: string;
  lunchBreakHours: number;
}

interface EmployeeRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  kind: "leave" | "attendance_correction" | "other";
  leaveType?: "sick" | "casual" | "annual";
  title: string;
  reason: string;
  startDate: string | null;
  endDate: string | null;
  status: "pending_manager" | "pending_admin" | "approved" | "rejected";
  createdAt: string;
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

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const STATUS_OPTIONS = ["In Progress", "Completed", "On Hold", "Cancelled", "Review"];
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

function formatStamp(value: string | null) {
  if (!value) return "--";
  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function getStatusBadge(status: AttendanceRecord["status"]) {
  if (status === "checked_out") return "badge-green";
  if (status === "at_lunch") return "badge-yellow";
  if (status === "checked_in") return "badge-blue";
  return "badge-gray";
}

export default function TimesheetPage() {
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [attendanceSummary, setAttendanceSummary] = useState<AttendanceSummary | null>(null);
  const [excelData, setExcelData] = useState<ExcelSummary[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState<"attendance" | "leave" | "automation" | "new" | "excel">("attendance");
  const [leaveRequests, setLeaveRequests] = useState<EmployeeRequest[]>([]);
  const [automation, setAutomation] = useState<AutomationSnapshot | null>(null);
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [form, setForm] = useState({
    employeeId: "",
    employeeName: "",
    taskNo: "",
    description: "",
    status: "In Progress",
    estimatedHours: "",
    actualHours: "",
    date: new Date().toISOString().split("T")[0],
    month: MONTHS[new Date().getMonth()],
    year: new Date().getFullYear().toString(),
    projectNo: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [attendanceBusy, setAttendanceBusy] = useState<string | null>(null);
  const [demoGenerating, setDemoGenerating] = useState(false);
  const [runningAutomation, setRunningAutomation] = useState<string | null>(null);
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [filterEmp, setFilterEmp] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [leaveForm, setLeaveForm] = useState({
    employeeId: "",
    leaveType: "sick" as "sick" | "casual" | "annual",
    startDate: new Date().toISOString().split("T")[0],
    endDate: new Date().toISOString().split("T")[0],
    reason: "",
  });

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }

  async function loadData() {
    const [timesheetResponse, excelResponse, employeeResponse, requestResponse, automationResponse] = await Promise.all([
      fetch("/api/timesheet", { cache: "no-store" }),
      fetch("/api/timesheet?source=excel", { cache: "no-store" }),
      fetch("/api/employees", { cache: "no-store" }),
      fetch("/api/requests", { cache: "no-store" }),
      fetch("/api/automation", { cache: "no-store" }),
    ]);

    const timesheetData = await timesheetResponse.json();
    const excel = await excelResponse.json();
    const employeeData = await employeeResponse.json();
    const requestData = await requestResponse.json();
    const automationData = await automationResponse.json();

    setEntries(timesheetData.entries ?? []);
    setAttendance(timesheetData.attendance ?? []);
    setAttendanceSummary(timesheetData.attendanceSummary ?? null);
    setExcelData(excel.summaries ?? []);
    setEmployees((employeeData.employees ?? []).map((employee: { id: string; name: string }) => ({ id: employee.id, name: employee.name })));
    setLeaveRequests((requestData.requests ?? []).filter((request: EmployeeRequest) => request.kind === "leave"));
    setAutomation(automationData);
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (employees.length > 0 && attendance.length === 0 && !demoGenerating) {
      void generateDemoAttendance();
    }
  }, [employees, attendance]);

  async function submitEntry(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    const response = await fetch("/api/timesheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        estimatedHours: Number(form.estimatedHours),
        actualHours: Number(form.actualHours),
        year: Number(form.year),
      }),
    });
    const data = await response.json();
    setSubmitting(false);

    if (!response.ok) {
      showToast(data.error ?? "Failed to submit timesheet entry");
      return;
    }

    setEntries((previous) => [data.entry, ...previous]);
    setForm({
      employeeId: "",
      employeeName: "",
      taskNo: "",
      description: "",
      status: "In Progress",
      estimatedHours: "",
      actualHours: "",
      date: new Date().toISOString().split("T")[0],
      month: MONTHS[new Date().getMonth()],
      year: new Date().getFullYear().toString(),
      projectNo: "",
    });
    setShowForm(false);
    showToast("Timesheet entry submitted");
  }

  function selectEmployee(id: string) {
    const employee = employees.find((item) => item.id === id);
    setForm((previous) => ({ ...previous, employeeId: id, employeeName: employee?.name ?? "" }));
  }

  async function exportXlsx(employeeId: string, month: string) {
    const url = `/api/timesheet?employeeId=${employeeId}&month=${month}&export=1`;
    const response = await fetch(url);
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `timesheet-${employeeId}-${month}.xlsx`;
    link.click();
    showToast("Timesheet exported");
  }

  async function submitAttendance(employeeId: string, employeeName: string, action: AttendanceEvent["action"]) {
    setAttendanceBusy(`${employeeId}-${action}`);
    const response = await fetch("/api/timesheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, employeeId, employeeName }),
    });
    const data = await response.json();
    setAttendanceBusy(null);

    if (!response.ok) {
      showToast(data.error ?? "Failed to update attendance");
      return;
    }

    await loadData();
    showToast(data.attendance.notifications?.[0]?.label ?? "Attendance updated");
  }

  async function generateDemoAttendance() {
    setDemoGenerating(true);
    const response = await fetch("/api/timesheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "demo_generate" }),
    });
    const data = await response.json();
    setDemoGenerating(false);

    if (!response.ok) {
      showToast(data.error ?? "Failed to generate demo attendance");
      return;
    }

    setAttendance(data.attendance ?? []);
    setAttendanceSummary(data.attendanceSummary ?? null);
    showToast("Demo attendance generated for all employees");
  }

  async function submitLeaveRequest(event: React.FormEvent) {
    event.preventDefault();
    setLeaveSubmitting(true);
    const response = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        employeeId: leaveForm.employeeId,
        kind: "leave",
        leaveType: leaveForm.leaveType,
        title: `${leaveForm.leaveType === "sick" ? "Sick" : leaveForm.leaveType === "casual" ? "Casual" : "Annual"} Leave Request`,
        startDate: leaveForm.startDate,
        endDate: leaveForm.endDate,
        reason: leaveForm.reason,
      }),
    });
    const data = await response.json();
    setLeaveSubmitting(false);

    if (!response.ok) {
      showToast(data.error ?? "Failed to submit leave request");
      return;
    }

    setLeaveForm({
      employeeId: "",
      leaveType: "sick",
      startDate: new Date().toISOString().split("T")[0],
      endDate: new Date().toISOString().split("T")[0],
      reason: "",
    });
    await loadData();
    showToast(
      data.request.status === "approved"
        ? "Sick leave accepted automatically"
        : "Leave request submitted and awaiting approval"
    );
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

    setAutomation(data.snapshot ?? null);
    showToast(`${title} completed`);
  }

  function getLeaveBar(request: EmployeeRequest) {
    if (request.status === "approved") {
      return { label: "Accepted", color: "#22c55e", width: "100%" };
    }
    if (request.status === "rejected") {
      return { label: "Declined", color: "#ef4444", width: "100%" };
    }
    return { label: "Awaiting", color: "#f59e0b", width: request.status === "pending_admin" ? "70%" : "40%" };
  }

  const filteredEntries = entries.filter((entry) => !filterEmp || entry.employeeId === filterEmp);
  const totalHours = filteredEntries.reduce((sum, entry) => sum + entry.actualHours, 0);
  const attendanceMap = new Map(attendance.map((record) => [record.employeeId, record]));

  return (
    <>
      {toast ? (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 999, background: "var(--success)", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14 }}>
          {toast}
        </div>
      ) : null}

      <div className="topbar">
        <div>
          <div className="topbar-title">Timesheets & Attendance</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Check-in before 11:30 AM, 1 hour lunch included, total office hours required: 9.5
          </div>
        </div>
        <div className="topbar-right">
          <button className="btn btn-outline" onClick={generateDemoAttendance} disabled={demoGenerating}>
            {demoGenerating ? "Generating Demo..." : "Run Demo Auto Attendance"}
          </button>
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>+ Log Hours</button>
        </div>
      </div>

      <div className="page-content">
        <div className="stat-grid mb-6">
          <div className="stat-card">
            <div className="stat-label">Checked In Today</div>
            <div className="stat-value">{attendanceSummary?.checkedIn ?? 0}</div>
            <div className="stat-sub">Employees who started the day</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Late Check-Ins</div>
            <div className="stat-value">{attendanceSummary?.lateCheckIns ?? 0}</div>
            <div className="stat-sub">After {attendanceSummary?.latestCheckIn ?? "11:30"} AM</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Checked Out</div>
            <div className="stat-value">{attendanceSummary?.checkedOut ?? 0}</div>
            <div className="stat-sub">Day closed for attendance</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Completed 9.5 Hours</div>
            <div className="stat-value">{attendanceSummary?.completedOfficeHours ?? 0}</div>
            <div className="stat-sub">Lunch is included in office hours</div>
          </div>
        </div>

        <div className="flex-center mb-6" style={{ gap: 8 }}>
          <button className={`btn btn-sm ${tab === "attendance" ? "btn-primary" : "btn-outline"}`} onClick={() => setTab("attendance")}>Attendance Automation</button>
          <button className={`btn btn-sm ${tab === "leave" ? "btn-primary" : "btn-outline"}`} onClick={() => setTab("leave")}>Leave Request</button>
          <button className={`btn btn-sm ${tab === "automation" ? "btn-primary" : "btn-outline"}`} onClick={() => setTab("automation")}>Bonfiglioli Automation</button>
          <button className={`btn btn-sm ${tab === "new" ? "btn-primary" : "btn-outline"}`} onClick={() => setTab("new")}>Submitted Entries</button>
          <button className={`btn btn-sm ${tab === "excel" ? "btn-primary" : "btn-outline"}`} onClick={() => setTab("excel")}>Excel Import</button>
        </div>

        {tab === "attendance" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {employees.length === 0 ? (
              <div className="card">
                <div className="card-body text-center" style={{ padding: 40, color: "var(--text-muted)" }}>
                  Add employees first to start attendance tracking.
                </div>
              </div>
            ) : (
              employees.map((employee) => {
                const record = attendanceMap.get(employee.id);
                return (
                  <div key={employee.id} className="card">
                    <div className="card-header">
                      <div>
                        <div className="card-title">{employee.name}</div>
                        <div className="card-subtitle">{employee.id}</div>
                      </div>
                      <span className={`badge ${getStatusBadge(record?.status ?? "not_started")}`}>
                        {record?.status?.replace("_", " ") ?? "not started"}
                      </span>
                    </div>
                    <div className="card-body" style={{ display: "grid", gap: 14 }}>
                      <div className="grid-2" style={{ gap: 14 }}>
                        <div style={{ display: "grid", gap: 8 }}>
                          <div><strong>Check In:</strong> {formatStamp(record?.checkInAt ?? null)}</div>
                          <div><strong>Lunch Start:</strong> {formatStamp(record?.lunchStartAt ?? null)}</div>
                          <div><strong>Lunch End:</strong> {formatStamp(record?.lunchEndAt ?? null)}</div>
                          <div><strong>Check Out:</strong> {formatStamp(record?.checkOutAt ?? null)}</div>
                        </div>
                        <div style={{ display: "grid", gap: 8 }}>
                          <div><strong>Office Hours:</strong> {record?.officeHours ?? 0}h / {attendanceSummary?.requiredOfficeHours ?? 9.5}h</div>
                          <div><strong>Check-In Status:</strong> {record?.onTimeCheckIn == null ? "Pending" : record.onTimeCheckIn ? "On time" : "Late after 11:30 AM"}</div>
                          <div><strong>Lunch Rule:</strong> 1 hour break included in office hours</div>
                          <div><strong>Day Status:</strong> {record?.completedDay ? "Completed" : "In progress"}</div>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button className="btn btn-primary btn-sm" disabled={attendanceBusy === `${employee.id}-check_in` || Boolean(record?.checkInAt)} onClick={() => submitAttendance(employee.id, employee.name, "check_in")}>
                          {attendanceBusy === `${employee.id}-check_in` ? "Saving..." : "Check In"}
                        </button>
                        <button className="btn btn-outline btn-sm" disabled={attendanceBusy === `${employee.id}-lunch_start` || !record?.checkInAt || Boolean(record?.lunchStartAt) || Boolean(record?.checkOutAt)} onClick={() => submitAttendance(employee.id, employee.name, "lunch_start")}>
                          {attendanceBusy === `${employee.id}-lunch_start` ? "Saving..." : "Start Lunch"}
                        </button>
                        <button className="btn btn-outline btn-sm" disabled={attendanceBusy === `${employee.id}-lunch_end` || !record?.lunchStartAt || Boolean(record?.lunchEndAt) || Boolean(record?.checkOutAt)} onClick={() => submitAttendance(employee.id, employee.name, "lunch_end")}>
                          {attendanceBusy === `${employee.id}-lunch_end` ? "Saving..." : "End Lunch"}
                        </button>
                        <button className="btn btn-primary btn-sm" disabled={attendanceBusy === `${employee.id}-check_out` || !record?.checkInAt || Boolean(record?.checkOutAt) || Boolean(record?.lunchStartAt && !record?.lunchEndAt)} onClick={() => submitAttendance(employee.id, employee.name, "check_out")}>
                          {attendanceBusy === `${employee.id}-check_out` ? "Saving..." : "Check Out"}
                        </button>
                      </div>

                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Notifications</div>
                        {record?.notifications?.length ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {record.notifications.map((notification, index) => (
                              <div key={`${notification.timestamp}-${index}`} style={{ padding: "10px 12px", borderRadius: 10, background: "var(--bg-secondary)", fontSize: 13 }}>
                                {notification.label}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No attendance notifications yet.</div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : null}

        {tab === "leave" ? (
          <div className="grid-2">
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Apply Leave</div>
                  <div className="card-subtitle">Sick leave is accepted by default</div>
                </div>
              </div>
              <div className="card-body">
                <form onSubmit={submitLeaveRequest}>
                  <div className="form-group">
                    <label className="form-label">Employee</label>
                    <select className="form-select" value={leaveForm.employeeId} onChange={(event) => setLeaveForm((previous) => ({ ...previous, employeeId: event.target.value }))} required>
                      <option value="">Select employee...</option>
                      {employees.map((employee) => (
                        <option key={employee.id} value={employee.id}>{employee.name} ({employee.id})</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Leave Type</label>
                    <select className="form-select" value={leaveForm.leaveType} onChange={(event) => setLeaveForm((previous) => ({ ...previous, leaveType: event.target.value as "sick" | "casual" | "annual" }))}>
                      <option value="sick">Sick Leave</option>
                      <option value="casual">Casual Leave</option>
                      <option value="annual">Annual Leave</option>
                    </select>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Start Date</label>
                      <input className="form-input" type="date" value={leaveForm.startDate} onChange={(event) => setLeaveForm((previous) => ({ ...previous, startDate: event.target.value }))} required />
                    </div>
                    <div className="form-group">
                      <label className="form-label">End Date</label>
                      <input className="form-input" type="date" value={leaveForm.endDate} onChange={(event) => setLeaveForm((previous) => ({ ...previous, endDate: event.target.value }))} required />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Reason</label>
                    <textarea className="form-textarea" value={leaveForm.reason} onChange={(event) => setLeaveForm((previous) => ({ ...previous, reason: event.target.value }))} required />
                  </div>
                  <button className="btn btn-primary" type="submit" disabled={leaveSubmitting}>
                    {leaveSubmitting ? "Submitting..." : "Submit Leave Request"}
                  </button>
                </form>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Leave Status</div>
                  <div className="card-subtitle">Accepted, awaiting, or declined</div>
                </div>
              </div>
              <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {leaveRequests.length === 0 ? (
                  <div className="text-muted">No leave requests yet.</div>
                ) : (
                  leaveRequests.slice(0, 8).map((request) => {
                    const bar = getLeaveBar(request);
                    return (
                      <div key={request.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
                        <div className="flex-between" style={{ marginBottom: 8 }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{request.employeeName}</div>
                            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                              {(request.leaveType ?? "leave").replace("_", " ")} · {request.startDate} to {request.endDate}
                            </div>
                          </div>
                          <span className={`badge ${request.status === "approved" ? "badge-green" : request.status === "rejected" ? "badge-red" : "badge-yellow"}`}>
                            {bar.label}
                          </span>
                        </div>
                        <div style={{ height: 10, background: "var(--bg-secondary)", borderRadius: 999, overflow: "hidden", marginBottom: 8 }}>
                          <div style={{ height: "100%", width: bar.width, background: bar.color, borderRadius: 999 }} />
                        </div>
                        <div style={{ fontSize: 13, color: "var(--text)" }}>{request.reason}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        ) : null}

        {tab === "automation" ? (
          <div style={{ display: "grid", gap: 18 }}>
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Bonfiglioli Automation Center</div>
                  <div className="card-subtitle">Run the full HR and people-ops automations from one place</div>
                </div>
              </div>
              <div className="card-body">
                <div className="grid-2" style={{ gap: 14 }}>
                  {AUTOMATION_ACTIONS.map((item) => {
                    const card = automation?.cards[item.cardKey as keyof AutomationSnapshot["cards"]];
                    return (
                      <div key={item.key} style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 16, display: "grid", gap: 12 }}>
                        <div className="flex-between" style={{ alignItems: "flex-start" }}>
                          <div>
                            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>{item.title}</div>
                            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{card?.summary ?? "Loading..."}</div>
                          </div>
                          <span className={`badge ${card?.status === "attention" ? "badge-yellow" : "badge-green"}`}>
                            {card?.count ?? 0}
                          </span>
                        </div>
                        <div style={{ display: "grid", gap: 8 }}>
                          {(card?.details ?? ["Waiting for automation data..."]).slice(0, 3).map((detail) => (
                            <div key={detail} style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: "10px 12px", fontSize: 13 }}>
                              {detail}
                            </div>
                          ))}
                        </div>
                        <button className="btn btn-primary btn-sm" onClick={() => runAutomation(item.key, item.title)} disabled={runningAutomation === item.key}>
                          {runningAutomation === item.key ? "Running..." : "Run Automation"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Recent Automation Log</div>
                  <div className="card-subtitle">Latest HR automation runs and outcomes</div>
                </div>
              </div>
              <div className="card-body" style={{ display: "grid", gap: 12 }}>
                {automation?.logs?.length ? (
                  automation.logs.map((log) => (
                    <div key={log.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
                      <div className="flex-between" style={{ marginBottom: 8 }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{log.title}</div>
                          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                            {new Date(log.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                          </div>
                        </div>
                        <span className={`badge ${log.status === "attention" ? "badge-yellow" : "badge-green"}`}>
                          {log.status}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, marginBottom: 10 }}>{log.summary}</div>
                      <div style={{ display: "grid", gap: 8 }}>
                        {log.details.slice(0, 3).map((detail) => (
                          <div key={detail} style={{ background: "var(--bg-secondary)", borderRadius: 10, padding: "10px 12px", fontSize: 13 }}>
                            {detail}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-muted">No automation runs yet.</div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {showForm ? (
          <div className="card mb-6">
            <div className="card-header">
              <div className="card-title">Log Timesheet Entry</div>
              <button className="btn btn-outline btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
            <div className="card-body">
              <form onSubmit={submitEntry}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Employee *</label>
                    <select className="form-select" value={form.employeeId} onChange={(event) => selectEmployee(event.target.value)} required>
                      <option value="">Select employee...</option>
                      {employees.map((employee) => (
                        <option key={employee.id} value={employee.id}>{employee.name} ({employee.id})</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Task No / Project No</label>
                    <input className="form-input" placeholder="e.g. PRJ_202601" value={form.taskNo} onChange={(event) => setForm({ ...form, taskNo: event.target.value })} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Description *</label>
                  <textarea className="form-textarea" placeholder="What did you work on?" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} required />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Status</label>
                    <select className="form-select" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                      {STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Date</label>
                    <input className="form-input" type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Estimated Hours</label>
                    <input className="form-input" type="number" min="0" step="0.5" placeholder="0" value={form.estimatedHours} onChange={(event) => setForm({ ...form, estimatedHours: event.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Actual Hours *</label>
                    <input className="form-input" type="number" min="0" step="0.5" placeholder="0" value={form.actualHours} onChange={(event) => setForm({ ...form, actualHours: event.target.value })} required />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Month</label>
                    <select className="form-select" value={form.month} onChange={(event) => setForm({ ...form, month: event.target.value })}>
                      {MONTHS.map((month) => <option key={month}>{month}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Year</label>
                    <input className="form-input" value={form.year} onChange={(event) => setForm({ ...form, year: event.target.value })} />
                  </div>
                </div>
                <button className="btn btn-primary" type="submit" disabled={submitting}>
                  {submitting ? "Saving..." : "Submit Timesheet"}
                </button>
              </form>
            </div>
          </div>
        ) : null}

        {tab === "new" ? (
          <>
            <div className="flex-between mb-4">
              <div className="flex-center">
                <select className="form-select" style={{ maxWidth: 200 }} value={filterEmp} onChange={(event) => setFilterEmp(event.target.value)}>
                  <option value="">All Employees</option>
                  {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
                </select>
              </div>
              <div className="flex-center">
                <span className="badge badge-blue">{filteredEntries.length} entries</span>
                <span className="badge badge-purple">{totalHours}h total</span>
                {filterEmp ? <button className="btn btn-outline btn-sm" onClick={() => exportXlsx(filterEmp, MONTHS[new Date().getMonth()])}>Export Excel</button> : null}
              </div>
            </div>

            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Task</th>
                      <th>Description</th>
                      <th>Status</th>
                      <th>Est. Hrs</th>
                      <th>Actual Hrs</th>
                      <th>Date</th>
                      <th>Month</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntries.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                          No entries yet. Click "+ Log Hours" to add.
                        </td>
                      </tr>
                    ) : (
                      filteredEntries.map((entry) => (
                        <tr key={entry.id}>
                          <td><div style={{ fontWeight: 600, fontSize: 13 }}>{entry.employeeName}</div><div style={{ fontSize: 11, color: "var(--text-muted)" }}>{entry.employeeId}</div></td>
                          <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{entry.taskNo}</td>
                          <td style={{ maxWidth: 200, fontSize: 13 }}>{entry.description.slice(0, 80)}{entry.description.length > 80 ? "..." : ""}</td>
                          <td><span className={`badge ${entry.status === "Completed" ? "badge-green" : entry.status === "In Progress" ? "badge-blue" : "badge-yellow"}`}>{entry.status}</span></td>
                          <td style={{ textAlign: "center" }}>{entry.estimatedHours}</td>
                          <td style={{ textAlign: "center", fontWeight: 700 }}>{entry.actualHours}</td>
                          <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{entry.date}</td>
                          <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{entry.month}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}

        {tab === "excel" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {excelData.length === 0 ? (
              <div className="card">
                <div className="card-body text-center" style={{ padding: 48 }}>
                  <div style={{ fontWeight: 700 }}>No Excel data loaded</div>
                  <div className="text-muted mt-4">Place the project tracker Excel file in the data folder</div>
                </div>
              </div>
            ) : (
              excelData.map((summary) => (
                <div key={summary.employeeId} className="card">
                  <div className="card-header">
                    <div>
                      <div className="card-title">{summary.employeeName}</div>
                      <div className="card-subtitle">
                        Est: {summary.totalEstimated}h · Actual: {summary.totalActual}h · Efficiency: {summary.totalEstimated > 0 ? Math.round((summary.totalActual / summary.totalEstimated) * 100) : 0}%
                      </div>
                    </div>
                    <button className="btn btn-outline btn-sm" onClick={() => exportXlsx(summary.employeeId, "All")}>Export</button>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Task No</th>
                          <th>Description</th>
                          <th>Status</th>
                          <th>Est. Hrs</th>
                          <th>Actual Hrs</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.entries.slice(0, 10).map((entry) => (
                          <tr key={entry.id}>
                            <td style={{ fontSize: 12, fontFamily: "monospace" }}>{entry.taskNo}</td>
                            <td style={{ maxWidth: 300, fontSize: 13 }}>{entry.description.slice(0, 80)}</td>
                            <td><span className={`badge ${entry.status === "COMPLETED" ? "badge-green" : entry.status === "WIP" ? "badge-blue" : "badge-gray"}`}>{entry.status}</span></td>
                            <td style={{ textAlign: "center" }}>{entry.estimatedHours}</td>
                            <td style={{ textAlign: "center", fontWeight: 700 }}>{entry.actualHours}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}
