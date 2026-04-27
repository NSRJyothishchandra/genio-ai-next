import { NextRequest } from "next/server";
import { getTodaysBirthdays, getUpcomingBirthdays, getEmployee, getEmployees } from "@/lib/employees";
import {
  createBirthdayEmailDraft,
  getBirthdayMailSettings,
  getBirthdayNotifyList,
  sendBirthdayEmail,
  updateBirthdayMailSettings,
} from "@/lib/email";
import { initScheduler } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

// Ensure scheduler starts as soon as the birthday page is first loaded
initScheduler();

function getDefaultBirthdayTarget() {
  const isRealEmail = (email: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.toLowerCase().endsWith("@test.com");
  const firstRealToday = getTodaysBirthdays().find((employee) => isRealEmail(employee.email));
  const firstRealUpcoming = getUpcomingBirthdays(30).find((employee) => isRealEmail(employee.email));
  const firstRealRecipient = getEmployees().find(
    (employee) => isRealEmail(employee.email)
  );

  return (
    firstRealToday ??
    firstRealUpcoming ??
    firstRealRecipient ?? {
      id: "BIRTHDAY_TEST",
      name: "Jyothish Chandra",
      email: "narayana.jyothishchandra@gmail.com",
      dob: new Date().toISOString().split("T")[0],
      gender: "Male",
      phone: "",
      position: "Birthday Test Contact",
      dateOfJoining: new Date().toISOString().split("T")[0],
      address: "Chennai",
      daysUntil: 0,
    }
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const upcoming = searchParams.get("upcoming");

  if (upcoming) {
    const days = parseInt(upcoming, 10) || 7;
    return Response.json({ birthdays: getUpcomingBirthdays(days) });
  }

  const today = getTodaysBirthdays();
  const sample = getDefaultBirthdayTarget();
  const draft = createBirthdayEmailDraft(sample.email, sample.name, sample.id);
  const settings = getBirthdayMailSettings();

  return Response.json({
    today,
    count: today.length,
    upcoming: getUpcomingBirthdays(7),
    notifyList: getBirthdayNotifyList(),
    recipientSettings: settings,
    sender: draft.from,
    includeEmployeeEmail:
      (process.env.BIRTHDAY_INCLUDE_EMPLOYEE_EMAIL ?? "false").toLowerCase() === "true",
    draftPreview: {
      employeeId: sample.id,
      name: sample.name,
      subject: draft.subject,
      recipients: draft.to,
      cc: draft.cc,
      previewUrl: draft.previewUrl,
      simulated: !process.env.SMTP_PASS,
    },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { employeeId, sendAll, testMode, action } = body;

  if (action === "update_recipients") {
    const settings = updateBirthdayMailSettings({
      customTo: Array.isArray(body.customTo) ? body.customTo : undefined,
      customCc: Array.isArray(body.customCc) ? body.customCc : undefined,
      excludedCc: Array.isArray(body.excludedCc) ? body.excludedCc : undefined,
    });
    const sample = getDefaultBirthdayTarget();
    const draft = createBirthdayEmailDraft(sample.email, sample.name, sample.id);
    return Response.json({
      success: true,
      recipientSettings: settings,
      notifyList: getBirthdayNotifyList(),
      draftPreview: {
        employeeId: sample.id,
        name: sample.name,
        subject: draft.subject,
        recipients: draft.to,
        cc: draft.cc,
        previewUrl: draft.previewUrl,
      },
    });
  }

  if (sendAll) {
    const birthdays = getTodaysBirthdays();
    const results = [];

    for (const employee of birthdays) {
      const result = await sendBirthdayEmail(employee.email, employee.name, employee.id);
      results.push({
        employeeId: employee.id,
        name: employee.name,
        employeeEmail: employee.email,
        sent: result.sent,
        simulated: result.simulated,
        error: result.error,
        recipients: result.draft.to,
        cc: result.draft.cc,
        draft: {
          from: result.draft.from,
          subject: result.draft.subject,
          previewUrl: result.draft.previewUrl,
          theme: result.draft.theme,
        },
      });
    }

    return Response.json({
      results,
      total: results.length,
      sent: results.filter((item) => item.sent).length,
      notifyList: getBirthdayNotifyList(),
    });
  }

  let employee: ReturnType<typeof getDefaultBirthdayTarget> | null = null;

  if (testMode) {
    employee = getDefaultBirthdayTarget();
  } else if (employeeId) {
    const emp = getEmployee(employeeId);
    if (emp) {
      employee = {
        ...emp,
        daysUntil: 0,
      } as ReturnType<typeof getDefaultBirthdayTarget>;
    }
  }

  if (!employee) {
    return Response.json({ error: "Provide employeeId or sendAll:true or testMode:true" }, { status: 400 });
  }

  const result = await sendBirthdayEmail(employee.email, employee.name, employee.id);

  return Response.json({
    sent: result.sent,
    simulated: result.simulated,
    error: result.error,
    name: employee.name,
    employeeEmail: employee.email,
    recipients: result.draft.to,
    cc: result.draft.cc,
    draft: {
      from: result.draft.from,
      subject: result.draft.subject,
      text: result.draft.text,
      previewUrl: result.draft.previewUrl,
      theme: result.draft.theme,
      cc: result.draft.cc,
    },
  });
}
