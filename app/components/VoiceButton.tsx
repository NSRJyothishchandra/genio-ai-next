"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface VoiceAction {
  action: string;
  params: Record<string, unknown>;
  humanReadable: string;
}

interface Props {
  context: string;                                   // e.g. "mail", "birthday", "cli-agent"
  onResult: (transcript: string, action: VoiceAction) => void;
  hint?: string;                                     // shown in tooltip
  size?: "sm" | "md" | "lg";
  variant?: "fab" | "inline";                        // fab = floating, inline = inside a row
  disabled?: boolean;
}

// Narrow type for SpeechRecognition (not in lib.dom yet in all envs)
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}
interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

type State = "idle" | "recording" | "processing" | "done" | "error" | "unsupported";

export default function VoiceButton({
  context,
  onResult,
  hint,
  size = "md",
  variant = "fab",
  disabled = false,
}: Props) {
  const [state, setState] = useState<State>("idle");
  const [transcript, setTranscript] = useState("");
  const [interimText, setInterimText] = useState("");
  const [actionLabel, setActionLabel] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [showHint, setShowHint] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const finalTranscriptRef = useRef("");

  const isSupported =
    typeof window !== "undefined" &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const processTranscript = useCallback(
    async (text: string) => {
      if (!text.trim()) { setState("idle"); return; }
      setState("processing");
      setTranscript(text);
      setInterimText("");
      try {
        const res = await fetch("/api/voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: text, context }),
        });
        const data = await res.json();
        if (data.action) {
          setActionLabel(data.humanReadable || data.action);
          setState("done");
          onResult(text, data);
          setTimeout(() => { setState("idle"); setTranscript(""); setActionLabel(""); }, 3000);
        } else {
          setErrorMsg(data.error || "Could not understand command");
          setState("error");
          setTimeout(() => { setState("idle"); setErrorMsg(""); }, 3000);
        }
      } catch (e) {
        setErrorMsg(String(e));
        setState("error");
        setTimeout(() => { setState("idle"); setErrorMsg(""); }, 3000);
      }
    },
    [context, onResult]
  );

  const startRecording = useCallback(() => {
    if (!isSupported) { setState("unsupported"); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR!();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    finalTranscriptRef.current = "";

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      if (final) finalTranscriptRef.current += final;
      setInterimText(interim);
    };

    rec.onerror = () => {
      setState("error");
      setErrorMsg("Microphone error — check permissions");
      setTimeout(() => { setState("idle"); setErrorMsg(""); }, 3000);
    };

    rec.onend = () => {
      const text = finalTranscriptRef.current.trim();
      if (text) processTranscript(text);
      else setState("idle");
    };

    recognitionRef.current = rec;
    rec.start();
    setState("recording");
  }, [isSupported, processTranscript]);

  const handleClick = () => {
    if (disabled) return;
    if (state === "recording") stopRecording();
    else if (state === "idle") startRecording();
  };

  useEffect(() => () => { recognitionRef.current?.abort(); }, []);

  const iconSize = size === "sm" ? 14 : size === "lg" ? 22 : 18;
  const btnSize = size === "sm" ? 28 : size === "lg" ? 48 : 36;

  const MicIcon = () => (
    <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z"/>
    </svg>
  );

  const StopIcon = () => (
    <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2"/>
    </svg>
  );

  const SpinnerIcon = () => (
    <span className="spinner" style={{ width: iconSize, height: iconSize, borderWidth: 2 }} />
  );

  const label =
    state === "recording" ? "Stop"
    : state === "processing" ? "…"
    : state === "done" ? "✓"
    : state === "error" ? "!"
    : state === "unsupported" ? "N/A"
    : "🎤";

  const bubbleText =
    state === "recording" ? (interimText || "Listening…")
    : state === "processing" ? `Processing: "${transcript}"`
    : state === "done" ? `✓ ${actionLabel}`
    : state === "error" ? `⚠ ${errorMsg}`
    : state === "unsupported" ? "Speech not supported in this browser"
    : null;

  return (
    <div
      className={`voice-btn-wrap${variant === "fab" ? " voice-fab" : " voice-inline"}`}
      onMouseEnter={() => hint && state === "idle" && setShowHint(true)}
      onMouseLeave={() => setShowHint(false)}
    >
      {/* Bubble / transcript */}
      {bubbleText && (
        <div className={`voice-bubble${state === "done" ? " success" : state === "error" ? " error" : ""}`}>
          {state === "recording" && <span className="voice-dot" />}
          <span>{bubbleText}</span>
        </div>
      )}

      {/* Hint tooltip */}
      {showHint && hint && !bubbleText && (
        <div className="voice-hint">{hint}</div>
      )}

      {/* Button */}
      <button
        className={`voice-btn${state === "recording" ? " recording" : ""}${state === "done" ? " done" : ""}${state === "error" ? " error" : ""}`}
        style={{ width: btnSize, height: btnSize }}
        onClick={handleClick}
        disabled={disabled || state === "processing" || state === "unsupported"}
        title={hint || "Voice command"}
        aria-label="Voice command"
      >
        {state === "processing" ? <SpinnerIcon /> : state === "recording" ? <StopIcon /> : <MicIcon />}
      </button>
    </div>
  );
}
