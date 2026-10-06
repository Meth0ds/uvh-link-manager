/** User-agent is descriptive text, never evidence of identity or authorization. */
export function sessionAgentLabel(value: string | null): string {
  const raw = value ?? "";
  const browser = /Edg(?:e|A|iOS)?\//i.test(raw) ? "Edge"
    : /OPR\/|Opera\//i.test(raw) ? "Opera"
      : /Firefox\/|FxiOS\//i.test(raw) ? "Firefox"
        : /Chrome\/|CriOS\/|Chromium\//i.test(raw) ? "Chrome"
          : /Safari\//i.test(raw) && /Version\//i.test(raw) ? "Safari" : null;
  const system = /Android/i.test(raw) ? "Android"
    : /iPhone|iPad|iPod/i.test(raw) ? "iOS"
      : /CrOS/i.test(raw) ? "ChromeOS"
        : /Windows/i.test(raw) ? "Windows"
          : /Macintosh|Mac OS X/i.test(raw) ? "macOS"
            : /Linux/i.test(raw) ? "Linux" : null;
  return browser && system ? `${browser} en ${system}` : browser ?? system ?? "Dispositivo no identificado";
}
