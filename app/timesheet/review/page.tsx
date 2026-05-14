"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { useVoiceCommand } from "@/app/hooks/useVoiceCommand";

interface ActivityEntry { title: string; app: string; category: string; start: string; end: string; durationSec: number; }
interface TimerSession { id: string; task: string; project: string; start: string | null; end: string | null; durationSec: number; running: boolean; }
interface InferredTask { task: string; category: string; totalSec?: number; estimatedHours?: number; totalHours?: number; description?: string; apps?: string[]; windows?: string[]; }

interface MonitorEvent {
  type:      "opened" | "closed" | "title_changed" | "snapshot" | "error" | "info";
  icon?:     string;
  label?:    string;
  category?: string;
  title?:    string;
  prevTitle?:string;
  pid?:      number;
  memMB?:    number;
  cpuSec?:   number;
  message?:  string;
  processes?: ProcessInfo[];
  count?:    number;
  ts:        string;
}

interface ProcessInfo {
  pid:      number;
  name:     string;
  title?:   string;
  icon:     string;
  label:    string;
  category: string;
  memMB?:   number;
  CPU?:     number;
}

function fmt(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtTs(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const CAT_COLOR: Record<string, string> = {
  Development: "#6366f1", Browsing: "#64748b", Spreadsheets: "#16a34a",
  Email: "#d97706", Communication: "#7c3aed", Documentation: "#2563eb",
  "AI Assistant": "#7c3aed", Terminal: "#dc2626", Design: "#d97706",
  System: "#475569", Media: "#0891b2", Other: "#6b7280",
};

const CAT_BADGE: Record<string, string> = {
  Development: "badge-blue", Browsing: "badge-gray", Spreadsheets: "badge-green",
  Email: "badge-yellow", Communication: "badge-purple", Documentation: "badge-blue",
  "AI Assistant": "badge-purple", Terminal: "badge-red", Design: "badge-yellow",
  System: "badge-gray", Media: "badge-gray", Other: "badge-gray",
};

function eventColor(type: string) {
  if (type === "opened")        return "#22c55e";
  if (type === "closed")        return "#ef4444";
  if (type === "title_changed") return "#6366f1";
  if (type === "snapshot")      return "#64748b";
  return "#94a3b8";
}

function eventLabel(ev: MonitorEvent) {
  if (ev.type === "opened")        return `🟢 Opened`;
  if (ev.type === "closed")        return `🔴 Closed`;
  if (ev.type === "title_changed") return `📝 Active`;
  if (ev.type === "snapshot")      return `📸 Snapshot`;
  if (ev.type === "error")         return `⚠️ Error`;
  return `ℹ️`;
}

export default function TimesheetReviewPage() {
  // ── existing state ──────────────────────────────────────────────────────────
  const [entries, setEntries]           = useState<ActivityEntry[]>([]);
  const [byCategory, setByCategory]     = useState<Record<string, { totalSec: number; entries: ActivityEntry[] }>>({});
  const [totalHours, setTotalHours]     = useState(0);
  const [timers, setTimers]             = useState<TimerSession[]>([]);
  const [inferredTasks, setInferredTasks] = useState<InferredTask[]>([]);
  const [loading, setLoading]           = useState(true);
  const [inferring, setInferring]       = useState(false);
  const [submitting, setSubmitting]     = useState(false);
  const [submitted, setSubmitted]       = useState(false);
  const [toast, setToast]               = useState<{ msg: string; ok: boolean } | null>(null);
  const [timerTask, setTimerTask]       = useState("");
  const [timerProject, setTimerProject] = useState("");
  const [tab, setTab]                   = useState<"activity" | "timer" | "inferred" | "monitor">("monitor");
  const timerPollRef                    = useRef<NodeJS.Timeout | null>(null);

  // ── monitor state ───────────────────────────────────────────────────────────
  const [monitoring, setMonitoring]     = useState(false);
  const [monitorLog, setMonitorLog]     = useState<MonitorEvent[]>([]);
  const [liveProcesses, setLiveProcesses] = useState<ProcessInfo[]>([]);
  const [importingTM, setImportingTM]   = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const monitorAbortRef                 = useRef<AbortController | null>(null);
  const logRef                          = useRef<HTMLDivElement>(null);

  function showToast(msg: string, ok = true) { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); }

  // ── data loading ────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    const res = await fetch("/api/activity");
    const d   = await res.json();
    setEntries(d.entries ?? []);
    setByCategory(d.byCategory ?? {});
    setTotalHours(d.totalHours ?? 0);
    setTimers(d.timers ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
    timerPollRef.current = setInterval(() => {
      fetch("/api/activity?action=timers").then(r => r.json()).then(d => setTimers(d.timers ?? []));
    }, 1000);
    return () => { if (timerPollRef.current) clearInterval(timerPollRef.current); };
  }, [loadData]);

  useVoiceCommand(useCallback((action) => {
    const p = action.params;
    switch (action.action) {
      case "switch_tab":
        setTab(p.tab as typeof tab);
        break;
      case "start_timer":
        setTimerTask(String(p.task ?? ""));
        if (p.project) setTimerProject(String(p.project));
        setTab("timer");
        // auto-start after state updates
        setTimeout(() => startTimer(), 100);
        break;
      case "stop_timer": {
        const running = timers.find(t => t.running);
        if (running) void stopTimer(running.id);
        break;
      }
      case "infer_tasks":
        void inferTasks();
        break;
      case "submit_timesheet":
        setTab("inferred");
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timers]));

  // auto-scroll log
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [monitorLog]);

  // ── monitoring ──────────────────────────────────────────────────────────────
  async function startMonitoring() {
    setMonitoring(true);
    setMonitorLog([]);
    monitorAbortRef.current = new AbortController();

    try {
      const res = await fetch("/api/activity/monitor", { signal: monitorAbortRef.current.signal });
      if (!res.ok || !res.body) { setMonitoring(false); return; }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          if (!chunk.startsWith("data: ")) continue;
          try {
            const ev: MonitorEvent = JSON.parse(chunk.slice(6));
            if (ev.type === "snapshot" && ev.processes) {
              setLiveProcesses(ev.processes);
              setMonitorLog(p => [...p, ev]);
            } else {
              setMonitorLog(p => [...p.slice(-199), ev]); // keep last 200 events
              // refresh activity data when we get opened events
              if (ev.type === "opened" || ev.type === "title_changed") loadData();
            }
          } catch {}
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError") {
        setMonitorLog(p => [...p, { type: "error", message: String(err), ts: new Date().toISOString() }]);
      }
    }
    setMonitoring(false);
  }

  function stopMonitoring() {
    monitorAbortRef.current?.abort();
    setMonitoring(false);
    setMonitorLog(p => [...p, { type: "info", message: "Monitoring stopped", ts: new Date().toISOString() }]);
  }

  // ── import from Task Manager ─────────────────────────────────────────────────
  async function importFromTaskManager() {
    setImportingTM(true);
    try {
      const res  = await fetch("/api/activity/monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import_snapshot" }),
      });
      const data = await res.json();
      setLiveProcesses(data.processes ?? []);
      setImportedCount(data.logged ?? 0);
      showToast(`📊 Imported ${data.total} processes, logged ${data.logged} active apps`);
      loadData();
    } catch (err) {
      showToast(String(err), false);
    }
    setImportingTM(false);
  }

  // ── timers ───────────────────────────────────────────────────────────────────
  async function startTimer() {
    if (!timerTask) return;
    await fetch("/api/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start_timer", task: timerTask, project: timerProject }) });
    setTimerTask(""); setTimerProject("");
    showToast("Timer started ✓");
    loadData();
  }

  async function stopTimer(id: string) {
    await fetch("/api/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stop_timer", id }) });
    showToast("Timer stopped ✓");
    loadData();
  }

  // ── AI inference ─────────────────────────────────────────────────────────────
  async function inferTasks() {
    setInferring(true);
    const res = await fetch("/api/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "infer_tasks" }) });
    const d   = await res.json();
    setInferredTasks(d.tasks ?? []);
    setTab("inferred");
    setInferring(false);
  }

  // ── submit ────────────────────────────────────────────────────────────────────
  async function submitToTimesheet() {
    setSubmitting(true);
    const tasks = inferredTasks.length > 0
      ? inferredTasks
      : Object.entries(byCategory).map(([cat, g]) => ({ task: cat, category: cat, estimatedHours: 0, totalHours: g.totalSec / 3600 }));
    for (const task of tasks) {
      await fetch("/api/timesheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId:     "SELF",
          employeeName:   "Me",
          taskNo:         `AUTO-${Date.now()}`,
          description:    task.task + (("description" in task && task.description) ? ` — ${task.description as string}` : ""),
          status:         "Completed",
          estimatedHours: task.estimatedHours ?? 0,
          actualHours:    Math.round(((task.totalHours ?? (("totalSec" in task ? (task.totalSec as number) : 0) / 3600))) * 10) / 10,
          date:           new Date().toISOString().split("T")[0],
          month:          new Date().toLocaleString("default", { month: "long" }),
          year:           new Date().getFullYear(),
        }),
      });
    }
    setSubmitted(true);
    setSubmitting(false);
    showToast(`✓ ${tasks.length} tasks submitted!`);
  }

  const runningTimer = timers.find(t => t.running);

  return (
    <>
      {toast && (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 999, background: toast.ok ? "#22c55e" : "#ef4444", color: "#fff", padding: "12px 20px", borderRadius: 10, fontWeight: 600, fontSize: 14, boxShadow: "0 4px 20px rgba(0,0,0,.25)" }}>
          {toast.msg}
        </div>
      )}

      <div className="topbar">
        <div>
          <div className="topbar-title">⏰ Auto Timesheet</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {new Date().toLocaleDateString("en-IN", { weekday: "long", month: "long", day: "numeric" })}
            {monitoring && <span style={{ color: "#22c55e", marginLeft: 12, fontWeight: 700 }}>● Live Monitoring</span>}
          </div>
        </div>
        <div className="topbar-right">
          {/* Start / Stop Monitoring button */}
          {monitoring ? (
            <button onClick={stopMonitoring} className="btn btn-danger">
              ⏹ Stop Monitoring
            </button>
          ) : (
            <button onClick={() => { setTab("monitor"); startMonitoring(); }} className="btn btn-success">
              ▶ Start Monitoring
            </button>
          )}
          <button onClick={importFromTaskManager} disabled={importingTM} className="btn btn-outline" title="Import current running processes from Task Manager">
            {importingTM ? <><span className="spinner" />&nbsp;Importing...</> : "📊 Import Task Manager"}
          </button>
          {totalHours > 0 && !submitted && (
            <button onClick={submitToTimesheet} disabled={submitting} className="btn btn-primary">
              {submitting ? <><span className="spinner" />&nbsp;Submitting...</> : `✓ Submit ${totalHours}h`}
            </button>
          )}
          <button onClick={inferTasks} disabled={inferring} className="btn btn-outline">
            {inferring ? <><span className="spinner" />&nbsp;Inferring...</> : "🤖 AI Infer"}
          </button>
        </div>
      </div>

      <div className="page-content">
        {/* Stats row */}
        <div className="stat-grid mb-4">
          <div className="stat-card">
            <div className="flex-between"><div className="stat-label">Total Today</div><span style={{ fontSize: 22 }}>⏱️</span></div>
            <div className="stat-value">{totalHours}h</div>
            <div className="stat-sub">{entries.length} activity events</div>
          </div>
          <div className="stat-card">
            <div className="flex-between"><div className="stat-label">Categories</div><span style={{ fontSize: 22 }}>📊</span></div>
            <div className="stat-value">{Object.keys(byCategory).length}</div>
            <div className="stat-sub">App types detected</div>
          </div>
          <div className="stat-card">
            <div className="flex-between"><div className="stat-label">Monitor</div><span style={{ fontSize: 22 }}>{monitoring ? "🟢" : "🔴"}</span></div>
            <div className="stat-value" style={{ fontSize: 18 }}>{monitoring ? "Live" : "Off"}</div>
            <div className="stat-sub">{monitorLog.filter(e => e.type !== "snapshot").length} events logged</div>
          </div>
          <div className="stat-card">
            <div className="flex-between"><div className="stat-label">Timer</div><span style={{ fontSize: 22 }}>⏱</span></div>
            <div className="stat-value">{runningTimer ? fmt(runningTimer.durationSec) : "—"}</div>
            <div className="stat-sub">{runningTimer ? `🔴 ${runningTimer.task}` : "No active timer"}</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16, borderBottom: "2px solid var(--border)" }}>
          {[
            ["monitor",  "🖥️ Live Monitor"],
            ["activity", "📊 Activity Log"],
            ["timer",    "⏱️ Timer"],
            ["inferred", "🤖 AI Tasks"],
          ].map(([t, l]) => (
            <button key={t} onClick={() => setTab(t as never)} className={`btn btn-sm ${tab === t ? "btn-primary" : "btn-outline"}`}
              style={{ borderRadius: "8px 8px 0 0", marginBottom: -2 }}>
              {l}
            </button>
          ))}
        </div>

        {/* ══════════════════ MONITOR TAB ══════════════════ */}
        {tab === "monitor" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Control card */}
            <div className="card">
              <div className="card-body" style={{ padding: "16px 20px" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  {monitoring ? (
                    <button onClick={stopMonitoring} className="btn btn-danger" style={{ minWidth: 180, justifyContent: "center" }}>
                      ⏹ Stop Monitoring
                    </button>
                  ) : (
                    <button onClick={startMonitoring} className="btn btn-success" style={{ minWidth: 180, justifyContent: "center" }}>
                      ▶ Start Monitoring
                    </button>
                  )}
                  <button onClick={importFromTaskManager} disabled={importingTM} className="btn btn-outline">
                    {importingTM ? <><span className="spinner" />&nbsp;Scanning...</> : "📊 Import from Task Manager"}
                  </button>
                  {importedCount > 0 && <span className="badge badge-green">✓ {importedCount} logged</span>}
                  <div style={{ flex: 1 }} />
                  {monitorLog.length > 0 && (
                    <button onClick={() => setMonitorLog([])} className="btn btn-outline btn-sm">🗑️ Clear Log</button>
                  )}
                </div>

                <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7 }}>
                  <strong style={{ color: "var(--text)" }}>How it works:</strong><br />
                  <strong>▶ Start Monitoring</strong> — polls Windows Task Manager every 5s via PowerShell and streams events live (app opened, closed, window title changes).<br />
                  <strong>📊 Import from Task Manager</strong> — one-click snapshot of all currently running processes and logs active apps immediately.
                </div>
              </div>
            </div>

            <div className="grid-2" style={{ gap: 16 }}>
              {/* Live log panel */}
              <div className="card" style={{ display: "flex", flexDirection: "column" }}>
                <div className="card-header" style={{ flexShrink: 0 }}>
                  <div className="card-title">📋 Live Activity Log</div>
                  <div className="flex-center" style={{ gap: 8 }}>
                    {monitoring && <span className="badge badge-green" style={{ animation: "pulse 1s infinite" }}>● LIVE</span>}
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{monitorLog.filter(e => e.type !== "snapshot").length} events</span>
                  </div>
                </div>

                <div ref={logRef} style={{
                  flex: 1, overflowY: "auto", background: "#0d1117",
                  padding: 12, minHeight: 360, maxHeight: 460, borderRadius: "0 0 12px 12px",
                  fontFamily: "monospace", fontSize: 12,
                }}>
                  {monitorLog.length === 0 ? (
                    <div style={{ color: "#475569", textAlign: "center", paddingTop: 60 }}>
                      <div style={{ fontSize: 28, marginBottom: 10 }}>🖥️</div>
                      <div>Click <strong style={{ color: "#6366f1" }}>▶ Start Monitoring</strong> to begin</div>
                      <div style={{ marginTop: 6, fontSize: 11 }}>Polls Task Manager every 5 seconds</div>
                    </div>
                  ) : (
                    monitorLog.map((ev, i) => {
                      if (ev.type === "snapshot") return (
                        <div key={i} style={{ color: "#475569", padding: "4px 0", borderBottom: "1px solid #1e293b" }}>
                          📸 {fmtTs(ev.ts)} — Initial snapshot: {ev.count} visible windows
                        </div>
                      );
                      if (ev.type === "info" || ev.type === "error") return (
                        <div key={i} style={{ color: ev.type === "error" ? "#f87171" : "#64748b", padding: "3px 0" }}>
                          {ev.type === "error" ? "⚠️" : "ℹ️"} {fmtTs(ev.ts)} — {ev.message}
                        </div>
                      );
                      return (
                        <div key={i} style={{ display: "flex", gap: 8, padding: "3px 0", borderBottom: "1px solid #1a2235", alignItems: "flex-start" }}>
                          {/* timestamp */}
                          <span style={{ color: "#475569", whiteSpace: "nowrap", minWidth: 80 }}>{fmtTs(ev.ts)}</span>
                          {/* event type */}
                          <span style={{ color: eventColor(ev.type), fontWeight: 700, minWidth: 56, whiteSpace: "nowrap" }}>{eventLabel(ev)}</span>
                          {/* icon + label */}
                          <span style={{ color: "#94a3b8" }}>{ev.icon} {ev.label}</span>
                          {/* title */}
                          {ev.title && ev.type !== "closed" && (
                            <span style={{ color: "#e2e8f0", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              — {ev.title}
                            </span>
                          )}
                          {/* category badge */}
                          {ev.category && (
                            <span style={{ background: CAT_COLOR[ev.category ?? ""] ?? "#475569", color: "#fff", fontSize: 10, padding: "1px 6px", borderRadius: 8, whiteSpace: "nowrap", flexShrink: 0 }}>
                              {ev.category}
                            </span>
                          )}
                        </div>
                      );
                    })
                  )}
                  {monitoring && <div style={{ color: "#6366f1", animation: "pulse 1s infinite" }}>▌ monitoring...</div>}
                </div>
              </div>

              {/* Live process list */}
              <div className="card" style={{ display: "flex", flexDirection: "column" }}>
                <div className="card-header" style={{ flexShrink: 0 }}>
                  <div className="card-title">🖥️ Active Windows ({liveProcesses.length})</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>From Task Manager snapshot</div>
                </div>
                <div style={{ flex: 1, overflowY: "auto", maxHeight: 420 }}>
                  {liveProcesses.length === 0 ? (
                    <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
                      <div style={{ fontSize: 28, marginBottom: 10 }}>📊</div>
                      <div>Click <strong>▶ Start Monitoring</strong> or <strong>📊 Import Task Manager</strong></div>
                    </div>
                  ) : (
                    liveProcesses.map((p, i) => (
                      <div key={p.pid ?? i} style={{ padding: "8px 16px", borderBottom: "1px solid var(--border)", display: "flex", gap: 10, alignItems: "center" }}>
                        <span style={{ fontSize: 18, flexShrink: 0 }}>{p.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{p.label}</div>
                          {p.title && (
                            <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.title}>
                              {p.title}
                            </div>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                          {p.memMB != null && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.memMB}MB</span>}
                          <span style={{ background: CAT_COLOR[p.category] ?? "#475569", color: "#fff", fontSize: 10, padding: "1px 6px", borderRadius: 8 }}>{p.category}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Category summary from monitoring */}
            {monitorLog.filter(e => e.type === "opened").length > 0 && (
              <div className="card">
                <div className="card-header"><div className="card-title">📊 Session Summary</div></div>
                <div className="card-body" style={{ padding: "12px 20px" }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {Object.entries(
                      monitorLog.filter(e => e.type === "opened" && e.category).reduce<Record<string, number>>((acc, e) => {
                        acc[e.category!] = (acc[e.category!] ?? 0) + 1;
                        return acc;
                      }, {})
                    ).sort(([,a],[,b]) => b - a).map(([cat, count]) => (
                      <div key={cat} style={{ display: "flex", gap: 6, alignItems: "center", padding: "6px 12px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8 }}>
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: CAT_COLOR[cat] ?? "#475569", display: "inline-block" }} />
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{cat}</span>
                        <span className="badge badge-gray">{count} opens</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════ ACTIVITY TAB ══════════════════ */}
        {tab === "activity" && (
          <div className="grid-2">
            <div className="card">
              <div className="card-header"><div className="card-title">By Category</div></div>
              <div className="card-body" style={{ padding: 0 }}>
                {Object.keys(byCategory).length === 0 ? (
                  <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
                    <div style={{ fontWeight: 700 }}>No activity yet</div>
                    <div style={{ fontSize: 13, marginTop: 8 }}>Start monitoring or import from Task Manager</div>
                  </div>
                ) : (
                  Object.entries(byCategory).sort(([,a],[,b]) => b.totalSec - a.totalSec).map(([cat, g]) => (
                    <div key={cat} style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{cat}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{g.entries.length} events</div>
                      </div>
                      <div style={{ width: 100 }}>
                        <div className="progress"><div className="progress-bar" style={{ width: `${Math.min(100, totalHours > 0 ? (g.totalSec / (totalHours * 3600)) * 100 : 0)}%` }} /></div>
                      </div>
                      <span className={`badge ${CAT_BADGE[cat] ?? "badge-gray"}`}>{fmt(g.totalSec)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-header"><div className="card-title">Activity Timeline</div></div>
              <div style={{ maxHeight: 420, overflowY: "auto" }}>
                {entries.length === 0 ? (
                  <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No entries yet</div>
                ) : (
                  [...entries].reverse().map((e, i) => (
                    <div key={i} style={{ padding: "10px 20px", borderBottom: "1px solid var(--border)", display: "flex", gap: 10 }}>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap", minWidth: 70 }}>{fmtTime(e.start)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{e.app}</div>
                      </div>
                      <span className={`badge ${CAT_BADGE[e.category] ?? "badge-gray"}`} style={{ flexShrink: 0 }}>{fmt(e.durationSec)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════ TIMER TAB ══════════════════ */}
        {tab === "timer" && (
          <div className="grid-2">
            <div className="card">
              <div className="card-header"><div className="card-title">⏱️ Manual Timer</div></div>
              <div className="card-body">
                {runningTimer && (
                  <div className="bday-card mb-4" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 22 }}>{fmt(runningTimer.durationSec)}</div>
                      <div style={{ opacity: .85 }}>{runningTimer.task}</div>
                    </div>
                    <button onClick={() => stopTimer(runningTimer.id)} className="btn" style={{ background: "#fff", color: "var(--primary)" }}>⏹ Stop</button>
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">Task Name *</label>
                  <input className="form-input" placeholder="e.g. Frontend development" value={timerTask} onChange={e => setTimerTask(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Project</label>
                  <input className="form-input" placeholder="e.g. PRJ_202601" value={timerProject} onChange={e => setTimerProject(e.target.value)} />
                </div>
                <button onClick={startTimer} disabled={!timerTask} className="btn btn-primary w-full" style={{ justifyContent: "center" }}>▶ Start Timer</button>
              </div>
            </div>

            <div className="card">
              <div className="card-header"><div className="card-title">Timer History</div></div>
              <div style={{ maxHeight: 400, overflowY: "auto" }}>
                {timers.filter(t => !t.running).length === 0 ? (
                  <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)" }}>No completed timers</div>
                ) : (
                  [...timers].filter(t => !t.running).reverse().map(t => (
                    <div key={t.id} style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{t.task}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.project || "No project"} · {t.start ? fmtTime(t.start) : ""}</div>
                      </div>
                      <span className="badge badge-blue">{fmt(t.durationSec)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════ AI TASKS TAB ══════════════════ */}
        {tab === "inferred" && (
          <div>
            {inferredTasks.length === 0 ? (
              <div className="card">
                <div className="card-body text-center" style={{ padding: 48 }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>🤖</div>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>AI Task Inference</div>
                  <div className="text-muted mb-4">Claude analyses your activity log and groups it into meaningful work tasks for the timesheet</div>
                  <button onClick={inferTasks} disabled={inferring} className="btn btn-primary">
                    {inferring ? <><span className="spinner" />&nbsp;Analysing...</> : "🤖 Infer Tasks from Activity"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="alert alert-success mb-4">✓ AI inferred {inferredTasks.length} tasks from your activity</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
                  {inferredTasks.map((task, i) => (
                    <div key={i} className="card">
                      <div className="card-body" style={{ display: "flex", alignItems: "center", gap: 16 }}>
                        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--primary-light)", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>{i + 1}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 15 }}>{task.task}</div>
                          {task.description && <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{task.description}</div>}
                          {task.apps && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Apps: {task.apps.join(", ")}</div>}
                        </div>
                        <span className="badge badge-blue">{task.estimatedHours ?? task.totalHours ?? ((task.totalSec ?? 0) / 3600).toFixed(1)}h</span>
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={submitToTimesheet} disabled={submitting || submitted} className="btn btn-success" style={{ width: "100%", justifyContent: "center" }}>
                  {submitted ? "✓ Submitted!" : submitting ? "Submitting..." : `✓ Submit ${inferredTasks.length} Tasks to Timesheet`}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }`}</style>
    </>
  );
}
