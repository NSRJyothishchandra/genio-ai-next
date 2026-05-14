"use client";
import { useEffect, useState, useRef } from "react";
import VoiceButton, { type VoiceAction } from "@/app/components/VoiceButton";

interface Employee {
  id: string;
  name: string;
  dob: string;
  email: string;
  position: string;
  gender: string;
}

interface BirthdayEmp extends Employee {
  daysUntil: number;
}

interface BirthdayConfig {
  notifyList: string[];
  sender: string;
  includeEmployeeEmail: boolean;
  recipientSettings?: {
    customTo: string[];
    customCc: string[];
    excludedCc: string[];
  };
  draftPreview?: {
    employeeId: string;
    name: string;
    subject: string;
    recipients: string[];
    cc?: string[];
    previewUrl: string;
    simulated: boolean;
  };
}

interface ScheduleConfig {
  enabled: boolean;
  hour: number;
  minute: number;
  lastSentDate: string;
  startOnDate?: string;
}

type CardTheme = "confetti" | "sunset" | "galaxy" | "garden" | "golden";

const THEMES: { id: CardTheme; label: string; gradient: string }[] = [
  { id: "confetti", label: "Confetti", gradient: "linear-gradient(135deg,#667eea,#764ba2)" },
  { id: "sunset", label: "Sunset", gradient: "linear-gradient(135deg,#f093fb,#f5576c,#fd7c2a)" },
  { id: "galaxy", label: "Galaxy", gradient: "linear-gradient(135deg,#0f0c29,#302b63,#24243e)" },
  { id: "garden", label: "Garden", gradient: "linear-gradient(135deg,#11998e,#38ef7d)" },
  { id: "golden", label: "Golden", gradient: "linear-gradient(135deg,#b8860b,#ffd700,#daa520)" },
];

function formatDate(dob: string) {
  const [, month, day] = dob.split("-");
  return new Date(`2000-${month}-${day}`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
  });
}

function EmailList({ emails }: { emails: string[] }) {
  if (!emails.length) return <span>None</span>;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        marginTop: 8,
        maxHeight: 160,
        overflowY: "auto",
      }}
    >
      {emails.map((email) => (
        <span
          key={email}
          style={{
            fontSize: 12,
            padding: "6px 10px",
            borderRadius: 999,
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
            wordBreak: "break-all",
          }}
        >
          {email}
        </span>
      ))}
    </div>
  );
}

