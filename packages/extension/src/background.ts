import { LIMITS } from "@pointer/core/limits";
import type { CaptureResult, Rect, SendResult, Shot, ToBackground } from "./messages.ts";
import { BRIDGE_START_HINT, PAIR_HINT } from "./messages.ts";
import { getSettings, saveSettings } from "./settings.ts";
import { checkSite } from "./sites.ts";

type Status = "connected" | "bridge-down" | "auth-failed" | "unknown";

const COLORS: Record<Status, string> = { connected: "#16a34a", "bridge-down": "#dc2626", "auth-failed": "#d97706", unknown: "#6b7280" };
const TITLES: Record<Status, string> = {
  connected: "Pointer: connected. Click to pick an element.",
  "bridge-down": `Pointer: bridge not running. ${BRIDGE_START_HINT}`,
  "auth-failed": `Pointer: ${PAIR_HINT}`,
  unknown: "Pointer: click to pick an element.",
};

// The worker sleeps; nothing here may depend on module state surviving.
async function bridgeFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const s = await getSettings();
  return fetch(`http://127.0.0.1:${s.port}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${s.token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    signal: AbortSignal.timeout(3000),
  });
}

/** Asks the bridge for the token. Only succeeds while a pairing window is open, or for the already-paired origin. */
async function tryPair(): Promise<"paired" | "closed" | "down"> {
  const s = await getSettings();
  try {
    const r = await fetch(`http://127.0.0.1:${s.port}/pair`, { method: "POST", signal: AbortSignal.timeout(3000) });
    if (!r.ok) return "closed";
    const { token } = (await r.json()) as { token?: string };
    if (!token) return "closed";
    await saveSettings({ token });
    return "paired";
  } catch {
    return "down";
  }
}

async function setStatus(status: Status): Promise<void> {
  await chrome.action.setBadgeText({ text: status === "unknown" ? "" : "●" });
  await chrome.action.setBadgeBackgroundColor({ color: COLORS[status] });
  await chrome.action.setTitle({ title: TITLES[status] });
}

async function refreshStatus(): Promise<Status> {
  let status: Status = "bridge-down";
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await getSettings();
    if (!s.token) {
      const p = await tryPair();
      if (p === "down") break;
      if (p === "closed") {
        status = "auth-failed";
        break;
      }
      continue;
    }
    try {
      const r = await bridgeFetch("/health");
      if (r.ok) {
        status = "connected";
        break;
      }
      if (r.status !== 401 && r.status !== 403) break;
      status = "auth-failed";
      // Stale token or a new bridge: drop it and re-pair once.
      await saveSettings({ token: "" });
    } catch {
      status = "bridge-down";
      break;
    }
  }
  await setStatus(status);
  return status;
}

async function send(selections: unknown): Promise<SendResult> {
  if (!(await getSettings()).token) {
    const st = await refreshStatus(); // pairs on the way if a window is open
    if (st === "bridge-down") return { ok: false, reason: "bridge-down", message: `Bridge not running. ${BRIDGE_START_HINT}` };
    if (st !== "connected") return { ok: false, reason: "auth-failed", message: PAIR_HINT };
  }
  let res: Response;
  try {
    res = await bridgeFetch("/selection", { method: "POST", body: JSON.stringify({ selections }) });
  } catch {
    await setStatus("bridge-down");
    return { ok: false, reason: "bridge-down", message: `Bridge not running. ${BRIDGE_START_HINT}` };
  }
  if (res.status === 401 || res.status === 403) {
    await setStatus("auth-failed");
    return { ok: false, reason: "auth-failed", message: PAIR_HINT };
  }
  if (!res.ok) return { ok: false, reason: "rejected", message: `The bridge rejected the selection (${res.status}).` };
  await setStatus("connected");
  return { ok: true, count: ((await res.json()) as { count: number }).count };
}

/** Has an agent read the selection that was just sent? Answered from the bridge's health route. */
async function delivery(): Promise<{ delivered: boolean; via?: string }> {
  try {
    const r = await bridgeFetch("/health");
    const { delivered } = (await r.json()) as { delivered?: { via: string } | null };
    return delivered ? { delivered: true, via: delivered.via } : { delivered: false };
  } catch {
    return { delivered: false };
  }
}

/** One visible-tab grab (the API is rate limited), cropped per element: max 800px, under 500 KB. */
async function capture(windowId: number, rects: Rect[], dpr: number): Promise<CaptureResult> {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const shots: (Shot | null)[] = [];
    for (const rect of rects) shots.push(await crop(bitmap, rect, dpr));
    return { ok: true, shots };
  } catch {
    return { ok: false };
  }
}

