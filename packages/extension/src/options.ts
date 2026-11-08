import { getSettings, saveSettings } from "./settings.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const MESSAGES: Record<string, { text: string; fix?: string }> = {
  connected: { text: "✓ Ready. Press Alt+Shift+P on any page and click an element." },
  "bridge-down": { text: "✗ Can't reach your agent.", fix: "Open Claude Code or Codex (it starts the bridge). If you haven't set Pointer up yet, run: npx pointer-bridge setup" },
  "auth-failed": { text: "✗ Not paired with your agent yet.", fix: "Run: npx pointer-bridge doctor, then press Check again." },
  unknown: { text: "Unknown." },
};

async function load(): Promise<void> {
  const s = await getSettings();
  $<HTMLInputElement>("token").value = s.token;
  $<HTMLInputElement>("port").value = String(s.port);
  $<HTMLInputElement>("screenshots").checked = s.screenshots;
  $<HTMLTextAreaElement>("hosts").value = s.allowedHosts.join("\n");
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) r.checked = r.value === s.siteMode;
}

async function save(): Promise<void> {
  const port = Number($<HTMLInputElement>("port").value);
  const mode = document.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value;
  await saveSettings({
    token: $<HTMLInputElement>("token").value.trim(),
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 7391,
    screenshots: $<HTMLInputElement>("screenshots").checked,
    siteMode: mode === "allowlist" ? "allowlist" : "sensitive-blocked",
    allowedHosts: $<HTMLTextAreaElement>("hosts").value.split("\n").map((h) => h.trim()).filter(Boolean),
  });
  $("status").textContent = "Saved.";
}

async function test(): Promise<void> {
  $("status").textContent = "Checking…";
  const r = (await chrome.runtime.sendMessage({ type: "status" })) as { status: string };
  const m = MESSAGES[r.status] ?? MESSAGES["unknown"]!;
  $("status").textContent = m.text;
  $("fix").textContent = m.fix ?? "";
}

$("save").addEventListener("click", () => void save().then(test));
$("test").addEventListener("click", () => void test());
void load().then(test);
