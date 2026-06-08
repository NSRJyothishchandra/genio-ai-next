"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { useVoiceCommand } from "@/app/hooks/useVoiceCommand";

interface Message { role: "user" | "assistant"; content: string; }
interface Employee { id: string; name: string; email: string; }

const SUGGESTIONS = [
  "Who has a birthday today?",
  "Show me upcoming birthdays this week",
  "How do I start the onboarding process?",
  "What documents are required for onboarding?",
  "How many employees do we have?",
  "Which positions have the most employees?",
  "What is the leave policy?",
  "How do I submit a timesheet?",
];

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hi! I'm your Genio AI HR assistant powered by Claude.\n\nI can help you with:\n• Birthday tracking & automated wishes\n• Employee onboarding & document collection\n• Timesheet submission & tracking\n• Employee queries & HR policies\n• HR analytics & reports\n\nWhat can I help you with today?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<{ role: string; content: string }[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [leaveForm, setLeaveForm] = useState({
    employeeId: "",
    startDate: "",
    endDate: "",
    reason: "",
  });
  const [speakReplies, setSpeakReplies] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    fetch("/api/employees", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setEmployees(data.employees ?? []));
  }, []);

  // Stop any speech when leaving the page
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Turn a chat reply into something natural to read aloud (strip markdown/bullets)
  function cleanForSpeech(text: string): string {
    return text
      .replace(/```[\s\S]*?```/g, " (code snippet) ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^[\s]*[•\-\*]\s+/gm, ". ")
      .replace(/\n{2,}/g, ". ")
      .replace(/\n/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function speak(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const clean = cleanForSpeech(text);
    if (!clean) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 1.02;
    utterance.pitch = 1;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }

  useVoiceCommand(useCallback((action) => {
    const p = action.params;
    switch (action.action) {
      case "ask":
        // Voice-asked questions always speak the answer back
        void send(String(p.message ?? ""), { spoken: true });
        break;
      case "clear_chat":
        stopSpeaking();
        setMessages([{ role: "assistant", content: "New conversation started. How can I help you?" }]);
        setHistory([]);
        break;
      case "submit_leave":
        setShowLeaveForm(true);
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }

  async function send(text?: string, options?: { spoken?: boolean }) {
    const msg = text ?? input.trim();
    if (!msg || loading) return;
    setInput("");
    setMessages((previous) => [...previous, { role: "user", content: msg }]);
    setLoading(true);

    try {
      const response = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, conversationHistory: history }),
      });
      const data = await response.json();
      const reply = data.response ?? "Sorry, I couldn't get a response.";
      setMessages((previous) => [...previous, { role: "assistant", content: reply }]);
      setHistory(data.history ?? [...history, { role: "user", content: msg }, { role: "assistant", content: reply }]);
      // Speak the answer when asked by voice, or whenever spoken replies are enabled
      if (options?.spoken || speakReplies) {
        speak(reply);
      }
    } catch {
      const reply = "Sorry, I ran into a problem reaching the assistant. Please try again.";
      setMessages((previous) => [...previous, { role: "assistant", content: reply }]);
      if (options?.spoken || speakReplies) speak(reply);
    } finally {
      setLoading(false);
    }
  }

  async function submitLeaveRequest(event: React.FormEvent) {
    event.preventDefault();
    setLeaveSubmitting(true);

    const selectedEmployee = employees.find((employee) => employee.id === leaveForm.employeeId);
    const response = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        employeeId: leaveForm.employeeId,
        kind: "leave",
        title: "Leave Request",
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

    setLeaveForm({ employeeId: "", startDate: "", endDate: "", reason: "" });
    setShowLeaveForm(false);
    showToast("Leave request submitted and draft mailed to narayana.jyothishchandra@gmail.com");

    if (selectedEmployee) {
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content:
            `Leave request drafted for ${selectedEmployee.name}.\n\n` +
            `From: ${leaveForm.startDate}\n` +
            `To: ${leaveForm.endDate}\n` +
            `Reason: ${leaveForm.reason}\n\n` +
            `The full leave request draft has been sent to narayana.jyothishchandra@gmail.com.`,
        },
      ]);
    }
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
          <div className="topbar-title">HR AI Assistant</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Powered by Claude AI</div>
        </div>
        <div className="topbar-right">
          {speaking ? (
            <button onClick={stopSpeaking} className="btn btn-outline btn-sm" title="Stop the spoken reply">
              ⏹ Stop voice
            </button>
          ) : null}
          <button
            onClick={() => { if (speakReplies) stopSpeaking(); setSpeakReplies((v) => !v); }}
            className={`btn btn-sm ${speakReplies ? "btn-primary" : "btn-outline"}`}
            title="When on, the assistant reads its answers aloud"
          >
            {speakReplies ? "🔊 Voice replies: On" : "🔈 Voice replies: Off"}
          </button>
          <button onClick={() => setShowLeaveForm((previous) => !previous)} className="btn btn-primary btn-sm">
            {showLeaveForm ? "Close Leave Form" : "Apply Leave"}
          </button>
          <button onClick={() => { stopSpeaking(); setMessages([{ role: "assistant", content: "New conversation started. How can I help you?" }]); setHistory([]); }} className="btn btn-outline btn-sm">Clear Chat</button>
        </div>
      </div>

      <div className="page-content" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 64px)", padding: 24 }}>
        {showLeaveForm ? (
          <div className="card mb-4">
            <div className="card-header">
              <div>
                <div className="card-title">Apply Leave Request</div>
                <div className="card-subtitle">This will automatically send a full leave request draft to narayana.jyothishchandra@gmail.com</div>
              </div>
            </div>
            <div className="card-body">
              <form onSubmit={submitLeaveRequest}>
                <div className="form-group">
                  <label className="form-label">Employee</label>
                  <select
                    className="form-select"
                    value={leaveForm.employeeId}
                    onChange={(event) => setLeaveForm((previous) => ({ ...previous, employeeId: event.target.value }))}
                    required
                  >
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
                    <label className="form-label">Leave Start Date</label>
                    <input
                      className="form-input"
                      type="date"
                      value={leaveForm.startDate}
                      onChange={(event) => setLeaveForm((previous) => ({ ...previous, startDate: event.target.value }))}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Leave End Date</label>
                    <input
                      className="form-input"
                      type="date"
                      value={leaveForm.endDate}
                      onChange={(event) => setLeaveForm((previous) => ({ ...previous, endDate: event.target.value }))}
                      required
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Reason</label>
                  <textarea
                    className="form-textarea"
                    value={leaveForm.reason}
                    onChange={(event) => setLeaveForm((previous) => ({ ...previous, reason: event.target.value }))}
                    placeholder="Explain the leave request clearly"
                    required
                  />
                </div>
                <button className="btn btn-primary" type="submit" disabled={leaveSubmitting}>
                  {leaveSubmitting ? "Sending..." : "Submit Leave Request"}
                </button>
              </form>
            </div>
          </div>
        ) : null}

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ flex: 1, overflowY: "auto", paddingBottom: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            {messages.map((message, index) => (
              <div key={index} style={{ display: "flex", justifyContent: message.role === "user" ? "flex-end" : "flex-start" }}>
                {message.role === "assistant" ? (
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--primary)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, marginRight: 8, flexShrink: 0, alignSelf: "flex-end" }}>AI</div>
                ) : null}
                <div className={`chat-bubble ${message.role}`} style={{ maxWidth: "72%" }}>{message.content}</div>
              </div>
            ))}
            {loading ? (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--primary)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>AI</div>
                <div className="chat-bubble assistant" style={{ padding: "12px 16px" }}>
                  <span style={{ display: "inline-flex", gap: 4 }}>
                    {[0, 1, 2].map((index) => <span key={index} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-muted)", animation: `bounce .8s ease ${index * 0.15}s infinite alternate` }} />)}
                  </span>
                </div>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

          {messages.length <= 1 ? (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8, fontWeight: 600 }}>SUGGESTED QUESTIONS</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} onClick={() => send(suggestion)} className="btn btn-outline btn-sm" style={{ fontSize: 12 }}>{suggestion}</button>
                ))}
              </div>
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="chat-input"
              placeholder="Ask anything about HR, employees, birthdays, onboarding..."
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && !event.shiftKey && send()}
              disabled={loading}
            />
            <button onClick={() => send()} className="btn btn-primary" disabled={loading || !input.trim()}>
              {loading ? <span className="spinner" /> : "Send"}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes bounce { from { transform: translateY(0); opacity:.4; } to { transform: translateY(-4px); opacity:1; } }
      `}</style>
    </>
  );
}
