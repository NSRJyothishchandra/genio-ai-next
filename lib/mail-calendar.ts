import fs from "fs";
import path from "path";

export interface CalendarNote {
  id: string;
  title: string;
  date: string;
  startDateTime?: string;
  endDateTime?: string;
  attendees: string[];
  agenda: string;
  meetingUrl?: string;
  source: "manual" | "voice" | "invite";
  createdAt: string;
}

const CALENDAR_FILE = path.join(process.cwd(), "data", "mail-calendar.json");

function ensureCalendarFile() {
  if (!fs.existsSync(CALENDAR_FILE)) {
    fs.writeFileSync(CALENDAR_FILE, "[]");
  }
}

function readCalendarNotes() {
  ensureCalendarFile();
  try {
    return JSON.parse(fs.readFileSync(CALENDAR_FILE, "utf-8")) as CalendarNote[];
  } catch {
    return [];
  }
}

function writeCalendarNotes(notes: CalendarNote[]) {
  ensureCalendarFile();
  fs.writeFileSync(CALENDAR_FILE, JSON.stringify(notes, null, 2));
}

function toDateOnly(value: string) {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

export function listCalendarNotes(month?: string) {
  const notes = readCalendarNotes().sort((left, right) => {
    const leftStamp = left.startDateTime || left.date;
    const rightStamp = right.startDateTime || right.date;
    return leftStamp.localeCompare(rightStamp);
  });

  if (!month) return notes;
  return notes.filter((note) => note.date.startsWith(month));
}

export function createCalendarNote(input: {
  title: string;
  date?: string;
  startDateTime?: string;
  endDateTime?: string;
  attendees?: string[];
  agenda?: string;
  meetingUrl?: string;
  source?: CalendarNote["source"];
}) {
  const notes = readCalendarNotes();
  const note: CalendarNote = {
    id: `CAL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: input.title.trim() || "Meeting",
    date: toDateOnly(input.startDateTime || input.date || ""),
    startDateTime: input.startDateTime || undefined,
    endDateTime: input.endDateTime || undefined,
    attendees: Array.isArray(input.attendees) ? input.attendees.filter(Boolean) : [],
    agenda: input.agenda?.trim() || "",
    meetingUrl: input.meetingUrl?.trim() || undefined,
    source: input.source || "manual",
    createdAt: new Date().toISOString(),
  };
  notes.push(note);
  writeCalendarNotes(notes);
  return note;
}
