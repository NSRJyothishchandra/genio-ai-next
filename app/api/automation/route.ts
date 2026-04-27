import { NextRequest } from "next/server";
import { getAutomationSnapshot, runAutomation, type AutomationAction } from "@/lib/automation";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(getAutomationSnapshot());
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const action = body.action as AutomationAction | undefined;

  if (!action) {
    return Response.json({ error: "Automation action is required" }, { status: 400 });
  }

  const log = runAutomation(action);
  return Response.json({
    log,
    snapshot: getAutomationSnapshot(),
  });
}
