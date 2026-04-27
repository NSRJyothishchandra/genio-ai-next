import { NextRequest } from "next/server";
import { buildFreshSchedule, getSchedule, saveSchedule, initScheduler, processBirthdaySchedule } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

// Start background scheduler when this module is first loaded
initScheduler();

export async function GET() {
  const schedule = await processBirthdaySchedule();
  return Response.json(schedule);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const current = getSchedule();
  const nextEnabled = typeof body.enabled === "boolean" ? body.enabled : current.enabled;
  const nextHour = typeof body.hour === "number" ? body.hour : current.hour;
  const nextMinute = typeof body.minute === "number" ? body.minute : current.minute;
  const updated = buildFreshSchedule({
    enabled: nextEnabled,
    hour: nextHour,
    minute: nextMinute,
  });

  saveSchedule(updated);
  return Response.json(updated);
}
