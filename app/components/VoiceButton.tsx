"use client";

import { useEffect, useRef, useState } from "react";

export interface VoiceAction {
  action: string;
  params: Record<string, unknown>;
  humanReadable: string;
}

export interface VoiceControlRequest {
  channel?: string;
  type: "speak" | "speak_and_listen";
  message?: string;
  silenceMs?: number;
  maxDurationMs?: number;
}

export const VOICE_CONTROL_EVENT = "genio:voice-control";

export function requestVoiceControl(request: VoiceControlRequest) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<VoiceControlRequest>(VOICE_CONTROL_EVENT, { detail: request }));
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
  wakeCommandSilenceMs?: number;
  controlChannel?: string;
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

const MANUAL_SILENCE_MS = 5000;
const DEFAULT_WAKE_REPLY = "Yes master";
const DEFAULT_WAKE_COMMAND_SILENCE_MS = 5000;

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
  wakeCommandSilenceMs = DEFAULT_WAKE_COMMAND_SILENCE_MS,
  controlChannel,
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
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<State>("idle");
  const wakeHoldRef = useRef(false);
  // True while a hands-free conversation is in progress (set on wake/manual start,
  // cleared when a re-listen times out in silence). Drives whether we re-open the mic.
  const conversationActiveRef = useRef(false);
  // Holds the original command text while waiting for the answer to a clarifying question.
  const pendingClarifyRef = useRef<{ priorTranscript: string } | null>(null);
  const selectedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);

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

  function clearMaxDurationTimer() {
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
  }

  function resetSilenceTimer(timeoutMs: number) {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      activeRecognitionRef.current?.stop();
    }, timeoutMs);
  }

  function resetMaxDurationTimer(timeoutMs?: number) {
    clearMaxDurationTimer();
    if (!timeoutMs || timeoutMs <= 0) return;
    maxDurationTimerRef.current = setTimeout(() => {
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
    clearMaxDurationTimer();
    activeRecognitionRef.current?.stop();
  }

  function resetUiState() {
    setTranscript("");
    setInterimText("");
    setActionLabel("");
    setErrorMsg("");
  }

  function pickBestVoice(): SpeechSynthesisVoice | null {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    const english = voices.filter((v) => /^en[-_]/i.test(v.lang));
    const pool = english.length ? english : voices;
    // Prefer natural / neural voices, then well-known good defaults.
    const ranked = [
      (v: SpeechSynthesisVoice) => /natural|neural|online/i.test(v.name),
      (v: SpeechSynthesisVoice) => /google us english/i.test(v.name),
      (v: SpeechSynthesisVoice) => /google/i.test(v.name),
      (v: SpeechSynthesisVoice) => /^en-US$/i.test(v.lang),
      (v: SpeechSynthesisVoice) => v.default,
    ];
    for (const matches of ranked) {
      const found = pool.find(matches);
      if (found) return found;
    }
    return pool[0] ?? null;
  }

  // Chrome silently drops long utterances, so speak sentence-sized chunks in sequence.
  function splitForSpeech(message: string): string[] {
    const sentences = message.match(/[^.!?]+[.!?]*\s*/g) ?? [message];
    const chunks: string[] = [];
    let current = "";
    for (const sentence of sentences) {
      if (current && (current + sentence).length > 180) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current += sentence;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks.length ? chunks : [message];
  }

  async function speakText(message: string): Promise<void> {
    if (typeof window === "undefined" || !message.trim() || !("speechSynthesis" in window)) {
      return;
    }

    // Stop anything currently speaking, then speak each chunk back-to-back.
    window.speechSynthesis.cancel();
    for (const chunk of splitForSpeech(message)) {
      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(chunk);
        const voice = selectedVoiceRef.current ?? pickBestVoice();
        if (voice) {
          selectedVoiceRef.current = voice;
          utterance.voice = voice;
          utterance.lang = voice.lang;
        }
        utterance.rate = 1.02;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        utterance.onend = finish;
        utterance.onerror = finish;
        // Chrome can auto-pause the queue; resume() keeps it playing.
        window.speechSynthesis.resume();
        window.speechSynthesis.speak(utterance);
        // Safety net so the conversation never stalls if an event never fires.
        setTimeout(finish, Math.max(4000, chunk.length * 90));
      });
    }
  }

  /** Speak a message, then re-open the mic to capture the user's next words. */
  async function speakThenListen(message: string) {
    resetUiState();
    setState("wake-listening");
    setInterimText(message);
    await speakText(message);
    startRecording({
      silenceMs: wakeCommandSilenceMs,
      maxDurationMs: wakeSilenceMs,
      fromWakeWord: true,
    });
  }

  /** Reset to idle after a delay, but only if we're still showing a terminal bubble. */
  function scheduleIdleReset(ms = 2500) {
    setTimeout(() => {
      if (stateRef.current === "done" || stateRef.current === "error") {
        setState("idle");
        resetUiState();
      }
    }, ms);
  }

  async function processTranscript(text: string) {
    if (!text.trim()) {
      conversationActiveRef.current = false;
      setState("idle");
      queueWakeWordResume();
      return;
    }

    setState("processing");
    setTranscript(text);
    setInterimText("");

    // Carry forward the original command if this is the answer to a clarifying question.
    const clarifyContext = pendingClarifyRef.current;
    pendingClarifyRef.current = null;

    try {
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text, context, clarifyContext: clarifyContext ?? undefined }),
      });
      const data = await res.json();

      // The assistant needs more info — speak the question and listen for the answer.
      if (data.action === "clarify") {
        pendingClarifyRef.current = {
          priorTranscript: clarifyContext ? `${clarifyContext.priorTranscript}. ${text}` : text,
        };
        conversationActiveRef.current = true;
        setActionLabel(data.humanReadable || "Need more info");
        await speakThenListen(data.speech || "Could you give me a little more detail?");
        return;
      }

      if (data.action && data.action !== "unknown") {
        setActionLabel(data.humanReadable || data.action);
        setState("done");
        onResult(text, data);

        // Navigation hands off to GlobalVoiceButton, which speaks the destination's
        // capabilities and re-opens the mic after the route change — don't double up here.
        if (data.action === "navigate" || data.action === "navigate_with_action") {
          scheduleIdleReset();
          return;
        }

        const confirmation = data.speech || data.humanReadable || "Done.";
        if (conversationActiveRef.current) {
          await speakThenListen(confirmation);
        } else {
          await speakText(confirmation);
          scheduleIdleReset();
          queueWakeWordResume();
        }
        return;
      }

      // Not understood — apologise and ask again, keeping the conversation open.
      const retryMessage = data.speech || "Sorry, I didn't catch that. Could you say it again?";
      setErrorMsg(data.humanReadable || data.error || "Command not understood");
      if (conversationActiveRef.current) {
        await speakThenListen(retryMessage);
      } else {
        setState("error");
        await speakText(retryMessage);
        scheduleIdleReset();
        queueWakeWordResume();
      }
    } catch (e) {
      conversationActiveRef.current = false;
      setErrorMsg(String(e));
      setState("error");
      scheduleIdleReset();
      queueWakeWordResume();
    }
  }

  function startRecording(options?: { silenceMs?: number; maxDurationMs?: number; fromWakeWord?: boolean }) {
    const silenceMs = options?.silenceMs ?? MANUAL_SILENCE_MS;
    const maxDurationMs = options?.maxDurationMs;

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
      clearMaxDurationTimer();
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
      clearMaxDurationTimer();
      activeRecognitionRef.current = null;
      const text = latestTranscriptRef.current.trim();
      if (text) {
        void processTranscript(text);
      } else {
        // Silence ended the turn — close the conversation and listen for the wake word again.
        conversationActiveRef.current = false;
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
    resetMaxDurationTimer(maxDurationMs);
  }

  async function activateWakeCapture() {
    conversationActiveRef.current = true;
    resetUiState();
    setState("wake-listening");
    await speakText(wakeReply);
    startRecording({
      silenceMs: wakeCommandSilenceMs,
      maxDurationMs: wakeSilenceMs,
      fromWakeWord: true,
    });
  }

  function handleClick() {
    if (disabled) return;
    if (state === "recording") {
      conversationActiveRef.current = false;
      stopRecording();
      return;
    }
    conversationActiveRef.current = true;
    startRecording();
  }

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Voices can load asynchronously; cache the best one as soon as they're available.
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const updateVoice = () => {
      const voice = pickBestVoice();
      if (voice) selectedVoiceRef.current = voice;
    };
    updateVoice();
    window.speechSynthesis.addEventListener?.("voiceschanged", updateVoice);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", updateVoice);
  }, []);

  useEffect(() => {
    if (!controlChannel || !isSupported) return;

    function onControl(event: Event) {
      const detail = (event as CustomEvent<VoiceControlRequest>).detail;
      if (!detail || detail.channel !== controlChannel || disabled) return;

      if (detail.type === "speak") {
        void speakText(detail.message ?? "");
        return;
      }

      if (detail.type === "speak_and_listen") {
        conversationActiveRef.current = true;
        void (async () => {
          resetUiState();
          setState("wake-listening");
          setInterimText(detail.message ?? "");
          await speakText(detail.message ?? "");
          startRecording({
            silenceMs: detail.silenceMs ?? wakeCommandSilenceMs,
            maxDurationMs: detail.maxDurationMs ?? wakeSilenceMs,
            fromWakeWord: true,
          });
        })();
      }
    }

    window.addEventListener(VOICE_CONTROL_EVENT, onControl);
    return () => window.removeEventListener(VOICE_CONTROL_EVENT, onControl);
  }, [controlChannel, disabled, isSupported, wakeCommandSilenceMs, wakeSilenceMs]);

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
      clearMaxDurationTimer();
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
    state === "wake-listening" ? (interimText || 'Waiting for "Genius"...')
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
