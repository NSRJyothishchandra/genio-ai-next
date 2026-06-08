import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getEmployees, getTodaysBirthdays, getUpcomingBirthdays } from "@/lib/employees";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are Genio AI, a helpful and knowledgeable assistant for Bonfiglioli, an industrial technology company.

You are a GENERAL-PURPOSE assistant: answer ANY question the user asks — general knowledge, technology,
definitions, explanations, coding, math, science, current concepts, "what is X", "how does Y work", etc.
For example, if the user asks "what is n8n", explain that n8n is an open-source workflow automation tool,
and give useful detail. Never refuse a question just because it is not about HR.

You ALSO have special access to this company's HR data and can help with:
- Employee information and profiles
- Birthday tracking and celebrations
- Onboarding processes and document checklists
- Timesheet submission and tracking
- Leave management, HR policies, performance and appraisals

Guidelines:
- Answer directly and helpfully. Be clear and concise — your answers may be read aloud by text-to-speech,
  so prefer plain sentences over heavy markdown, long bullet lists, or code blocks unless specifically asked.
- When answering with employee information, use only the provided company data.
- Be professional, friendly, and accurate. If you are unsure, say so honestly.
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
