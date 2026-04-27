import { NextRequest } from "next/server";
import { getBirthdayCardHtml, type CardTheme } from "@/lib/birthday-cards";
import { getEmployee } from "@/lib/employees";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const name = searchParams.get("name") ?? "Friend";
  const theme = (searchParams.get("theme") ?? "confetti") as CardTheme;
  const employeeId = searchParams.get("id");

  // Look up employee photo for preview if employee ID provided
  let photoSrc: string | undefined;
  if (employeeId) {
    const emp = getEmployee(employeeId);
    if (emp?.photoUrl) {
      // Use absolute URL for the preview iframe
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
      photoSrc = `${appUrl}${emp.photoUrl}`;
    }
  }

  const html = getBirthdayCardHtml(name, theme, "Bonfiglioli", photoSrc);
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
