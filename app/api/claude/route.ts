import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getEmployees, getTodaysBirthdays, getUpcomingBirthdays } from "@/lib/employees";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an intelligent HR assistant for Bonfiglioli, an industrial technology company.
You help HR managers with employee queries, onboarding guidance, timesheet questions, birthday reminders,
policy questions, and general HR process automation.

You have access to employee data and can answer questions about:
- Employee information and profiles
- Birthday tracking and celebrations
- Onboarding processes and document checklists
- Timesheet submission and tracking
- Leave management
- HR policies and procedures
- Performance and appraisals

Always be professional, empathetic, and helpful. For sensitive HR matters, remind users to follow company policy.
When answering with employee information, use only the provided data.
`;

export async function POST(request: NextRequest) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json({
        response:
          "I'm your HR AI assistant! To enable full AI responses, please configure your ANTHROPIC_API_KEY in .env.local. For now, here are some things I can help with:\n\n• 🎂 Birthday tracking & automated wishes\n• 📋 Employee onboarding & document collection\n• ⏰ Timesheet submission & tracking\n• 👥 Employee directory & search\n• 📊 HR analytics & reports",
      });
    }

    const body = await request.json();
    const message = body.message as string;
    const conversationHistory = (body.conversationHistory ?? []) as { role: string; content: string }[];

    const employees = getEmployees();
    const todaysBirthdays = getTodaysBirthdays();
    const upcomingBirthdays = getUpcomingBirthdays(7);

    const employeeContext = employees
      .slice(0, 50)
      .map((employee) => `${employee.name} (${employee.id}) - ${employee.position} - ${employee.email}`)
      .join("\n");

    const birthdayContext = [
      `Today's birthdays: ${todaysBirthdays.map((employee) => employee.name).join(", ") || "None"}`,
      `Upcoming birthdays: ${upcomingBirthdays.map((employee) => `${employee.name} in ${employee.daysUntil} day(s)`).join(", ") || "None"}`,
    ].join("\n");

    const prompt = `${SYSTEM_PROMPT}

Employee data:
${employeeContext}

Birthday data:
${birthdayContext}

Conversation history:
${conversationHistory.map((item) => `${item.role}: ${item.content}`).join("\n")}

User: ${message}
Assistant:`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content
        .filter((block) => block.type === "text")
        .map((block) => ("text" in block ? block.text : ""))
        .join("\n")
        .trim() || "I could not generate a response.";

    return Response.json({ response: text });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
