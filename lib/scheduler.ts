import fs from "fs";
import path from "path";

export interface ScheduleConfig {
  enabled: boolean;
  hour: number;
  minute: number;
  lastSentDate: string;
  lastSentAt: string;
  startOnDate: string;
}

const SCHEDULE_FILE = path.join(process.cwd(), "data", "schedule.json");
const SCHEDULE_TIMEZONE = process.env.BIRTHDAY_SCHEDULE_TIMEZONE ?? "Asia/Kolkata";

function getDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHEDULE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  ) as Record<string, string>;

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parseInt(parts.hour ?? "0", 10),
    minute: parseInt(parts.minute ?? "0", 10),
  };
}

function getNextDate(dateText: string) {
  const [year, month, day] = dateText.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function ensureScheduleFile() {
  const dir = path.dirname(SCHEDULE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(SCHEDULE_FILE)) {
    fs.writeFileSync(
      SCHEDULE_FILE,
      JSON.stringify({ enabled: false, hour: 9, minute: 0, lastSentDate: "", lastSentAt: "", startOnDate: "" }, null, 2)
    );
  }
}

export function getSchedule(): ScheduleConfig {
  ensureScheduleFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(SCHEDULE_FILE, "utf-8")) as Partial<ScheduleConfig>;
    return {
      enabled: parsed.enabled ?? false,
      hour: parsed.hour ?? 9,
      minute: parsed.minute ?? 0,
      lastSentDate: parsed.lastSentDate ?? "",
      lastSentAt: parsed.lastSentAt ?? "",
      startOnDate: parsed.startOnDate ?? "",
    };
  } catch {
    return { enabled: false, hour: 9, minute: 0, lastSentDate: "", lastSentAt: "", startOnDate: "" };
  }
}

export function saveSchedule(config: ScheduleConfig): void {
  ensureScheduleFile();
  fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(config, null, 2));
}

export function buildFreshSchedule(config: Pick<ScheduleConfig, "enabled" | "hour" | "minute">): ScheduleConfig {
  const now = getDateParts();
  const scheduledMinuteOfDay = config.hour * 60 + config.minute;
  const currentMinuteOfDay = now.hour * 60 + now.minute;
  const startOnDate =
    !config.enabled
      ? ""
      : scheduledMinuteOfDay >= currentMinuteOfDay
        ? now.date
        : getNextDate(now.date);

  return {
    enabled: config.enabled,
    hour: config.hour,
    minute: config.minute,
    lastSentDate: "",
    lastSentAt: "",
    startOnDate,
  };
}

async function runBirthdaySend() {
  const { getTodaysBirthdays } = await import("./employees");
  const { sendBirthdayEmail } = await import("./email");
  const birthdays = getTodaysBirthdays();

  for (const employee of birthdays) {
    await sendBirthdayEmail(employee.email, employee.name, employee.id);
  }
}

let tickInProgress = false;

export async function processBirthdaySchedule() {
  if (tickInProgress) {
    return getSchedule();
  }

  tickInProgress = true;
  try {
    const config = getSchedule();
    if (!config.enabled) return config;

    const now = getDateParts();
    const scheduledMinuteOfDay = config.hour * 60 + config.minute;
    const currentMinuteOfDay = now.hour * 60 + now.minute;

    if (config.lastSentDate === now.date) {
      return config;
    }

    if (config.startOnDate && now.date < config.startOnDate) {
      return config;
    }

    if (currentMinuteOfDay >= scheduledMinuteOfDay) {
      await runBirthdaySend();
      const updated = {
        ...config,
        lastSentDate: now.date,
        lastSentAt: new Date().toISOString(),
      };
      saveSchedule(updated);
      return updated;
    }

    return config;
  } finally {
    tickInProgress = false;
  }
}

let started = false;

export function initScheduler(): void {
  if (started) return;
  started = true;

  void processBirthdaySchedule();

  setInterval(() => {
    void processBirthdaySchedule();
  }, 60_000);
}