export default function BirthdayPage() {
  const [today, setToday] = useState<Employee[]>([]);
  const [upcoming, setUpcoming] = useState<BirthdayEmp[]>([]);
  const [previewEmp, setPreviewEmp] = useState<Employee | null>(null);
  const [previewTheme, setPreviewTheme] = useState<CardTheme>("confetti");
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [config, setConfig] = useState<BirthdayConfig | null>(null);
  const [schedule, setSchedule] = useState<ScheduleConfig | null>(null);
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [recipientSaving, setRecipientSaving] = useState(false);
  const [customToInput, setCustomToInput] = useState("");
  const [customCcInput, setCustomCcInput] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  function loadData() {
    fetch("/api/birthday", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        setToday(data.today ?? []);
        setConfig({
          notifyList: data.notifyList ?? [],
          sender: data.sender ?? "",
          includeEmployeeEmail: data.includeEmployeeEmail ?? false,
          recipientSettings: data.recipientSettings,
          draftPreview: data.draftPreview,
        });
      });

    fetch(`/api/birthday?upcoming=${days}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setUpcoming(data.birthdays ?? []));

    fetch("/api/birthday/schedule", { cache: "no-store" })
      .then((r) => r.json())
      .then((s: ScheduleConfig) => {
        setSchedule(s);
        const hh = String(s.hour).padStart(2, "0");
        const mm = String(s.minute).padStart(2, "0");
        setScheduleTime(`${hh}:${mm}`);
      });
  }

  async function saveSchedule(enabled?: boolean) {
    setScheduleSaving(true);
    const [hh, mm] = scheduleTime.split(":").map(Number);
    const body: Partial<ScheduleConfig> = { hour: hh, minute: mm };
    if (typeof enabled === "boolean") body.enabled = enabled;
    const r = await fetch("/api/birthday/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const updated = await r.json();
    setSchedule(updated);
    setScheduleSaving(false);
    showToast(updated.enabled ? `Auto-send scheduled at ${scheduleTime} daily` : "Auto-send disabled");
  }

  useEffect(() => {
    loadData();
  }, [days]);

  async function sendWish(employee: Employee | BirthdayEmp) {
    setSending(employee.id);
    const response = await fetch("/api/birthday", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId: employee.id }),
    });
    const data = await response.json();
    setSent((previous) => new Set([...previous, employee.id]));
    setSending(null);
    showToast(`Birthday draft ${data.sent ? "processed" : "failed"} for ${employee.name}`);
  }

  async function sendAllToday() {
    setSending("all");
    const response = await fetch("/api/birthday", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sendAll: true }),
    });
    const data = await response.json();
    setSent((previous) => new Set([...previous, ...today.map((employee) => employee.id)]));
    setSending(null);
    showToast(`Processed ${data.sent} birthday emails for today`);
  }

  async function sendBirthdayTest() {
    setSending("test");
    const response = await fetch("/api/birthday", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ testMode: true }),
    });
    const data = await response.json();
    setSending(null);
    if (data.sent) {
      showToast(`Birthday test sent to ${(data.recipients ?? []).join(", ")}`);
    } else {
      showToast("Birthday test failed");
    }
  }

  async function triggerN8nWorkflow() {
    await fetch("/api/n8n/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow: "birthday_notification",
        payload: { today, upcoming, triggeredAt: new Date().toISOString() },
      }),
    });
    showToast("n8n birthday workflow triggered");
  }

  async function saveRecipients(next: {
    customTo?: string[];
    customCc?: string[];
    excludedCc?: string[];
  }) {
    setRecipientSaving(true);
    const response = await fetch("/api/birthday", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_recipients",
        customTo: next.customTo ?? config?.recipientSettings?.customTo ?? [],
        customCc: next.customCc ?? config?.recipientSettings?.customCc ?? [],
        excludedCc: next.excludedCc ?? config?.recipientSettings?.excludedCc ?? [],
      }),
    });
    const data = await response.json();
    setRecipientSaving(false);
    setConfig((previous) =>
      previous
        ? {
            ...previous,
            notifyList: data.notifyList ?? previous.notifyList,
            recipientSettings: data.recipientSettings ?? previous.recipientSettings,
            draftPreview: data.draftPreview ?? previous.draftPreview,
          }
        : previous
    );
    showToast("Birthday recipient list updated");
  }

  function addCustomEmail(kind: "to" | "cc") {
    const raw = kind === "to" ? customToInput : customCcInput;
    const email = raw.trim();
    if (!email) return;

    if (kind === "to") {
      const next = Array.from(new Set([...(config?.recipientSettings?.customTo ?? []), email]));
      void saveRecipients({ customTo: next });
      setCustomToInput("");
      return;
    }

    const next = Array.from(new Set([...(config?.recipientSettings?.customCc ?? []), email]));
    void saveRecipients({ customCc: next });
    setCustomCcInput("");
  }

  function removeCustomEmail(kind: "to" | "cc", email: string) {
    if (kind === "to") {
      void saveRecipients({
        customTo: (config?.recipientSettings?.customTo ?? []).filter((item) => item !== email),
      });
      return;
    }

    void saveRecipients({
      customCc: (config?.recipientSettings?.customCc ?? []).filter((item) => item !== email),
    });
  }

  function excludeCc(email: string) {
    const next = Array.from(new Set([...(config?.recipientSettings?.excludedCc ?? []), email]));
    void saveRecipients({ excludedCc: next });
  }

  function restoreCc(email: string) {
    void saveRecipients({
      excludedCc: (config?.recipientSettings?.excludedCc ?? []).filter((item) => item !== email),
    });
  }

  const draftPreviewName = previewEmp?.name ?? config?.draftPreview?.name ?? "Your Name";

  return (
    <>
      {toast ? (
        <div
          style={{
            position: "fixed", top: 20, right: 20, zIndex: 999,
            background: "var(--success)", color: "#fff",
            padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14,
            display: "flex", alignItems: "center", gap: 10,
          }}
        >
          {toast}
          <button
            onClick={() => { if (toastTimer.current) clearTimeout(toastTimer.current); setToast(null); }}
            style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}
          >✕</button>
        </div>
      ) : null}

      <div className="topbar">
        <div>
          <div className="topbar-title">Birthday Management</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Birthday card email drafts and SMTP test flow
          </div>
        </div>
        <div className="topbar-right">
          {today.length > 0 ? (
            <button onClick={sendAllToday} disabled={sending === "all"} className="btn btn-primary">
              {sending === "all" ? <><span className="spinner" />&nbsp;Sending...</> : "Send All Today's Wishes"}
            </button>
          ) : null}
          <button onClick={sendBirthdayTest} disabled={sending === "test"} className="btn btn-primary">
            {sending === "test" ? <><span className="spinner" />&nbsp;Testing...</> : "Send Birthday Test"}
          </button>
          <button onClick={triggerN8nWorkflow} className="btn btn-outline">
            Trigger n8n
          </button>
          <VoiceButton
            context="birthday"
            variant="inline"
            size="md"
            hint='Try: "Send birthday emails today" or "Set theme to galaxy" or "Enable auto send at 9 AM"'
            onResult={(_t, action: VoiceAction) => {
              const p = action.params as Record<string, unknown>;
              switch (action.action) {
                case "send_today":     sendAllToday(); break;
                case "send_test":      sendBirthdayTest(); break;
                case "trigger_n8n":    triggerN8nWorkflow(); break;
                case "set_theme":
                  setPreviewTheme((p.theme as CardTheme) || "confetti");
                  break;
                case "set_schedule_time": {
                  const h = String(Number(p.hour) || 9).padStart(2, "0");
                  const m = String(Number(p.minute) || 0).padStart(2, "0");
                  setScheduleTime(`${h}:${m}`);
                  break;
                }
                case "toggle_schedule":
                  if (schedule) setSchedule({ ...schedule, enabled: Boolean(p.enabled) });
                  break;
              }
            }}
          />
        </div>
      </div>

      <div className="page-content">
        <div className="card mb-4">
          <div className="card-header">
            <div className="card-title">Live Birthday Mail Setup</div>
          </div>
          <div className="card-body" style={{ display: "grid", gap: 10 }}>
            <div><strong>Sender:</strong> {config?.sender || "Not configured"}</div>
            <div><strong>Main receiver:</strong> Employee email from Employees list</div>
            <div>
              <strong>CC recipients:</strong>
              <EmailList emails={config?.notifyList ?? []} />
            </div>
            <div><strong>Employee delivery:</strong> Enabled</div>
            {config?.draftPreview ? (
              <div>
                <strong>Draft subject:</strong> {config.draftPreview.subject}
                <br />
                <strong>To:</strong> {config.draftPreview.recipients.join(", ")}
                <br />
                <strong>CC:</strong>
                <EmailList emails={config.draftPreview.cc ?? []} />
              </div>
            ) : null}
          </div>
        </div>

        <div className="card mb-4">
          <div className="card-header">
            <div>
              <div className="card-title">Recipient Editor</div>
              <div className="card-subtitle">Add extra To/CC mails or remove current CC mails without changing the main birthday flow</div>
            </div>
          </div>
          <div className="card-body" style={{ display: "grid", gap: 16 }}>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Employee birthday email remains the main receiver automatically. Use this editor only for additional `To`/`CC` mails and for excluding current CC mails.
            </div>

            <div className="grid-2" style={{ gap: 16 }}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontWeight: 700 }}>Extra To Recipients</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="form-input" placeholder="Add extra To email" value={customToInput} onChange={(event) => setCustomToInput(event.target.value)} />
                  <button className="btn btn-primary btn-sm" disabled={recipientSaving} onClick={() => addCustomEmail("to")}>Add</button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {(config?.recipientSettings?.customTo ?? []).map((email) => (
                    <button key={email} className="btn btn-outline btn-sm" onClick={() => removeCustomEmail("to", email)}>
                      Remove {email}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontWeight: 700 }}>Extra CC Recipients</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="form-input" placeholder="Add extra CC email" value={customCcInput} onChange={(event) => setCustomCcInput(event.target.value)} />
                  <button className="btn btn-primary btn-sm" disabled={recipientSaving} onClick={() => addCustomEmail("cc")}>Add</button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {(config?.recipientSettings?.customCc ?? []).map((email) => (
                    <button key={email} className="btn btn-outline btn-sm" onClick={() => removeCustomEmail("cc", email)}>
                      Remove {email}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 700 }}>Current CC Recipients</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {(config?.notifyList ?? []).map((email) => {
                  const isExcluded = (config?.recipientSettings?.excludedCc ?? []).includes(email);
                  return (
                    <button
                      key={email}
                      className={`btn btn-sm ${isExcluded ? "btn-primary" : "btn-outline"}`}
                      onClick={() => (isExcluded ? restoreCc(email) : excludeCc(email))}
                    >
                      {isExcluded ? `Restore ${email}` : `Exclude ${email}`}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <div className="section-title">Today's Birthdays</div>
          <div className="section-sub">
            {new Date().toLocaleDateString("en-IN", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </div>
          {today.length === 0 ? (
            <div className="card">
              <div className="card-body text-center" style={{ padding: 40 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>No birthdays today</div>
                <div style={{ fontWeight: 700 }}>Use the birthday test button to verify email sending</div>
                <div className="text-muted">That sends the draft to your real inboxes only.</div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {today.map((employee) => (
                <div
                  key={employee.id}
                  className="bday-card"
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}
                >
                  <div className="flex-center">
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: "50%",
                        background: "rgba(255,255,255,.2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 20,
                        fontWeight: 700,
                      }}
                    >
                      {employee.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 18 }}>{employee.name}</div>
                      <div style={{ opacity: 0.85, fontSize: 13 }}>{employee.position} | {employee.email}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => sendWish(employee)}
                    disabled={sending === employee.id || sent.has(employee.id)}
                    className="btn"
                    style={{ background: "#fff", color: "var(--primary)", fontWeight: 700 }}
                  >
                    {sent.has(employee.id) ? "Sent" : sending === employee.id ? "Sending..." : "Send Wish"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex-between mb-4">
            <div>
              <div className="section-title">Upcoming Birthdays</div>
              <div className="section-sub">{upcoming.length} birthdays in the next {days} days</div>
            </div>
            <div className="flex-center" style={{ gap: 8 }}>
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Show:</span>
              {[7, 14, 30, 60].map((value) => (
                <button
                  key={value}
                  onClick={() => setDays(value)}
                  className={`btn btn-sm ${days === value ? "btn-primary" : "btn-outline"}`}
                >
                  {value}d
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Position</th>
                    <th>Birthday</th>
                    <th>Days Until</th>
                    <th>Email</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                        No upcoming birthdays in {days} days
                      </td>
                    </tr>
                  ) : (
                    upcoming.map((employee) => (
                      <tr key={employee.id}>
                        <td>
                          <div className="flex-center">
                            <div className="avatar">
                              {employee.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}
                            </div>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 14 }}>{employee.name}</div>
                              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                {employee.gender} | {employee.id}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ fontSize: 13, color: "var(--text-muted)" }}>{employee.position}</td>
                        <td><div style={{ fontWeight: 600, fontSize: 14 }}>{formatDate(employee.dob)}</div></td>
                        <td>
                          <span
                            className={`badge ${
                              employee.daysUntil === 0
                                ? "badge-purple"
                                : employee.daysUntil <= 3
                                  ? "badge-red"
                                  : employee.daysUntil <= 7
                                    ? "badge-yellow"
                                    : "badge-gray"
                            }`}
                          >
                            {employee.daysUntil === 0 ? "Today" : `${employee.daysUntil} days`}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{employee.email}</td>
                        <td>
                          <button
                            onClick={() => sendWish(employee)}
                            disabled={sending === employee.id || sent.has(employee.id)}
                            className="btn btn-sm btn-outline"
                          >
                            {sent.has(employee.id) ? "Sent" : sending === employee.id ? "..." : "Wish"}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card mt-4 mb-4">
          <div className="card-header">
            <div className="card-title">Auto-Send Schedule</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Automatically send birthday emails every day at a set time
            </div>
          </div>
          <div className="card-body">
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
                  Send Time (24h)
                </label>
                <input
                  type="time"
                  className="form-input"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  style={{ width: 140, fontSize: 16, fontWeight: 700 }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Status</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span
                    className={`badge ${schedule?.enabled ? "badge-green" : "badge-gray"}`}
                    style={{ fontSize: 13 }}
                  >
                    {schedule?.enabled ? "Enabled" : "Disabled"}
                  </span>
                  {schedule?.lastSentDate && (
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Last sent: {schedule.lastSentDate}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 4, alignSelf: "flex-end" }}>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={scheduleSaving}
                  onClick={() => saveSchedule(true)}
                >
                  {scheduleSaving ? "Saving..." : "Save & Enable"}
                </button>
                {schedule?.enabled && (
                  <button
                    className="btn btn-outline btn-sm"
                    disabled={scheduleSaving}
                    onClick={() => saveSchedule(false)}
                  >
                    Disable
                  </button>
                )}
              </div>
            </div>
            {schedule?.enabled && (
              <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)", background: "var(--bg-secondary)", padding: "8px 12px", borderRadius: 8 }}>
                Birthday emails will be sent automatically at{" "}
                <strong>{String(schedule.hour).padStart(2, "0")}:{String(schedule.minute).padStart(2, "0")}</strong>{" "}
                every day while the server is running.
                {schedule.startOnDate ? (
                  <>
                    {" "}Next active day: <strong>{schedule.startOnDate}</strong>
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="card mt-4 mb-4">
          <div className="card-header">
            <div className="card-title">Birthday Card Designer</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Preview cards before sending and verify the exact birthday draft
            </div>
          </div>
          <div className="card-body">
            <div className="grid-2" style={{ gap: 20 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Select Theme:</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                  {THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      onClick={() => setPreviewTheme(theme.id)}
                      className={`btn btn-sm ${previewTheme === theme.id ? "" : "btn-outline"}`}
                      style={previewTheme === theme.id ? { background: theme.gradient, color: "#fff", border: "none" } : {}}
                    >
                      {theme.label}
                    </button>
                  ))}
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Preview for Employee:</div>
                <select
                  className="form-select mb-4"
                  onChange={(event) => {
                    const employee = [...today, ...upcoming].find((item) => item.id === event.target.value);
                    setPreviewEmp(employee ?? null);
                  }}
                >
                  <option value="">-- Select an employee --</option>
                  {[...today, ...upcoming]
                    .filter((emp, idx, arr) => arr.findIndex((e) => e.id === emp.id) === idx)
                    .map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name}
                      </option>
                    ))}
                </select>
                <a
                  href={`/api/birthday/card?name=${encodeURIComponent(draftPreviewName)}&theme=${previewTheme}${previewEmp ? `&id=${previewEmp.id}` : ""}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary w-full"
                  style={{ justifyContent: "center" }}
                >
                  Open Card Preview
                </a>
                {config?.draftPreview ? (
                  <div style={{ marginTop: 16, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7 }}>
                    <strong>Draft recipients:</strong> {config.draftPreview.recipients.join(", ")}
                    <br />
                    <strong>Draft CC:</strong>
                    <EmailList emails={config.draftPreview.cc ?? []} />
                    <br />
                    <strong>Mode:</strong> {config.draftPreview.simulated ? "Simulation until SMTP password is added" : "Live SMTP send"}
                  </div>
                ) : null}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Card Preview:</div>
                <iframe
                  src={`/api/birthday/card?name=${encodeURIComponent(draftPreviewName)}&theme=${previewTheme}${previewEmp ? `&id=${previewEmp.id}` : ""}`}
                  style={{ width: "100%", height: 520, border: "none", borderRadius: 12, boxShadow: "var(--shadow-md)" }}
                  title="Birthday Card Preview"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
