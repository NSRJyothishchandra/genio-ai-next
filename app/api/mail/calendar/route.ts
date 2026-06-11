import { NextResponse } from "next/server";
import { createCalendarNote, listCalendarNotes } from "@/lib/mail-calendar";

// Returns pre-generated free business-hour slots for the next 7 days.
// No external calendar API needed — use the manual picker or upgrade to
// MS Graph / Google Calendar when those integrations are configured.

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month") || undefined;
    const notes = listCalendarNotes(month);
    return NextResponse.json({ notes });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (body.action === "create_note") {
      if (!body.title) {
        return NextResponse.json({ error: "title is required" }, { status: 400 });
      }
      const note = createCalendarNote({
        title: body.title,
        date: body.date,
        startDateTime: body.startDateTime,
        endDateTime: body.endDateTime,
        attendees: body.attendees,
        agenda: body.agenda,
        meetingUrl: body.meetingUrl,
        source: body.source,
      });
      return NextResponse.json({
        note,
        notes: listCalendarNotes(note.date.slice(0, 7)),
      });
    }

    const { startTime, endTime, duration = 60 } = body;

    const start = startTime ? new Date(startTime) : new Date();
    const end = endTime ? new Date(endTime) : new Date(start.getTime() + 7 * 86400000);

    const slots: { start: string; end: string }[] = [];
    const cursor = new Date(start);
    const now = new Date();

    while (cursor < end && slots.length < 20) {
      const day = cursor.getDay();
      if (day !== 0 && day !== 6) {
        // Business hours 9 AM – 6 PM
        for (let h = 9; h < 18; h++) {
          for (let m = 0; m < 60; m += 30) {
            const s = new Date(cursor);
            s.setHours(h, m, 0, 0);
            if (s > now) {
              const e = new Date(s.getTime() + duration * 60000);
              slots.push({
                start: s.toISOString().slice(0, 19),
                end: e.toISOString().slice(0, 19),
              });
            }
          }
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    return NextResponse.json({ slots });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
