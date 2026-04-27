import { NextRequest } from "next/server";
import { getTodayActivities, getAllActivities, groupByCategory, secToHours, startTimer, stopTimer, getTimers, addManualActivity } from "@/lib/activity";
import Anthropic from "@anthropic-ai/sdk";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const date = searchParams.get("date") ?? undefined;
  const action = searchParams.get("action");

  if (action === "timers") return Response.json({ timers: getTimers() });

  const entries = date ? getAllActivities(date) : getTodayActivities();
  const byCategory = groupByCategory(entries);
  const totalSec = entries.reduce((s, e) => s + e.durationSec, 0);

  return Response.json({
    entries,
    byCategory,
    totalHours: secToHours(totalSec),
    totalSec,
    date: date ?? new Date().toISOString().split("T")[0],
    timers: getTimers(),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action } = body;

  if (action === "start_timer") {
    const timer = startTimer(body.task ?? "Working", body.project ?? "");
    return Response.json({ timer });
  }

  if (action === "stop_timer") {
    const timer = stopTimer(body.id);
    return Response.json({ timer });
  }

  if (action === "add_manual") {
    const entry = addManualActivity({
      title: body.title,
      app: body.app ?? "Manual",
      start: body.start,
      end: body.end,
      durationSec: body.durationSec ?? Math.round((new Date(body.end).getTime() - new Date(body.start).getTime()) / 1000),
    });
    return Response.json({ entry });
  }

  if (action === "infer_tasks") {
    const entries = getTodayActivities();
    if (!entries.length) return Response.json({ tasks: [], message: "No activity data for today" });

    if (!process.env.ANTHROPIC_API_KEY) {
      // Simple rule-based grouping without AI
      const groups = groupByCategory(entries);
      const tasks = Object.entries(groups).map(([cat, g]) => ({
        task: cat,
        category: cat,
        totalSec: g.totalSec,
        totalHours: secToHours(g.totalSec),
        apps: [...new Set(g.entries.map((e) => e.app))],
        windows: g.entries.slice(0, 3).map((e) => e.title),
        entries: g.entries,
      }));
      return Response.json({ tasks, aiInferred: false });
    }

    // Use Claude to intelligently group activities into work tasks
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const summary = Object.entries(groupByCategory(entries))
      .map(([cat, g]) => `${cat}: ${secToHours(g.totalSec)}h — Windows: ${[...new Set(g.entries.map((e) => e.title))].slice(0, 5).join(" | ")}`)
      .join("\n");

    const resp = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{ role: "user", content: `Based on today's Windows activity, group these into clear work tasks for a timesheet:\n\n${summary}\n\nReturn JSON array: [{task, category, estimatedHours, description}]. Max 8 tasks.` }],
    });

    const text = resp.content[0].type === "text" ? resp.content[0].text : "[]";
    const match = text.match(/\[[\s\S]*\]/);
    let aiTasks = [];
    try { aiTasks = JSON.parse(match?.[0] ?? "[]"); } catch { aiTasks = []; }

    return Response.json({ tasks: aiTasks, aiInferred: true, rawSummary: summary });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
