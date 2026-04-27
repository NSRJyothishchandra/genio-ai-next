"use client";
import { useState, useEffect } from "react";
import Link from "next/link";

interface OnboardingRecord {
  employeeId: string; name: string; email: string; position: string;
  dob: string; dateOfJoining: string; status: string; checklist: Record<string, boolean>;
  documents: string[]; photoUrl: string | null; createdAt: string; notes: string;
}

interface Employee { id: string; name: string; email: string; position: string; dob: string; gender: string; dateOfJoining: string; }

const checklistLabels: Record<string, string> = {
  photo: "📸 Professional Photo",
  aadhaar: "🪪 Aadhaar Card",
  pan: "💳 PAN Card",
  bankDetails: "🏦 Bank Account Details",
  offerLetterSigned: "📄 Signed Offer Letter",
  ndaSigned: "🔒 Signed NDA Agreement",
  backgroundVerification: "🔍 Background Verification",
  itSetup: "💻 IT Setup (Email, Laptop, Access)",
  welcomeEmailSent: "📧 Welcome Email Sent",
};

export default function OnboardingPage() {
  const [records, setRecords] = useState<OnboardingRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    employeeId: "",
    name: "",
    email: "",
    position: "",
    dob: "",
    gender: "Other",
    dateOfJoining: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState<"all" | "pending" | "in_progress" | "completed">("all");

  useEffect(() => {
    fetch("/api/onboarding").then((r) => r.json()).then((d) => { setRecords(d.records ?? []); setStats(d.stats ?? {}); });
    fetch("/api/employees").then((r) => r.json()).then((d) => setEmployees(d.employees ?? []));
  }, []);

  async function startOnboarding(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const emp = employees.find((e) => e.id === form.employeeId);
    const payload = {
      action: "start",
      ...form,
      name: form.name || emp?.name || "",
      email: form.email || emp?.email || "",
      position: form.position || emp?.position || "",
      dob: form.dob || emp?.dob || "",
      gender: form.gender || emp?.gender || "Other",
      dateOfJoining: form.dateOfJoining || emp?.dateOfJoining || "",
    };
    const res = await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json();
    setRecords((prev) => [...prev.filter((r) => r.employeeId !== data.record?.employeeId), data.record].filter(Boolean));
    setShowForm(false);
    setForm({ employeeId: "", name: "", email: "", position: "", dob: "", gender: "Other", dateOfJoining: "" });
    setSubmitting(false);
  }

  function selectEmployee(id: string) {
    const emp = employees.find((e) => e.id === id);
    if (emp) setForm((f) => ({
      ...f,
      employeeId: id,
      name: emp.name,
      email: emp.email,
      position: emp.position,
      dob: emp.dob,
      gender: emp.gender,
      dateOfJoining: emp.dateOfJoining,
    }));
    else setForm((f) => ({ ...f, employeeId: id }));
  }

  const filtered = records.filter((r) => tab === "all" || r.status === tab);

  function progress(record: OnboardingRecord) {
    const vals = Object.values(record.checklist);
    return Math.round((vals.filter(Boolean).length / vals.length) * 100);
  }

  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Onboarding</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Manage new employee journeys</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ Start Onboarding</button>
      </div>

      <div className="page-content">
        {/* Stats */}
        <div className="stat-grid mb-6">
          {[
            { label: "Total", value: stats.total ?? 0, icon: "📋", color: "var(--primary)" },
            { label: "Pending", value: stats.pending ?? 0, icon: "⏳", color: "var(--warning)" },
            { label: "In Progress", value: stats.inProgress ?? 0, icon: "🔄", color: "var(--info)" },
            { label: "Completed", value: stats.completed ?? 0, icon: "✅", color: "var(--success)" },
          ].map((s) => (
            <div key={s.label} className="stat-card">
              <div className="flex-between">
                <div className="stat-label">{s.label}</div>
                <span style={{ fontSize: 22 }}>{s.icon}</span>
              </div>
              <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* New Onboarding Form */}
        {showForm && (
          <div className="card mb-6">
            <div className="card-header">
              <div className="card-title">🚀 Start New Onboarding</div>
              <button className="btn btn-outline btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
            <div className="card-body">
              <div className="alert alert-info">📧 An onboarding welcome email will be sent automatically with document checklist.</div>
              <form onSubmit={startOnboarding}>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Select Existing Employee</label>
                    <select className="form-select" value={form.employeeId} onChange={(e) => selectEmployee(e.target.value)}>
                      <option value="">-- Pick from database --</option>
                      {employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.id})</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Or Enter Name</label>
                    <input className="form-input" placeholder="Full Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Email *</label>
                    <input className="form-input" type="email" placeholder="employee@company.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Position</label>
                    <input className="form-input" placeholder="e.g. Software Engineer" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Date of Birth *</label>
                    <input className="form-input" type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Gender</label>
                    <select className="form-select" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Date of Joining</label>
                    <input className="form-input" type="date" value={form.dateOfJoining} onChange={(e) => setForm({ ...form, dateOfJoining: e.target.value })} />
                  </div>
                </div>
                <button className="btn btn-primary" type="submit" disabled={submitting}>
                  {submitting ? <><span className="spinner" />&nbsp;Starting...</> : "🚀 Start Onboarding & Send Email"}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex-center mb-4" style={{ gap: 8 }}>
          {(["all", "pending", "in_progress", "completed"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`btn btn-sm ${tab === t ? "btn-primary" : "btn-outline"}`}>
              {t === "in_progress" ? "In Progress" : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Records */}
        {filtered.length === 0 ? (
          <div className="card">
            <div className="card-body text-center" style={{ padding: 48 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🚀</div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>No onboarding records</div>
              <div className="text-muted">Click "Start Onboarding" to begin a new employee journey</div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {filtered.map((rec) => {
              const pct = progress(rec);
              const done = Object.values(rec.checklist).filter(Boolean).length;
              const total = Object.values(rec.checklist).length;
              return (
                <div key={rec.employeeId} className="card">
                  <div className="card-header">
                    <div className="flex-center">
                      <div className="avatar">{rec.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}</div>
                      <div>
                        <div className="card-title">{rec.name}</div>
                        <div className="card-subtitle">{rec.position} · Started {new Date(rec.createdAt).toLocaleDateString("en-IN")}</div>
                      </div>
                    </div>
                    <div className="flex-center">
                      <span className={`badge ${rec.status === "completed" ? "badge-green" : rec.status === "in_progress" ? "badge-blue" : "badge-yellow"}`}>
                        {rec.status === "in_progress" ? "In Progress" : rec.status.charAt(0).toUpperCase() + rec.status.slice(1)}
                      </span>
                      <Link href={`/onboarding/${rec.employeeId}`} className="btn btn-outline btn-sm">Manage →</Link>
                    </div>
                  </div>
                  <div className="card-body">
                    <div className="flex-between mb-4" style={{ fontSize: 13 }}>
                      <span style={{ color: "var(--text-muted)" }}>{done}/{total} tasks completed</span>
                      <span style={{ fontWeight: 700, color: pct === 100 ? "var(--success)" : "var(--primary)" }}>{pct}%</span>
                    </div>
                    <div className="progress"><div className={`progress-bar${pct === 100 ? " success" : ""}`} style={{ width: `${pct}%` }} /></div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                      {Object.entries(rec.checklist).map(([key, done]) => (
                        <span key={key} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: done ? "var(--success-light)" : "var(--bg)", color: done ? "#15803d" : "var(--text-muted)", border: "1px solid", borderColor: done ? "#86efac" : "var(--border)" }}>
                          {done ? "✓" : "○"} {checklistLabels[key]?.replace(/^[^\s]+ /, "") ?? key}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
