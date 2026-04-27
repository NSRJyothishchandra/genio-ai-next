"use client";
import { useState, useEffect } from "react";

interface Workflow {
  id: string;
  file: string;
  label: string;
  desc: string;
  icon: string;
  tags: string[];
  nodeCount: number;
  downloadUrl: string;
}
interface WebhookTest { status: "idle" | "testing" | "success" | "error"; response?: string; }
interface ImportState { status: "idle" | "importing" | "success" | "error"; message?: string; n8nUrl?: string; }

const TRIGGER_WORKFLOWS = [
  { id: "birthday_notification", label: "🎂 Birthday Notification", desc: "Triggered every morning, sends birthday emails" },
  { id: "onboarding_started", label: "🚀 Onboarding Started", desc: "Fires when a new employee onboarding begins" },
  { id: "timesheet_submitted", label: "⏰ Timesheet Submitted", desc: "Fires when an employee submits timesheet hours" },
  { id: "document_requested", label: "📄 Document Request", desc: "Sends document request emails via n8n" },
  { id: "employee_added", label: "👤 Employee Added", desc: "Fires when a new employee is added to the system" },
];

export default function IntegrationsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [tests, setTests] = useState<Record<string, WebhookTest>>({});
  const [imports, setImports] = useState<Record<string, ImportState>>({});
  const [n8nUrl, setN8nUrl] = useState("http://localhost:5678");
  const [n8nApiKey, setN8nApiKey] = useState("");
  const [n8nStatus, setN8nStatus] = useState<"unknown" | "online" | "offline">("unknown");
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [activeTab, setActiveTab] = useState<"workflows" | "setup" | "test" | "env">("workflows");

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  useEffect(() => {
    fetch("/api/n8n/workflows").then(r => r.json()).then(d => setWorkflows(d.workflows ?? [])).catch(() => null);
  }, []);

  async function checkN8nStatus() {
    setN8nStatus("unknown");
    try {
      const res = await fetch(`${n8nUrl}/api/v1/workflows`, {
        headers: { "X-N8N-API-KEY": n8nApiKey },
        signal: AbortSignal.timeout(4000),
      });
      setN8nStatus(res.ok ? "online" : "offline");
    } catch {
      setN8nStatus("offline");
    }
  }

  async function downloadWorkflow(wf: Workflow) {
    const a = document.createElement("a");
    a.href = wf.downloadUrl;
    a.download = wf.file;
    a.click();
    showToast(`⬇️ ${wf.label} downloaded!`);
  }

  async function importWorkflow(wf: Workflow) {
    if (!n8nApiKey) { showToast("Enter your n8n API key first", "error"); return; }
    setImports(p => ({ ...p, [wf.id]: { status: "importing" } }));
    try {
      const res = await fetch("/api/n8n/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId: wf.id, n8nUrl, n8nApiKey }),
      });
      const data = await res.json();
      if (data.success) {
        setImports(p => ({ ...p, [wf.id]: { status: "success", message: "Imported!", n8nUrl: data.n8nUrl } }));
        showToast(`✅ ${wf.label} imported to n8n!`);
      } else {
        setImports(p => ({ ...p, [wf.id]: { status: "error", message: data.error } }));
        showToast(data.error ?? "Import failed", "error");
      }
    } catch (err) {
      setImports(p => ({ ...p, [wf.id]: { status: "error", message: String(err) } }));
      showToast(String(err), "error");
    }
  }

  async function testWorkflow(id: string) {
    setTests(t => ({ ...t, [id]: { status: "testing" } }));
    const res = await fetch("/api/n8n/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow: id, payload: { test: true, triggeredAt: new Date().toISOString() } }),
    });
    const data = await res.json();
    setTests(t => ({ ...t, [id]: { status: res.ok ? "success" : "error", response: JSON.stringify(data, null, 2) } }));
    showToast(data.simulated ? "✅ Simulated — add webhook URL to .env.local for real n8n" : "✅ Triggered real n8n workflow!");
  }

  const envConfig = `# Projecta HR — .env.local
# ===================== n8n =====================
N8N_BIRTHDAY_WEBHOOK=http://localhost:5678/webhook/projecta-birthday
N8N_ONBOARDING_WEBHOOK=http://localhost:5678/webhook/projecta-onboarding
N8N_TIMESHEET_WEBHOOK=http://localhost:5678/webhook/projecta-timesheet-submitted
N8N_DOCUMENT_WEBHOOK=http://localhost:5678/webhook/projecta-document-request
N8N_EMPLOYEE_WEBHOOK=http://localhost:5678/webhook/projecta-employee-added
N8N_WEBHOOK_SECRET=projecta-secret-2024

# ================ Anthropic AI ================
ANTHROPIC_API_KEY=sk-ant-...

# =================== SMTP =====================
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your_app_password

# ================= App URL ====================
NEXT_PUBLIC_APP_URL=http://localhost:3001`;

  const TABS = [
    { id: "workflows" as const, label: "⚡ n8n AI Workflows" },
    { id: "setup" as const, label: "🛠️ Setup Guide" },
    { id: "test" as const, label: "🧪 Test & Trigger" },
    { id: "env" as const, label: "🔧 Env Config" },
  ];

  return (
    <>
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 999,
          background: toast.type === "error" ? "#ef4444" : "#22c55e",
          color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14,
          boxShadow: "0 4px 20px rgba(0,0,0,.25)", maxWidth: 420,
        }}>{toast.msg}</div>
      )}

      <div className="topbar">
        <div>
          <div className="topbar-title">🔗 n8n + AI Integrations</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>5 ready-to-import AI workflows · Claude Sonnet/Haiku · Auto email · HR automation</div>
        </div>
        <div className="topbar-right">
          <span className={`badge ${n8nStatus === "online" ? "badge-green" : n8nStatus === "offline" ? "badge-red" : "badge-gray"}`}>
            n8n {n8nStatus === "online" ? "✓ Online" : n8nStatus === "offline" ? "✗ Offline" : "? Unknown"}
          </span>
          <button onClick={checkN8nStatus} className="btn btn-outline btn-sm">🔍 Check n8n</button>
        </div>
      </div>

      <div className="page-content">
        {/* Architecture */}
        <div className="card mb-4">
          <div className="card-body" style={{ padding: "14px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
              {[
                { icon: "📊", label: "Excel Data", sub: "50 Employees" },
                { icon: "→" },
                { icon: "🌐", label: "Projecta HR", sub: "localhost:3001" },
                { icon: "⇄" },
                { icon: "⚡", label: "n8n Engine", sub: "localhost:5678" },
                { icon: "→" },
                { icon: "🤖", label: "Claude AI", sub: "Sonnet / Haiku" },
                { icon: "→" },
                { icon: "📧", label: "Auto Email", sub: "SMTP / Gmail" },
              ].map((item, i) => (
                "label" in item ? (
                  <div key={i} style={{ textAlign: "center", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 14px", minWidth: 90 }}>
                    <div style={{ fontSize: 20 }}>{item.icon}</div>
                    <div style={{ fontWeight: 700, fontSize: 11 }}>{item.label}</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{item.sub}</div>
                  </div>
                ) : <div key={i} style={{ fontSize: 18, color: "var(--text-muted)", fontWeight: 700 }}>{item.icon}</div>
              ))}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "2px solid var(--border)" }}>
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`btn btn-sm ${activeTab === tab.id ? "btn-primary" : "btn-outline"}`}
              style={{ borderRadius: "8px 8px 0 0", borderBottom: activeTab === tab.id ? "2px solid var(--primary)" : "none", marginBottom: -2 }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* WORKFLOWS TAB */}
        {activeTab === "workflows" && (
          <>
            <div className="card mb-4">
              <div className="card-body" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "14px 20px" }}>
                <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>🔗 n8n:</span>
                <input className="form-input" style={{ maxWidth: 240, fontSize: 13 }} placeholder="http://localhost:5678" value={n8nUrl} onChange={e => setN8nUrl(e.target.value)} />
                <input className="form-input" style={{ maxWidth: 280, fontSize: 13 }} placeholder="n8n API Key (Settings → API → Create)" type="password" value={n8nApiKey} onChange={e => setN8nApiKey(e.target.value)} />
                <button onClick={checkN8nStatus} className="btn btn-outline btn-sm">🔍 Test</button>
                <span className={`badge ${n8nStatus === "online" ? "badge-green" : n8nStatus === "offline" ? "badge-red" : "badge-gray"}`}>
                  {n8nStatus === "online" ? "✓ Connected" : n8nStatus === "offline" ? "✗ Unreachable" : "? Not tested"}
                </span>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
              {workflows.map(wf => {
                const imp = imports[wf.id];
                return (
                  <div key={wf.id} className="card" style={{ border: imp?.status === "success" ? "2px solid var(--success)" : undefined }}>
                    <div className="card-body" style={{ padding: 18 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                        <span style={{ fontSize: 28 }}>{wf.icon}</span>
                        <div style={{ display: "flex", gap: 3, flexWrap: "wrap", justifyContent: "flex-end" }}>
                          {wf.tags.map(tag => <span key={tag} className="badge badge-gray" style={{ fontSize: 10 }}>{tag}</span>)}
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 5 }}>{wf.label}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>{wf.desc}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 14 }}>📦 {wf.nodeCount} nodes</div>

                      {imp?.status === "success" && (
                        <div style={{ background: "#22c55e", color: "#fff", padding: "7px 10px", borderRadius: 8, marginBottom: 10, fontSize: 12 }}>
                          ✅ Imported! {imp.n8nUrl && <a href={imp.n8nUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#fff", textDecoration: "underline" }}>Open in n8n →</a>}
                        </div>
                      )}
                      {imp?.status === "error" && (
                        <div style={{ background: "#fef2f2", color: "#991b1b", padding: "7px 10px", borderRadius: 8, marginBottom: 10, fontSize: 11, border: "1px solid #fca5a5" }}>❌ {imp.message}</div>
                      )}

                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => downloadWorkflow(wf)} className="btn btn-outline btn-sm" style={{ flex: 1, justifyContent: "center" }}>⬇️ Download</button>
                        <button onClick={() => importWorkflow(wf)} disabled={imp?.status === "importing" || !n8nApiKey} className="btn btn-primary btn-sm" style={{ flex: 1, justifyContent: "center" }} title={n8nApiKey ? "Auto-import via n8n API" : "Enter API key above"}>
                          {imp?.status === "importing" ? <><span className="spinner" />&nbsp;Importing...</> : "⚡ Auto Import"}
                        </button>
                      </div>
                      {!n8nApiKey && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 5, textAlign: "center" }}>Enter API key above to auto-import</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* SETUP TAB */}
        {activeTab === "setup" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {([
              {
                n: 1, icon: "🚀", title: "Start n8n",
                body: <>
                  {[{ l: "npx (quick)", c: "npx n8n start" }, { l: "Docker", c: "docker run -it --rm -p 5678:5678 -v ~/.n8n:/home/node/.n8n n8nio/n8n" }, { l: "Global", c: "npm install -g n8n && n8n start" }].map(x => (
                    <div key={x.l} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3 }}>{x.l}:</div>
                      <code style={{ display: "block", background: "#0f172a", color: "#4ade80", padding: "7px 12px", borderRadius: 8, fontSize: 12, fontFamily: "monospace" }}>{x.c}</code>
                    </div>
                  ))}
                  <div style={{ marginTop: 6, fontSize: 13 }}>Then open: <a href="http://localhost:5678" target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)" }}>http://localhost:5678</a></div>
                </>,
              },
              { n: 2, icon: "🔑", title: "Get n8n API Key (for Auto Import)", body: <ol style={{ paddingLeft: 18, margin: 0, fontSize: 13, lineHeight: 1.9 }}><li>n8n → user icon → <strong>Settings → API → Create an API Key</strong></li><li>Paste it in the connection bar on the Workflows tab</li><li>Click <strong>⚡ Auto Import</strong> on each workflow card</li></ol> },
              { n: 3, icon: "🤖", title: "Add Anthropic Credentials in n8n", body: <><ol style={{ paddingLeft: 18, margin: 0, fontSize: 13, lineHeight: 1.9 }}><li>n8n → <strong>Credentials → New → Anthropic</strong></li><li>Paste your <code>ANTHROPIC_API_KEY</code></li><li>Name it: <strong>"Anthropic account"</strong> (exact match required)</li></ol><div style={{ marginTop: 10, padding: "8px 12px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}>💡 Workflows use <strong>Claude Sonnet 4.5</strong> for complex tasks and <strong>Claude Haiku 4.5</strong> for fast reminders</div></> },
              { n: 4, icon: "📧", title: "Add SMTP / Gmail Credentials", body: <ol style={{ paddingLeft: 18, margin: 0, fontSize: 13, lineHeight: 1.9 }}><li>n8n → <strong>Credentials → New → SMTP</strong></li><li>Host: <code>smtp.gmail.com</code>, Port: <code>587</code>, SSL: <code>STARTTLS</code></li><li>Gmail: 2FA → Google Account → Security → <strong>App Passwords</strong></li><li>Name it: <strong>"SMTP account"</strong></li></ol> },
              { n: 5, icon: "🔗", title: "Copy Webhook URLs → .env.local", body: <ol style={{ paddingLeft: 18, margin: 0, fontSize: 13, lineHeight: 1.9 }}><li>Open each imported workflow in n8n</li><li>Click the Webhook node → copy <strong>Production URL</strong></li><li>Paste into <code>.env.local</code> (see Env Config tab)</li><li>Restart app: <code>npm run dev</code></li></ol> },
              {
                n: 6, icon: "▶️", title: "Activate & Test",
                body: <><ol style={{ paddingLeft: 18, margin: 0, fontSize: 13, lineHeight: 1.9 }}><li>In n8n: open workflow → click <strong>Activate</strong> (toggle top-right)</li><li>Go to <strong>🧪 Test & Trigger</strong> tab → click <strong>▶ Test</strong></li></ol>
                  <div style={{ marginTop: 10, padding: "10px 14px", background: "rgba(99,102,241,.1)", borderRadius: 8, border: "1px solid rgba(99,102,241,.3)", fontSize: 13 }}>
                    🎉 Claude AI will now automatically write emails, analyze timesheets & run HR workflows 24/7!
                  </div></>,
              },
            ] as const).map(({ n, icon, title, body }) => (
              <div key={n} className="card">
                <div className="card-body" style={{ padding: 18, display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <div style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--primary)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{n}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>{icon} {title}</div>
                    {body}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TEST TAB */}
        {activeTab === "test" && (
          <>
            <div style={{ padding: "10px 14px", background: "rgba(99,102,241,.08)", border: "1px solid rgba(99,102,241,.2)", borderRadius: 10, fontSize: 13, marginBottom: 16 }}>
              💡 Without webhook URLs in <code>.env.local</code>, triggers are <strong>simulated</strong>. Add real n8n URLs to fire actual workflows.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {TRIGGER_WORKFLOWS.map(wf => {
                const t = tests[wf.id];
                return (
                  <div key={wf.id} className="card">
                    <div className="card-body" style={{ padding: 16 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                        <div><div style={{ fontWeight: 700, fontSize: 14 }}>{wf.label}</div><div style={{ fontSize: 12, color: "var(--text-muted)" }}>{wf.desc}</div></div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          {t?.status === "success" && <span className="badge badge-green">✓ Sent</span>}
                          {t?.status === "error" && <span className="badge badge-red">✗ Error</span>}
                          <button onClick={() => testWorkflow(wf.id)} disabled={t?.status === "testing"} className="btn btn-primary btn-sm">
                            {t?.status === "testing" ? <><span className="spinner" />&nbsp;Sending...</> : "▶ Test"}
                          </button>
                        </div>
                      </div>
                      {t?.response && <pre style={{ marginTop: 10, padding: "10px 12px", background: "#0f172a", color: "#e2e8f0", borderRadius: 8, fontSize: 11, fontFamily: "monospace", overflow: "auto", maxHeight: 160, whiteSpace: "pre-wrap" }}>{t.response}</pre>}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="card mt-4">
              <div className="card-header"><div className="card-title">📥 Simulate n8n → App (Incoming)</div></div>
              <div className="card-body" style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {[
                  { label: "🎂 Birthday Check", body: { event: "birthday_check", data: {} } },
                  { label: "🤖 AI HR Question", body: { event: "employee_question", data: { question: "How many employees do we have?" } } },
                  { label: "⏰ Sync Timesheet", body: { event: "timesheet_sync", data: { entries: [{ employeeId: "EMP001", employeeName: "Aarav Sharma", taskNo: "T1", description: "n8n integration testing", actualHours: 8, estimatedHours: 8, date: new Date().toISOString().split("T")[0], month: "April", year: 2026, status: "Done" }] } } },
                ].map(item => (
                  <button key={item.label} className="btn btn-outline" style={{ fontSize: 13 }}
                    onClick={async () => {
                      const res = await fetch("/api/n8n/webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item.body) });
                      const data = await res.json();
                      showToast(`${item.label}: ${JSON.stringify(data).slice(0, 100)}`);
                    }}>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ENV TAB */}
        {activeTab === "env" && (
          <>
            <div className="card mb-4">
              <div className="card-header">
                <div className="card-title">🔧 .env.local Configuration</div>
                <button className="btn btn-outline btn-sm" onClick={() => { navigator.clipboard.writeText(envConfig); showToast("📋 Copied!"); }}>📋 Copy All</button>
              </div>
              <div className="card-body">
                <pre style={{ background: "#0f172a", color: "#e2e8f0", padding: 20, borderRadius: 10, fontSize: 13, fontFamily: "monospace", overflow: "auto", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{envConfig}</pre>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><div className="card-title">📡 App Webhook Endpoints (for n8n to call back)</div></div>
              <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { method: "POST", path: "/api/n8n/webhook", desc: "Main receiver from n8n", header: "x-webhook-secret: YOUR_SECRET", events: ["birthday_check", "onboarding_document_uploaded", "timesheet_sync", "employee_question"] },
                  { method: "GET", path: "/api/birthday", desc: "Fetch today's birthdays", header: null, events: [] },
                  { method: "POST", path: "/api/birthday", desc: "Trigger birthday emails", header: null, events: [] },
                  { method: "GET", path: "/api/employees", desc: "Fetch all 50 employees", header: null, events: [] },
                  { method: "GET", path: "/api/timesheet", desc: "Fetch timesheet entries", header: null, events: [] },
                ].map(ep => (
                  <div key={`${ep.method}-${ep.path}`} style={{ padding: "10px 14px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                      <span className="badge badge-green" style={{ fontFamily: "monospace", fontSize: 11 }}>{ep.method}</span>
                      <code style={{ fontSize: 13, fontWeight: 700 }}>http://localhost:3001{ep.path}</code>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{ep.desc}</div>
                    {ep.header && <div style={{ fontSize: 11, color: "var(--primary)", fontFamily: "monospace", marginTop: 4 }}>Header: {ep.header}</div>}
                    {ep.events.length > 0 && (
                      <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {ep.events.map(e => <span key={e} className="badge badge-gray" style={{ fontSize: 10, fontFamily: "monospace" }}>{e}</span>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
