"use client";

import { useCallback, useEffect, useState } from "react";

interface InboxEmail {
  uid: number;
  messageId: string;
  subject: string;
  from: { name: string; address: string };
  to: { name: string; address: string }[];
  date: string;
  bodyPreview: string;
  isRead: boolean;
  hasAttachments: boolean;
}

interface FullEmail extends InboxEmail {
  bodyHtml: string;
  bodyText: string;
  contentType: "html" | "text";
}

interface EmailAnalysis {
  intent: string;
  summary: string;
  urgency: "high" | "medium" | "low";
  requiresResponse: boolean;
  isMeetingRelated: boolean;
  extractedParticipants: string[];
  extractedDates: string[];
  extractedTopics: string[];
  suggestedAction: string;
}

interface MeetingDetails {
  title: string;
  attendees: string[];
  preferredDates: string[];
  duration: number;
  agenda: string;
}

interface TimeSlot { start: string; end: string }
type Filter = "all" | "unread" | "meetings";

function fmtDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}

function urgencyClass(u: string) {
  return u === "high" ? "badge badge-red" : u === "medium" ? "badge badge-yellow" : "badge badge-green";
}

export default function MailPage() {
  const [configured, setConfigured] = useState(true);
  const [configHint, setConfigHint] = useState("");
  const [emails, setEmails] = useState<InboxEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const [selected, setSelected] = useState<FullEmail | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);
  const [analysis, setAnalysis] = useState<EmailAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const [draft, setDraft] = useState("");
  const [draftLoading, setDraftLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentOk, setSentOk] = useState(false);

  const [showMeeting, setShowMeeting] = useState(false);
  const [meetingDetails, setMeetingDetails] = useState<MeetingDetails | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [manualStart, setManualStart] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [creatingMeeting, setCreatingMeeting] = useState(false);
  const [meetingDone, setMeetingDone] = useState(false);

  const [showCompose, setShowCompose] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composing, setComposing] = useState(false);
  const [composeOk, setComposeOk] = useState(false);

  // ── Fetch inbox ──────────────────────────────────────────────────────────
  const fetchInbox = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/mail/inbox");
      const data = await res.json();
      if (!data.configured) {
        setConfigured(false);
        setConfigHint(data.hint || "");
      } else if (data.error) {
        setLoadError(data.error);
      } else {
        setEmails(data.emails || []);
        setConfigured(true);
      }
    } catch (e) {
      setLoadError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchInbox(); }, [fetchInbox]);

  // ── Select email & analyse ───────────────────────────────────────────────
  async function selectEmail(email: InboxEmail) {
    setSelected({ ...email, bodyHtml: "", bodyText: email.bodyPreview, contentType: "text" });
    setAnalysis(null);
    setDraft("");
    setSentOk(false);
    setShowMeeting(false);
    setMeetingDetails(null);
    setSlots([]);
    setSelectedSlot(null);
    setMeetingDone(false);

    // Fetch full body
    setLoadingFull(true);
    try {
      const res = await fetch(`/api/mail/inbox?uid=${email.uid}`);
      const data = await res.json();
      if (data.email) setSelected(data.email as FullEmail);
    } catch {}
    setLoadingFull(false);

    // Auto-analyse
    setAnalyzing(true);
    try {
      const res = await fetch("/api/mail/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "analyze",
          subject: email.subject,
          body: email.bodyPreview,
          from: email.from.address,
        }),
      });
      const data = await res.json();
      if (data.analysis) setAnalysis(data.analysis);
    } catch {}
    setAnalyzing(false);
  }

  // ── Draft response ───────────────────────────────────────────────────────
  async function handleDraft(instruction?: string) {
    if (!selected) return;
    setDraftLoading(true);
    setDraft("");
    setSentOk(false);
    try {
      const res = await fetch("/api/mail/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "draft",
          subject: selected.subject,
          body: selected.bodyText || selected.bodyPreview,
          from: selected.from.name || selected.from.address,
          instruction,
        }),
      });
      const data = await res.json();
      if (data.draft) setDraft(data.draft);
    } catch {}
    setDraftLoading(false);
  }

  async function handleSendReply() {
    if (!selected || !draft) return;
    setSending(true);
    try {
      const res = await fetch("/api/mail/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: selected.from.address,
          subject: selected.subject,
          body: draft,
          inReplyTo: selected.messageId,
        }),
      });
      if ((await res.json()).sent) {
        setSentOk(true);
        setDraft("");
        setEmails((prev) => prev.map((e) => e.uid === selected.uid ? { ...e, isRead: true } : e));
      }
    } catch {}
    setSending(false);
  }

  // ── Meeting scheduler ────────────────────────────────────────────────────
  async function handleScheduleMeeting() {
    if (!selected) return;
    setShowMeeting(true);
    setExtracting(true);
    try {
      const res = await fetch("/api/mail/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "extract_meeting",
          subject: selected.subject,
          body: selected.bodyText || selected.bodyPreview,
        }),
      });
      const data = await res.json();
      if (data.details) setMeetingDetails(data.details);
    } catch {}
    setExtracting(false);
  }

  async function handleLoadSlots() {
    setLoadingSlots(true);
    try {
      const res = await fetch("/api/mail/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration: meetingDetails?.duration || 60 }),
      });
      const data = await res.json();
      if (data.slots) setSlots(data.slots);
    } catch {}
    setLoadingSlots(false);
  }

  async function handleCreateMeeting() {
    if (!meetingDetails) return;
    const startIso = selectedSlot?.start || manualStart;
    if (!startIso) return;
    setCreatingMeeting(true);
    const dur = meetingDetails.duration || 60;
    const endIso = selectedSlot?.end || new Date(new Date(startIso).getTime() + dur * 60000).toISOString().slice(0, 19);
    try {
      const res = await fetch("/api/mail/meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: meetingDetails.title,
          startDateTime: startIso,
          endDateTime: endIso,
          attendees: meetingDetails.attendees,
          agenda: meetingDetails.agenda,
          meetingUrl: meetingUrl || undefined,
        }),
      });
      if ((await res.json()).invited) setMeetingDone(true);
    } catch {}
    setCreatingMeeting(false);
  }

  // ── Compose ──────────────────────────────────────────────────────────────
  async function handleComposeSend() {
    setComposing(true);
    setComposeOk(false);
    try {
      const res = await fetch("/api/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: composeTo.split(",").map((e) => e.trim()).filter(Boolean),
          subject: composeSubject,
          body: `<p>${composeBody.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br/>")}</p>`,
        }),
      });
      if ((await res.json()).sent) {
        setComposeOk(true);
        setTimeout(() => { setShowCompose(false); setComposeTo(""); setComposeSubject(""); setComposeBody(""); setComposeOk(false); }, 1200);
      }
    } catch {}
    setComposing(false);
  }

  // ── Filtered list ────────────────────────────────────────────────────────
  const filtered = emails.filter((e) => {
    if (filter === "unread") return !e.isRead;
    if (filter === "meetings") return /meet|schedul|call|standup|sync/i.test(e.subject);
    return true;
  });

  // ── Not configured ───────────────────────────────────────────────────────
  if (!configured) {
    return (
      <div className="page-content">
        <div className="section-title">Mail & Meetings</div>
        <div className="section-sub">AI-powered inbox, auto-responses and meeting scheduling via your existing SMTP server</div>
        <div className="card" style={{ maxWidth: 580 }}>
          <div className="card-body">
            <div className="alert alert-warning">
              <strong>SMTP credentials not found.</strong> {configHint}
            </div>
            <div className="alert alert-info" style={{ marginTop: 12 }}>
              <div>
                Mail uses the <strong>same SMTP server</strong> already configured for birthday emails.
                Make sure at least one of these blocks is set in <code>.env.local</code>:
                <pre style={{ background: "#fff", padding: 10, borderRadius: 6, fontSize: 12, marginTop: 8, lineHeight: 1.8 }}>
{`# Gmail
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password

# Outlook / Office 365
OUTLOOK_SMTP_USER=you@company.com
OUTLOOK_SMTP_PASS=your-password`}
                </pre>
                <p style={{ marginTop: 8, fontSize: 13 }}>
                  IMAP reading uses the same credentials on port 993.
                  For Gmail you need an <strong>App Password</strong> (2FA must be on).
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main UI ──────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      {/* Topbar */}
      <div className="topbar">
        <div className="topbar-title">Mail & Meetings</div>
        <div className="topbar-right">
          <button className="btn btn-outline btn-sm" onClick={fetchInbox} disabled={loading}>
            {loading ? <span className="spinner spinner-dark" /> : "↻"} Refresh
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => { setShowCompose(true); setComposeOk(false); }}>+ Compose</button>
        </div>
      </div>

      {/* Filter strip */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--card)", paddingLeft: 8, flexShrink: 0 }}>
        {(["all", "unread", "meetings"] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: "10px 16px", border: "none", background: "transparent", cursor: "pointer",
            borderBottom: filter === f ? "2px solid var(--primary)" : "2px solid transparent",
            color: filter === f ? "var(--primary)" : "var(--text-muted)",
            fontWeight: 700, fontSize: 13, textTransform: "capitalize",
          }}>
            {f === "all" ? `All (${emails.length})` : f === "unread" ? `Unread (${emails.filter((e) => !e.isRead).length})` : "Meetings"}
          </button>
        ))}
      </div>

      {/* Split pane */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Email list */}
        <div className="mail-list">
          {loading ? (
            <div style={{ padding: 24, textAlign: "center" }}><span className="spinner spinner-dark" /></div>
          ) : loadError ? (
            <div style={{ padding: 12 }}><div className="alert alert-danger" style={{ fontSize: 13 }}>{loadError}</div></div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No emails</div>
          ) : filtered.map((email) => (
            <div
              key={email.uid}
              className={`mail-item${selected?.uid === email.uid ? " selected" : ""}${!email.isRead ? " unread" : ""}`}
              onClick={() => selectEmail(email)}
            >
              {!email.isRead && <span className="mail-unread-dot" />}
              <div className="mail-item-header">
                <span className="mail-sender" style={{ paddingLeft: !email.isRead ? 10 : 0 }}>
                  {email.from.name || email.from.address}
                </span>
                <span className="mail-date">{fmtDate(email.date)}</span>
              </div>
              <div className="mail-subject" style={{ paddingLeft: !email.isRead ? 10 : 0 }}>
                {email.subject || "(no subject)"}
              </div>
              <div className="mail-preview" style={{ paddingLeft: !email.isRead ? 10 : 0 }}>
                {email.bodyPreview}
              </div>
            </div>
          ))}
        </div>

        {/* Detail pane */}
        {selected ? (
          <div className="mail-detail">

            {/* Header */}
            <div className="mail-detail-header">
              <div className="mail-detail-subject">{selected.subject}</div>
              <div className="mail-detail-meta">
                <strong>{selected.from.name || selected.from.address}</strong>
                {selected.from.name && <span style={{ color: "var(--text-muted)" }}> &lt;{selected.from.address}&gt;</span>}
                <span style={{ marginLeft: 14, color: "var(--text-muted)" }}>
                  {new Date(selected.date).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                </span>
              </div>
            </div>

            {/* Body */}
            <div className="mail-body-wrap">
              {loadingFull ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text-muted)", fontSize: 13 }}>
                  <span className="spinner spinner-dark" /> Loading…
                </div>
              ) : selected.bodyHtml ? (
                <iframe
                  srcDoc={selected.bodyHtml}
                  style={{ width: "100%", height: 260, border: "1px solid var(--border)", borderRadius: 8, background: "#fff", display: "block" }}
                  sandbox="allow-same-origin"
                />
              ) : (
                <div style={{ fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap", color: "var(--text)" }}>
                  {selected.bodyText || selected.bodyPreview}
                </div>
              )}
            </div>

            {/* AI Analysis */}
            <div className="ai-panel">
              <div className="ai-panel-title">AI Analysis</div>
              {analyzing ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-muted)" }}>
                  <span className="spinner spinner-dark" /> Analysing…
                </div>
              ) : analysis ? (
                <div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                    <span className="badge badge-purple">{analysis.intent.replace(/_/g, " ")}</span>
                    <span className={urgencyClass(analysis.urgency)}>{analysis.urgency} urgency</span>
                    {analysis.isMeetingRelated && <span className="badge badge-blue">meeting related</span>}
                    {analysis.requiresResponse && <span className="badge badge-yellow">response needed</span>}
                  </div>
                  <div style={{ fontSize: 13, marginBottom: 5 }}><strong>Summary:</strong> {analysis.summary}</div>
                  {analysis.extractedTopics.length > 0 && (
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                      <strong>Topics:</strong> {analysis.extractedTopics.join(", ")}
                    </div>
                  )}
                  {analysis.extractedParticipants.length > 0 && (
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                      <strong>People:</strong> {analysis.extractedParticipants.join(", ")}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
                    <strong>Suggested:</strong> {analysis.suggestedAction}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="btn btn-outline btn-sm" onClick={() => handleDraft()} disabled={draftLoading}>
                      {draftLoading ? <span className="spinner spinner-dark" /> : "✏️ Auto-Respond"}
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={() => handleDraft("Write a polite brief acknowledgement of receipt")} disabled={draftLoading}>
                      👍 Acknowledge
                    </button>
                    {(analysis.isMeetingRelated || analysis.intent === "meeting_request") && (
                      <button className="btn btn-primary btn-sm" onClick={handleScheduleMeeting}>
                        📅 Schedule Meeting
                      </button>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Draft */}
            {(draft || draftLoading) && (
              <div className="ai-panel">
                <div className="ai-panel-title">Draft Response</div>
                {draftLoading ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-muted)" }}>
                    <span className="spinner spinner-dark" /> Writing draft…
                  </div>
                ) : (
                  <>
                    {sentOk && <div className="alert alert-success" style={{ marginBottom: 8, padding: "8px 12px" }}>✓ Reply sent!</div>}
                    <textarea
                      className="form-textarea"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={6}
                      style={{ fontSize: 13 }}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button className="btn btn-primary btn-sm" onClick={handleSendReply} disabled={sending || !draft}>
                        {sending ? <span className="spinner" /> : "Send Reply"}
                      </button>
                      <button className="btn btn-outline btn-sm" onClick={() => setDraft("")}>Discard</button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Meeting scheduler */}
            {showMeeting && (
              <div className="ai-panel">
                <div className="ai-panel-title">📅 Schedule Meeting</div>
                {meetingDone ? (
                  <div className="alert alert-success">
                    ✓ <strong>Calendar invite sent!</strong> Attendees will receive an .ics invite in their inbox.
                  </div>
                ) : extracting ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-muted)" }}>
                    <span className="spinner spinner-dark" /> Extracting meeting details from email…
                  </div>
                ) : meetingDetails ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Meeting Title</label>
                      <input className="form-input" value={meetingDetails.title}
                        onChange={(e) => setMeetingDetails({ ...meetingDetails, title: e.target.value })} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Attendees (comma separated)</label>
                      <input className="form-input"
                        value={meetingDetails.attendees.join(", ")}
                        onChange={(e) => setMeetingDetails({ ...meetingDetails, attendees: e.target.value.split(",").map((a) => a.trim()).filter(Boolean) })}
                        placeholder="email1@company.com, email2@company.com" />
                    </div>
                    <div className="form-row" style={{ margin: 0 }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Duration (minutes)</label>
                        <input className="form-input" type="number" value={meetingDetails.duration}
                          onChange={(e) => setMeetingDetails({ ...meetingDetails, duration: parseInt(e.target.value) || 60 })} />
                      </div>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Agenda / Description</label>
                      <textarea className="form-textarea" rows={2} value={meetingDetails.agenda}
                        onChange={(e) => setMeetingDetails({ ...meetingDetails, agenda: e.target.value })} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Meeting link (optional — Teams, Zoom, Meet URL)</label>
                      <input className="form-input" value={meetingUrl}
                        onChange={(e) => setMeetingUrl(e.target.value)}
                        placeholder="https://teams.microsoft.com/... or https://meet.google.com/..." />
                    </div>

                    {/* Time slot picker */}
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <div className="form-label" style={{ margin: 0 }}>Pick a time</div>
                        <button className="btn btn-outline btn-sm" onClick={handleLoadSlots} disabled={loadingSlots}>
                          {loadingSlots ? <span className="spinner spinner-dark" /> : "🗓 Show free slots"}
                        </button>
                      </div>

                      {slots.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 180, overflowY: "auto", marginBottom: 10 }}>
                          {slots.slice(0, 12).map((slot, i) => (
                            <label key={i} style={{
                              display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                              padding: "6px 10px", borderRadius: 8, fontSize: 13,
                              background: selectedSlot?.start === slot.start ? "var(--primary-light)" : "var(--bg)",
                              border: `1px solid ${selectedSlot?.start === slot.start ? "var(--primary)" : "var(--border)"}`,
                            }}>
                              <input type="radio" name="slot" checked={selectedSlot?.start === slot.start}
                                onChange={() => { setSelectedSlot(slot); setManualStart(""); }} />
                              {new Date(slot.start).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} IST
                            </label>
                          ))}
                        </div>
                      )}

                      <div className="form-label">Or enter manually</div>
                      <input type="datetime-local" className="form-input" style={{ maxWidth: 240 }}
                        value={manualStart}
                        onChange={(e) => { setManualStart(e.target.value); setSelectedSlot(null); }} />
                    </div>

                    {(selectedSlot || manualStart) && (
                      <button className="btn btn-primary btn-sm" style={{ alignSelf: "flex-start" }}
                        onClick={handleCreateMeeting} disabled={creatingMeeting || !meetingDetails.attendees.length}>
                        {creatingMeeting ? <span className="spinner" /> : "Send Calendar Invite (.ics)"}
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ) : (
          <div className="mail-detail" style={{ alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 52, marginBottom: 12 }}>📧</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Select an email to read</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>AI will automatically analyse and suggest actions</div>
            </div>
          </div>
        )}
      </div>

      {/* Compose modal */}
      {showCompose && (
        <div className="modal-overlay" onClick={() => setShowCompose(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="card-header">
              <div className="card-title">New Email</div>
              <button className="btn btn-outline btn-sm" onClick={() => setShowCompose(false)}>✕</button>
            </div>
            <div className="card-body">
              {composeOk && <div className="alert alert-success" style={{ marginBottom: 12 }}>✓ Email sent!</div>}
              <div className="form-group">
                <label className="form-label">To</label>
                <input className="form-input" value={composeTo} onChange={(e) => setComposeTo(e.target.value)}
                  placeholder="email@example.com, another@example.com" />
              </div>
              <div className="form-group">
                <label className="form-label">Subject</label>
                <input className="form-input" value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Message</label>
                <textarea className="form-textarea" value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)} rows={8} />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" onClick={handleComposeSend}
                  disabled={composing || !composeTo.trim() || !composeSubject.trim()}>
                  {composing ? <span className="spinner" /> : "Send"}
                </button>
                <button className="btn btn-outline" onClick={() => setShowCompose(false)}>Discard</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
