"use client";
import { useEffect, useRef } from "react";
import type { VoiceAction } from "@/app/components/VoiceButton";

export type VoiceHandler = (action: VoiceAction) => void;

/** The custom event name used by the global voice dispatcher */
export const VOICE_EVENT = "genio:voice";

/** Dispatch a voice action to whichever page is currently mounted */
export function dispatchVoiceAction(action: VoiceAction) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(VOICE_EVENT, { detail: action }));
}

/**
 * Subscribe to global voice commands dispatched by the sidebar voice button.
 * The handler is always up-to-date (ref pattern) so it safely captures state.
 */
export function useVoiceCommand(handler: VoiceHandler) {
  const ref = useRef<VoiceHandler>(handler);
  useEffect(() => { ref.current = handler; }); // keep ref fresh every render

  useEffect(() => {
    function onEvent(e: Event) {
      ref.current((e as CustomEvent<VoiceAction>).detail);
    }
    window.addEventListener(VOICE_EVENT, onEvent);
    return () => window.removeEventListener(VOICE_EVENT, onEvent);
  }, []); // mount/unmount only — ref handles freshness
}