async function crop(bitmap: ImageBitmap, rect: Rect, dpr: number): Promise<Shot | null> {
  const pad = 8;
  const x = Math.max(0, Math.floor((rect.x - pad) * dpr));
  const y = Math.max(0, Math.floor((rect.y - pad) * dpr));
  const w = Math.min(bitmap.width - x, Math.ceil((rect.w + pad * 2) * dpr));
  const h = Math.min(bitmap.height - y, Math.ceil((rect.h + pad * 2) * dpr));
  if (w < 2 || h < 2) return null;
  const scale = Math.min(1, 800 / Math.max(w, h));
  const ow = Math.max(1, Math.round(w * scale));
  const oh = Math.max(1, Math.round(h * scale));
  const canvas = new OffscreenCanvas(ow, oh);
  canvas.getContext("2d")!.drawImage(bitmap, x, y, w, h, 0, 0, ow, oh);
  let mime: "image/png" | "image/jpeg" = "image/png";
  let blob = await canvas.convertToBlob({ type: mime });
  for (const q of [0.85, 0.7, 0.5, 0.3]) {
    if (blob.size <= LIMITS.screenshotBytes) break;
    mime = "image/jpeg";
    blob = await canvas.convertToBlob({ type: mime, quality: q });
  }
  if (blob.size > LIMITS.screenshotBytes) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { mime, base64: btoa(bin), w: ow, h: oh };
}

async function explain(reason: string): Promise<void> {
  await chrome.action.setBadgeText({ text: "!" });
  await chrome.action.setBadgeBackgroundColor({ color: "#d97706" });
  await chrome.action.setTitle({ title: `Pointer: ${reason}` });
  try {
    await chrome.action.setPopup({ popup: `explain.html?reason=${encodeURIComponent(reason)}` });
    await chrome.action.openPopup();
  } catch {
    await chrome.action.setPopup({ popup: "" });
  }
}

export async function startPicker(tab: chrome.tabs.Tab | undefined): Promise<void> {
  if (!tab?.id) return;
  const s = await getSettings();
  const decision = checkSite(tab.url, s.siteMode, s.allowedHosts);
  if (!decision.allowed) return explain(decision.reason);
  try {
    // Content script and main-world script are injected on demand, never at page load.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["page.js"], world: "MAIN" });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tab.id, { type: "start" });
  } catch {
    await explain("Chrome would not let Pointer run on this page.");
    return;
  }
  void refreshStatus();
}

chrome.action.onClicked.addListener((tab) => void startPicker(tab));
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-picker") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await startPicker(tab);
});
chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create("status", { periodInMinutes: 1 });
  void refreshStatus();
});
chrome.runtime.onStartup.addListener(() => {
  void chrome.action.setPopup({ popup: "" });
  void refreshStatus();
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "status") void refreshStatus();
});
chrome.storage.onChanged.addListener((changes) => {
  // Pairing writes the token itself; only react to changes the user made (port, token typed by hand).
  if (Object.keys(changes).some((k) => k !== "token") || changes["token"]?.newValue) void refreshStatus();
});

chrome.runtime.onMessage.addListener((msg: ToBackground, sender, sendResponse) => {
  // Only our own content scripts and pages may talk to the worker.
  if (sender.id !== chrome.runtime.id) return false;
  switch (msg.type) {
    case "send":
      void send(msg.selections).then(sendResponse);
      return true;
    case "capture":
      if (!sender.tab?.windowId) return false;
      void capture(sender.tab.windowId, msg.rects, msg.dpr).then(sendResponse);
      return true;
    case "delivery":
      void delivery().then(sendResponse);
      return true;
    case "status":
      void refreshStatus().then((status) => sendResponse({ status }));
      return true;
    case "explain-closed":
      void chrome.action.setPopup({ popup: "" }).then(() => refreshStatus());
      return false;
    default:
      return false;
  }
});

if (process.env.POINTER_E2E === "1") {
  // Test hook, present only in the e2e build: start the picker on the tab matching a URL prefix.
  (globalThis as Record<string, unknown>)["__pointerTest"] = {
    start: async (prefix: string) => {
      const tabs = await chrome.tabs.query({});
      await startPicker(tabs.find((t) => t.url?.startsWith(prefix)));
    },
  };
}
