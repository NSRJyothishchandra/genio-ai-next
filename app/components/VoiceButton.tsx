"use client";

import { useEffect, useRef, useState } from "react";

export interface VoiceAction {
  action: string;
  params: Record<string, unknown>;
  humanReadable: string;
}

interface Props {
  context: string;
  onResult: (transcript: string, action: VoiceAction) => void;
  hint?: string;
  size?: "sm" | "md" | "lg";
  variant?: "fab" | "inline";
  disabled?: boolean;
  enableWakeWord?: boolean;
  wakePhrases?: string[];
  wakeReply?: string;
  wakeSilenceMs?: number;
}

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

type State = "idle" | "wake-listening" | "recording" | "processing" | "done" | "error" | "unsupported";

const MANUAL_SILENCE_MS = 2000;
const DEFAULT_WAKE_REPLY = "Yes master";

function normalizePhrase(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export default function VoiceButton({
  context,
  onResult,
  hint,
  size = "md",
  variant = "fab",
  disabled = false,
  enableWakeWord = false,
  wakePhrases = ["genius"],
  wakeReply = DEFAULT_WAKE_REPLY,
  wakeSilenceMs = 60000,
}: Props) {
  const [state, setState] = useState<State>("idle");
  const [transcript, setTranscript] = useState("");
  const [interimText, setInterimText] = useState("");
  const [actionLabel, setActionLabel] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [showHint, setShowHint] = useState(false);

  const activeRecognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const wakeRecognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const finalTranscriptRef = useRef("");
  const latestTranscriptRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<State>("idle");
  const wakeHoldRef = useRef(false);

  const isSupported =
    typeof window !== "undefined" &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const normalizedWakePhrases = wakePhrases
    .map((phrase) => normalizePhrase(phrase))
    .filter(Boolean);

  function clearSilenceTimer() {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }

  function clearWakeRestartTimer() {
    if (wakeRestartTimerRef.current) {
      clearTimeout(wakeRestartTimerRef.current);
      wakeRestartTimerRef.current = null;
    }
  }

  function resetSilenceTimer(timeoutMs: number) {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      activeRecognitionRef.current?.stop();
    }, timeoutMs);
  }

  function matchesWakePhrase(value: string): boolean {
    const normalized = normalizePhrase(value);
    return normalizedWakePhrases.some((phrase) => normalized.includes(phrase));
  }

  function pauseWakeWord() {
    wakeHoldRef.current = true;
    clearWakeRestartTimer();
    if (wakeRecognitionRef.current) {
      const rec = wakeRecognitionRef.current;
      wakeRecognitionRef.current = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {}
    }
    if (stateRef.current === "wake-listening") {
      setState("idle");
    }
  }

  function startWakeListening() {
    if (!enableWakeWord || disabled || !isSupported || wakeHoldRef.current) return;
    if (wakeRecognitionRef.current || activeRecognitionRef.current || stateRef.current === "processing") return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const rec = new SR();
    let wakeTriggered = false;

    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let heard = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        heard += `${e.results[i][0].transcript} `;
      }

      if (heard && matchesWakePhrase(heard)) {
        wakeTriggered = true;
        pauseWakeWord();
        void activateWakeCapture();
      }
    };

    rec.onerror = () => {
      wakeRecognitionRef.current = null;
      if (!wakeHoldRef.current) {
        queueWakeWordResume(1500);
      }
    };

    rec.onend = () => {
      wakeRecognitionRef.current = null;
      if (!wakeHoldRef.current && !activeRecognitionRef.current && stateRef.current !== "processing" && !wakeTriggered) {
        queueWakeWordResume(1000);
      }
    };

    try {
      wakeRecognitionRef.current = rec;
      rec.start();
      if (stateRef.current === "idle") {
        setState("wake-listening");
      }
    } catch {
      wakeRecognitionRef.current = null;
    }
  }

  function queueWakeWordResume(delay = 900) {
    if (!enableWakeWord || disabled || !isSupported) return;
    wakeHoldRef.current = false;
    clearWakeRestartTimer();
    wakeRestartTimerRef.current = setTimeout(() => {
      if (!wakeHoldRef.current) {
        startWakeListening();
      }
    }, delay);
  }

  function stopRecording() {
    clearSilenceTimer();
    activeRecognitionRef.current?.stop();
  }

  function resetUiState() {
    setTranscript("");
    setInterimText("");
    setActionLabel("");
    setErrorMsg("");
  }

  async function speakWakeReply(): Promise<void> {
    if (typeof window === "undefined" || !wakeReply.trim() || !("speechSynthesis" in window)) {
      return;
    }

    await new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(wakeReply);
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    });
  }

  async function processTranscript(text: string) {
    if (!text.trim()) {
      setState("idle");
      queueWakeWordResume();
      return;
    }

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
      if (data.action && data.action !== "unknown") {
        setActionLabel(data.humanReadable || data.action);
        setState("done");
        onResult(text, data);
        setTimeout(() => {
          setState("idle");
          resetUiState();
        }, 3000);
      } else if (data.action === "unknown") {
        setErrorMsg(data.humanReadable || "Command not understood");
        setState("error");
        setTimeout(() => {
          setState("idle");
          resetUiState();
        }, 3000);
      } else {
        setErrorMsg(data.error || "Could not understand command");
        setState("error");
        setTimeout(() => {
          setState("idle");
          resetUiState();
        }, 3000);
      }
    } catch (e) {
      setErrorMsg(String(e));
      setState("error");
      setTimeout(() => {
        setState("idle");
        resetUiState();
      }, 3000);
    } finally {
      queueWakeWordResume();
    }
  }

  function startRecording(options?: { silenceMs?: number; fromWakeWord?: boolean }) {
    const silenceMs = options?.silenceMs ?? MANUAL_SILENCE_MS;

    if (!isSupported) {
      setState("unsupported");
      return;
    }

    pauseWakeWord();

    if (activeRecognitionRef.current) {
      try {
        activeRecognitionRef.current.abort();
      } catch {}
      activeRecognitionRef.current = null;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setState("unsupported");
      return;
    }

    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    finalTranscriptRef.current = "";
    latestTranscriptRef.current = "";

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = "";
      let finalChunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const value = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalChunk += value;
        else interim += value;
      }
      if (finalChunk) {
        finalTranscriptRef.current = `${finalTranscriptRef.current} ${finalChunk}`.trim();
      }
      latestTranscriptRef.current = `${finalTranscriptRef.current} ${interim}`.trim();
      setInterimText(latestTranscriptRef.current || (options?.fromWakeWord ? "Listening for your command..." : "Listening..."));
      resetSilenceTimer(silenceMs);
    };

    rec.onerror = () => {
      clearSilenceTimer();
      activeRecognitionRef.current = null;
      setState("error");
      setErrorMsg("Microphone error - check permissions");
      setTimeout(() => {
        setState("idle");
        resetUiState();
      }, 3000);
      queueWakeWordResume();
    };

    rec.onend = () => {
      clearSilenceTimer();
      activeRecognitionRef.current = null;
      const text = latestTranscriptRef.current.trim();
      if (text) {
        void processTranscript(text);
      } else {
        setState("idle");
        resetUiState();
        queueWakeWordResume();
      }
    };

    activeRecognitionRef.current = rec;
    rec.start();
    setState("recording");
    setTranscript("");
    setActionLabel("");
    setErrorMsg("");
    setInterimText(options?.fromWakeWord ? "Listening for your command..." : "");
    resetSilenceTimer(silenceMs);
  }

  async function activateWakeCapture() {
    resetUiState();
    setState("wake-listening");
    await speakWakeReply();
    startRecording({ silenceMs: wakeSilenceMs, fromWakeWord: true });
  }

  function handleClick() {
    if (disabled) return;
    if (state === "recording") {
      stopRecording();
      return;
    }
    startRecording();
  }

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!isSupported) {
      setState("unsupported");
      return;
    }

    if (enableWakeWord && !disabled) {
      queueWakeWordResume(250);
    } else {
      pauseWakeWord();
    }

    return () => {
      clearSilenceTimer();
      clearWakeRestartTimer();
      wakeHoldRef.current = true;
      if (activeRecognitionRef.current) {
        const r = activeRecognitionRef.current;
        activeRecognitionRef.current = null;
        r.onresult = null; r.onerror = null; r.onend = null;
        try { r.abort(); } catch {}
      }
      if (wakeRecognitionRef.current) {
        const r = wakeRecognitionRef.current;
        wakeRecognitionRef.current = null;
        r.onresult = null; r.onerror = null; r.onend = null;
        try { r.abort(); } catch {}
      }
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [enableWakeWord, disabled, isSupported]);

  const iconSize = size === "sm" ? 14 : size === "lg" ? 22 : 18;
  const btnSize = size === "sm" ? 28 : size === "lg" ? 48 : 36;
  const isVoiceActive = state === "wake-listening" || state === "recording";
  const showVisualizer = isVoiceActive || state === "processing";
  const visualizerClassName =
    state === "wake-listening"
      ? "voice-visualizer wake"
      : state === "recording"
        ? "voice-visualizer recording"
        : "voice-visualizer processing";

  const MicIcon = () => (
    <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z" />
    </svg>
  );

  const StopIcon = () => (
    <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );

  const SpinnerIcon = () => (
    <span className="spinner" style={{ width: iconSize, height: iconSize, borderWidth: 2 }} />
  );

  const bubbleText =
    state === "wake-listening" ? 'Waiting for "Genius"...'
      : state === "recording" ? (interimText || "Listening...")
      : state === "processing" ? `Processing: "${transcript}"`
      : state === "done" ? `✓ ${actionLabel}`
      : state === "error" ? `⚠ ${errorMsg}`
      : state === "unsupported" ? "Speech not supported in this browser"
      : null;

  return (
    <div
      className={`voice-btn-wrap${variant === "fab" ? " voice-fab" : " voice-inline"}`}
      onMouseEnter={() => hint && (state === "idle" || state === "wake-listening") && setShowHint(true)}
      onMouseLeave={() => setShowHint(false)}
    >
      {bubbleText && (
        <div className={`voice-bubble${state === "done" ? " success" : state === "error" ? " error" : ""}`}>
          {isVoiceActive && <span className="voice-dot" />}
          {showVisualizer && (
            <span className={visualizerClassName} aria-hidden="true">
              <span className="voice-bar" />
              <span className="voice-bar" />
              <span className="voice-bar" />
              <span className="voice-bar" />
            </span>
          )}
          <span>{bubbleText}</span>
        </div>
      )}

      {showHint && hint && !bubbleText && (
        <div className="voice-hint">{hint}</div>
      )}

      <button
        className={`voice-btn${state === "recording" ? " recording" : ""}${state === "done" ? " done" : ""}${state === "error" ? " error" : ""}${state === "wake-listening" ? " wake-ready" : ""}`}
        style={{ width: btnSize, height: btnSize }}
        onClick={handleClick}
        disabled={disabled || state === "processing" || state === "unsupported"}
        title={hint || "Voice command"}
        aria-label="Voice command"
      >
        {showVisualizer && (
          <span className={`${visualizerClassName} button`} aria-hidden="true">
            <span className="voice-bar" />
            <span className="voice-bar" />
            <span className="voice-bar" />
            <span className="voice-bar" />
          </span>
        )}
        {state === "processing" ? <SpinnerIcon /> : state === "recording" ? <StopIcon /> : <MicIcon />}
      </button>
    </div>
  );
}
