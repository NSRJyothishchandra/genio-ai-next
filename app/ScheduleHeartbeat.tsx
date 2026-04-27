"use client";

import { useEffect } from "react";

export default function ScheduleHeartbeat() {
  useEffect(() => {
    const tick = () => {
      fetch("/api/birthday/schedule", { cache: "no-store" }).catch(() => null);
    };

    tick();
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  }, []);

  return null;
}
