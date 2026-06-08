"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function ScheduleHeartbeat() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/birthday") {
      return;
    }

    const tick = () => {
      fetch("/api/birthday/schedule", { cache: "no-store" }).catch(() => null);
    };

    tick();
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  }, [pathname]);

  return null;
}
