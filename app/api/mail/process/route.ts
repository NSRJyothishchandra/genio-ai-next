import { NextResponse } from "next/server";
import { analyzeEmail, draftEmailResponse, extractMeetingDetails } from "@/lib/mail-agent";

export async function POST(request: Request) {
  try {
    const { action, subject, body, from, instruction } = await request.json();

    if (action === "analyze") {
      const analysis = await analyzeEmail(subject || "", body || "", from || "");
      return NextResponse.json({ analysis });
    }

    if (action === "draft") {
      const draft = await draftEmailResponse(subject || "", body || "", from || "", instruction);
      return NextResponse.json({ draft });
    }

    if (action === "extract_meeting") {
      const details = await extractMeetingDetails(subject || "", body || "");
      return NextResponse.json({ details });
    }

    return NextResponse.json({ error: "Unknown action. Use: analyze | draft | extract_meeting" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
