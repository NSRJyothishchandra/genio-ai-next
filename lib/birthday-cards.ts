export type CardTheme = "confetti" | "sunset" | "galaxy" | "garden" | "golden";

type ThemeConfig = {
  shell: string;
  shellGradient: string;
  panel: string;
  accent: string;
  textOnShell: string;
  textMain: string;
  sparkle: string;
  emojiLine: string;
};

const THEMES: Record<CardTheme, ThemeConfig> = {
  confetti: {
    shell: "#6d5efc",
    shellGradient: "linear-gradient(135deg, #6d5efc 0%, #8b5cf6 35%, #ec4899 70%, #f59e0b 100%)",
    panel: "#ffffff",
    accent: "#facc15",
    textOnShell: "#ffffff",
    textMain: "#1f2937",
    sparkle: "#fde68a",
    emojiLine: "🎉 🎂 🎈 🥳 ✨ 🎊",
  },
  sunset: {
    shell: "#f97316",
    shellGradient: "linear-gradient(135deg, #fb7185 0%, #f97316 45%, #facc15 100%)",
    panel: "#fff7ed",
    accent: "#fb7185",
    textOnShell: "#ffffff",
    textMain: "#4a1d16",
    sparkle: "#fed7aa",
    emojiLine: "🌞 🎂 🌸 🎉 ✨ 💫",
  },
  galaxy: {
    shell: "#312e81",
    shellGradient: "linear-gradient(135deg, #1e1b4b 0%, #312e81 40%, #7c3aed 75%, #ec4899 100%)",
    panel: "#eef2ff",
    accent: "#c4b5fd",
    textOnShell: "#eef2ff",
    textMain: "#1e1b4b",
    sparkle: "#c4b5fd",
    emojiLine: "🌟 🚀 🎂 ✨ 🪩 🎉",
  },
  garden: {
    shell: "#0f766e",
    shellGradient: "linear-gradient(135deg, #0f766e 0%, #14b8a6 45%, #84cc16 100%)",
    panel: "#ecfdf5",
    accent: "#34d399",
    textOnShell: "#f0fdfa",
    textMain: "#134e4a",
    sparkle: "#86efac",
    emojiLine: "🌿 🌼 🎂 🎉 ✨ 🥳",
  },
  golden: {
    shell: "#a16207",
    shellGradient: "linear-gradient(135deg, #92400e 0%, #d97706 45%, #facc15 100%)",
    panel: "#fffbeb",
    accent: "#fbbf24",
    textOnShell: "#fffbeb",
    textMain: "#78350f",
    sparkle: "#fde68a",
    emojiLine: "👑 🎂 🥂 ✨ 🎊 🎈",
  },
};

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2) || "HR";
}

function getPhotoMarkup(name: string, theme: ThemeConfig, photoSrc?: string) {
  if (photoSrc) {
    return `
      <img
        src="${photoSrc}"
        alt="${name}"
        width="96"
        height="96"
        style="display:block;width:96px;height:96px;border-radius:48px;border:4px solid ${theme.panel};object-fit:cover"
      />
    `;
  }

  return `
    <div
      style="
        width:96px;
        height:96px;
        line-height:96px;
        border-radius:48px;
        background:${theme.accent};
        color:${theme.textMain};
        font-size:30px;
        font-weight:800;
        text-align:center;
        border:4px solid ${theme.panel};
      "
    >
      ${getInitials(name)}
    </div>
  `;
}

export function getBirthdayCardContent(
  name: string,
  theme: CardTheme = "confetti",
  fromTeam = "Bonfiglioli",
  photoSrc?: string
): string {
  const t = THEMES[theme];

  return `
    <table
      role="presentation"
      cellpadding="0"
      cellspacing="0"
      border="0"
      width="100%"
      style="max-width:640px;margin:0 auto;border-collapse:collapse"
    >
      <tr>
        <td align="center" style="padding:24px 12px">
          <table
            role="presentation"
            cellpadding="0"
            cellspacing="0"
            border="0"
            width="100%"
            style="max-width:600px;border-collapse:separate;border-spacing:0;background:${t.panel};border:1px solid #e5e7eb;border-radius:24px;overflow:hidden"
          >
            <tr>
              <td align="center" style="background:${t.shellGradient};padding:32px 24px 24px">
                <div style="font-size:20px;letter-spacing:6px;color:${t.sparkle};margin-bottom:8px">
                  ✦ ✧ ✦ ✧ ✦
                </div>
                <div style="font-size:13px;letter-spacing:1px;text-transform:uppercase;color:${t.textOnShell};opacity:0.85">
                  Birthday Celebration
                </div>
                <div style="padding:18px 0 14px">${getPhotoMarkup(name, t, photoSrc)}</div>
                <div style="font-size:36px;font-weight:800;line-height:1.1;color:${t.textOnShell}">
                  Happy Birthday!
                </div>
                <div style="margin-top:8px;font-size:26px;font-weight:700;line-height:1.2;color:${t.textOnShell}">
                  ${name}
                </div>
                <div style="margin-top:12px;font-size:22px;letter-spacing:3px;color:${t.sparkle}">
                  ${t.emojiLine}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 28px 16px">
                <p style="margin:0 0 14px;font-size:18px;font-weight:700;line-height:1.5;color:${t.textMain};text-align:center">
                  Wishing you a joyful day filled with good moments, laughter, and success.
                </p>
                <p style="margin:0 0 18px;font-size:15px;line-height:1.8;color:${t.textMain};text-align:center">
                  Thank you for being an important part of our team. We hope this year brings you
                  more growth, happiness, and memorable achievements.
                </p>
                <div style="text-align:center;padding:6px 0 18px;font-size:28px;letter-spacing:8px">
                  🎁 🎊 🎂 🎈 🥳 ✨
                </div>
                <div
                  style="
                    margin:0 auto;
                    max-width:480px;
                    border-top:1px dashed #cbd5e1;
                    padding-top:18px;
                    text-align:center;
                    color:${t.textMain};
                  "
                >
                  <div style="font-size:13px;opacity:0.75">With best wishes from</div>
                  <div style="margin-top:6px;font-size:20px;font-weight:800;color:${t.shell}">
                    ${fromTeam}
                  </div>
                </div>
              </td>
            </tr>
            <tr>
              <td align="center" style="background:${t.shellGradient};padding:14px 20px;color:${t.textOnShell};font-size:16px;letter-spacing:2px">
                PARTY MODE ON • HAPPY BIRTHDAY • LET'S CELEBRATE
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

export function getBirthdayCardHtml(
  name: string,
  theme: CardTheme = "confetti",
  fromTeam = "Bonfiglioli",
  photoSrc?: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Happy Birthday, ${name}!</title>
</head>
<body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">
  ${getBirthdayCardContent(name, theme, fromTeam, photoSrc)}
</body>
</html>`;
}

export function getThemeForEmployee(employeeId: string): CardTheme {
  const themes: CardTheme[] = ["confetti", "sunset", "galaxy", "garden", "golden"];
  const index = employeeId.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % themes.length;
  return themes[index];
}
