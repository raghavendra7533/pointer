export interface Settings {
  port: number;
  token: string;
  screenshots: boolean;
  /** "sensitive-blocked": everywhere except banking/mail style sites. "allowlist": only listed hosts. */
  siteMode: "sensitive-blocked" | "allowlist";
  allowedHosts: string[];
}

export const DEFAULTS: Settings = { port: 7391, token: "", screenshots: true, siteMode: "sensitive-blocked", allowedHosts: [] };

export async function getSettings(): Promise<Settings> {
  const raw = (await chrome.storage.local.get(DEFAULTS as unknown as Record<string, unknown>)) as unknown as Settings;
  return { ...DEFAULTS, ...raw };
}

export async function saveSettings(s: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(s);
}
