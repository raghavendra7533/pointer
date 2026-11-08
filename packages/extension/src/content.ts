import { formatSelections } from "@pointer/core/format";
import { LIMITS } from "@pointer/core/limits";
import { buildSelector, shortLabel } from "@pointer/core/selector";
import { collectAttributes, sanitizeUrl, serializeElement, truncate, visibleText } from "@pointer/core/sanitize";
import type { Confidence, Selection, SourceComponent } from "@pointer/core/types";
import { pickPageFile, type Route } from "./page/route.ts";
import type { CaptureResult, Rect, SendResult, ToBackground, ToContent } from "./messages.ts";
import { getSettings } from "./settings.ts";

declare global {
  interface Window {
    __pointerContentLoaded?: boolean;
  }
}

// ---------------------------------------------------------------- types and state

interface Picked {
  el: Element;
}

interface Source {
  framework: string;
  confidence: Confidence;
  components: SourceComponent[];
  route?: Route;
}

const STYLE_PROPS = [
  "color", "backgroundColor", "display", "position", "width", "height", "margin", "padding", "border", "borderRadius",
  "boxShadow", "opacity", "overflow", "flexDirection", "justifyContent", "alignItems", "gap", "zIndex", "textAlign", "fontSize",
] as const;

const BLOCKED_EVENTS = ["mousedown", "mouseup", "pointerdown", "pointerup", "auxclick", "dblclick", "contextmenu", "touchstart", "touchend"];

let active = false;
let hovered: Element | null = null;
let descendStack: Element[] = [];
let picked: Picked[] = [];
let lastSent: Selection[] = [];
let raf = 0;
let labelTimer = 0;
let toastTimer = 0;

// ---------------------------------------------------------------- UI (closed shadow root so page CSS cannot touch it)

const host = document.createElement("pointer-ui");
host.setAttribute("style", "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; display: none;");
const shadow = host.attachShadow({ mode: "closed" });
shadow.innerHTML = `
<style>
  :host, * { box-sizing: border-box; }
  .box { position: fixed; left: 0; top: 0; pointer-events: none; display: none; outline: 2px solid #2563eb; box-shadow: 0 0 0 2px #fff, 0 0 0 3px rgba(0,0,0,.4); background: rgba(37,99,235,.16); border-radius: 2px; }
  .box.picked { outline-color: #16a34a; background: rgba(22,163,74,.14); }
  .label { position: absolute; left: -2px; bottom: calc(100% + 6px); max-width: 60vw; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font: 600 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: #fff; background: #111827; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,.7); }
  .label.below { bottom: auto; top: calc(100% + 6px); }
  .panel { position: fixed; pointer-events: auto; font: 13px/1.4 system-ui, -apple-system, sans-serif; color: #111827; background: #fff; border: 1px solid #d1d5db; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.25); }
  .tray { right: 16px; bottom: 16px; padding: 8px; display: none; max-width: min(420px, calc(100vw - 32px)); }
  .tray .hint { margin: 6px 2px 0; font-size: 11.5px; color: #4b5563; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 4px 2px 8px; background: #eff6ff; color: #1e3a8a; border: 1px solid #bfdbfe; border-radius: 999px; font: 12px ui-monospace, monospace; }
  .chip button { all: unset; cursor: pointer; padding: 0 5px; border-radius: 50%; }
  .toast { left: 50%; bottom: 20px; transform: translateX(-50%); padding: 10px 12px; display: none; width: min(460px, calc(100vw - 32px)); }
  .toast.err { border-color: #fca5a5; background: #fef2f2; color: #7f1d1d; }
  .status { margin-top: 4px; font-size: 12px; color: #4b5563; }
  .status.ok { color: #15803d; font-weight: 600; }
  .toast code { font: 12px ui-monospace, monospace; background: rgba(0,0,0,.07); padding: 1px 4px; border-radius: 4px; }
  .row { display: flex; gap: 8px; margin-top: 8px; }
  input { flex: 1; min-width: 0; font: inherit; padding: 6px 8px; border: 1px solid #9ca3af; border-radius: 6px; color: #111827; background: #fff; }
  button.link { all: unset; margin-top: 6px; font-size: 12px; color: #2563eb; text-decoration: underline; cursor: pointer; }
  button.close { all: unset; position: absolute; right: 8px; top: 6px; cursor: pointer; padding: 2px 6px; border-radius: 4px; }
  :focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
  @media (prefers-color-scheme: dark) {
    .panel { color: #e5e7eb; background: #111827; border-color: #374151; }
    .toast.err { background: #450a0a; color: #fecaca; border-color: #7f1d1d; }
    .chip { background: #1e3a8a; color: #dbeafe; border-color: #1d4ed8; }
    .tray .hint { color: #9ca3af; }
    input { background: #1f2937; color: #f3f4f6; border-color: #4b5563; }
    button.link { color: #93c5fd; }
    .toast code { background: rgba(255,255,255,.12); }
    .status { color: #9ca3af; }
    .status.ok { color: #4ade80; }
  }
</style>
<div class="box" id="hover"><div class="label" id="label"></div></div>
<div id="pickedBoxes"></div>
<div class="panel tray" id="tray" role="region" aria-label="Pointer selection tray"><div class="chips" id="chips"></div><div class="hint">Shift-click to add · Enter to send · Esc to cancel</div></div>
<div class="panel toast" id="toast" role="status" aria-live="polite">
  <button class="close" id="toastClose" aria-label="Dismiss">×</button>
  <div id="toastMsg"></div>
  <div id="toastStatus" class="status"></div>
  <div class="row" id="toastRow">
    <input id="note" type="text" maxlength="${LIMITS.note}" placeholder="Optional: add an instruction, then Enter" aria-label="Instruction for the agent">
  </div>
  <button class="link" id="copy">Copy as prompt instead</button>
</div>`;

const $ = <T extends HTMLElement>(id: string) => shadow.getElementById(id) as T;
const hoverBox = $("hover");
const labelEl = $("label");
const tray = $("tray");
const toast = $("toast");

// ---------------------------------------------------------------- source resolution via the main-world script

const pending = new Map<string, (r: Source | null) => void>();

window.addEventListener("message", (e: MessageEvent) => {
  const d = e.data as { type?: string; nonce?: string; result?: unknown } | null;
  if (e.source !== window || d?.type !== "pointer:source" || typeof d.nonce !== "string") return;
  const done = pending.get(d.nonce);
  if (!done) return; // one-shot: unknown or already-answered nonces are ignored
  pending.delete(d.nonce);
  const src = normalizeSource(d.result) ?? { framework: "none", confidence: "none" as Confidence, components: [] };
  const route = normalizeRoute((d as { route?: unknown }).route);
  done(route ? { ...src, route } : src);
});

/** Everything from the page world is untrusted: clamp shapes and recompute confidence ourselves. */
function normalizeSource(raw: unknown): Source | null {
  const r = raw as { framework?: unknown; components?: unknown } | null;
  if (!r || !Array.isArray(r.components)) return null;
  const components: SourceComponent[] = [];
  for (const c of r.components.slice(0, LIMITS.components)) {
    if (!c || typeof c.name !== "string" || !c.name) continue;
    const out: SourceComponent = { name: truncate(c.name, 120) };
    if (typeof c.file === "string" && c.file) out.file = truncate(c.file, 500);
    if (Number.isInteger(c.line) && c.line >= 0) out.line = c.line;
    if (Number.isInteger(c.column) && c.column >= 0) out.column = c.column;
    components.push(out);
  }
  const framework = typeof r.framework === "string" ? truncate(r.framework, 40) : "none";
  const confidence: Confidence = !components.length ? "none" : components[0]?.file ? "exact" : "component-only";
  return { framework: components.length ? framework : "none", confidence, components };
}

function normalizeRoute(raw: unknown): Route | null {
  const r = raw as { file?: unknown; inferred?: unknown } | null;
  if (!r || typeof r.file !== "string" || !r.file) return null;
  return { file: truncate(r.file, 300), inferred: r.inferred !== false };
}

function resolveSource(el: Element): Promise<Source | null> {
  // Same-origin iframes have no page-world script, so only the top document is mapped.
  if (el.ownerDocument !== document) return Promise.resolve(null);
  return new Promise((resolve) => {
    const nonce = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(nonce);
      resolve(null);
    }, 300);
    pending.set(nonce, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    el.dispatchEvent(new CustomEvent("pointer:resolve", { detail: nonce, bubbles: true, composed: true }));
  });
}

const nameCache = new WeakMap<Element, string | null>();

// ---------------------------------------------------------------- geometry

function frameOffset(el: Element): { x: number; y: number } {
  let x = 0;
  let y = 0;
  try {
    let win: Window | null = el.ownerDocument.defaultView;
    while (win && win.frameElement) {
      const r = win.frameElement.getBoundingClientRect();
      x += r.left + win.frameElement.clientLeft;
      y += r.top + win.frameElement.clientTop;
      win = win.parent;
    }
  } catch {
    /* cross-origin frame boundary */
  }
  return { x, y };
}

function viewportRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  const o = frameOffset(el);
  return { x: r.left + o.x, y: r.top + o.y, w: r.width, h: r.height };
}

/** Deepest element at a point, through open shadow roots and same-origin iframes. */
function deepElementAt(x: number, y: number): Element | null {
  let el = document.elementFromPoint(x, y);
  let ox = 0;
  let oy = 0;
  for (let i = 0; el && i < 12; i++) {
    if (el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x - ox, y - oy);
      if (inner && inner !== el) {
        el = inner;
        continue;
      }
    }
    if (el instanceof HTMLIFrameElement) {
      try {
        const doc = el.contentDocument;
        if (doc) {
          const r = el.getBoundingClientRect();
          ox += r.left + el.clientLeft;
          oy += r.top + el.clientTop;
          const inner = doc.elementFromPoint(x - ox, y - oy);
          if (inner) {
            el = inner;
            continue;
          }
        }
      } catch {
        /* cross-origin */
      }
    }
    break;
  }
  return el === host ? null : el;
}

// ---------------------------------------------------------------- overlay rendering (rAF, rect read only when something changed)

function place(box: HTMLElement, r: Rect): void {
  box.style.display = "block";
  box.style.transform = `translate(${Math.round(r.x)}px, ${Math.round(r.y)}px)`;
  box.style.width = `${Math.max(1, Math.round(r.w))}px`;
  box.style.height = `${Math.max(1, Math.round(r.h))}px`;
}

function describe(el: Element): string {
  const known = nameCache.get(el);
  return shortLabel(el) + (known ? `  ·  ${known}` : "");
}

function render(): void {
  raf = 0;
  if (!active) return;
  if (!hovered) {
    hoverBox.style.display = "none";
  } else {
    const r = viewportRect(hovered);
    place(hoverBox, r);
    labelEl.textContent = describe(hovered);
    labelEl.classList.toggle("below", r.y < 28);
  }
  const container = $("pickedBoxes");
  while (container.children.length > picked.length) container.lastElementChild!.remove();
  picked.forEach((p, i) => {
    let b = container.children[i] as HTMLElement | undefined;
    if (!b) {
      b = document.createElement("div");
      b.className = "box picked";
      container.appendChild(b);
    }
    place(b, viewportRect(p.el));
  });
}

function schedule(): void {
  if (!raf) raf = requestAnimationFrame(render);
}

function setHovered(el: Element | null, keepStack = false): void {
  if (el === hovered) return;
  hovered = el;
  if (!keepStack) descendStack = [];
  schedule();
  clearTimeout(labelTimer);
  if (el && !nameCache.has(el)) {
    labelTimer = window.setTimeout(async () => {
      const src = await resolveSource(el);
      nameCache.set(el, src?.components[0]?.name ?? null);
      if (hovered === el) schedule();
    }, 60);
  }
}

// ---------------------------------------------------------------- tray and toast

function renderTray(): void {
  const chips = $("chips");
  chips.textContent = "";
  picked.forEach((p, i) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.append(`${i + 1} ${shortLabel(p.el)}`);
    const x = document.createElement("button");
    x.textContent = "×";
    x.setAttribute("aria-label", `Remove selection ${i + 1}`);
    x.addEventListener("click", () => {
      picked.splice(i, 1);
      renderTray();
      schedule();
    });
    chip.appendChild(x);
    chips.appendChild(chip);
  });
  tray.style.display = picked.length ? "block" : "none";
}

function showToast(parts: (string | { code: string })[], opts: { error?: boolean; note?: boolean } = {}): void {
  const msg = $("toastMsg");
  msg.textContent = "";
  for (const p of parts) {
    if (typeof p === "string") msg.append(p);
    else {
      const c = document.createElement("code");
      c.textContent = p.code;
      msg.append(c);
    }
  }
  watchToken++;
  setStatus("");
  toast.classList.toggle("err", !!opts.error);
  $("note").style.display = opts.note === false ? "none" : "";
  $("toastRow").style.display = opts.note === false ? "none" : "";
  $("copy").style.display = opts.note === false && !opts.error ? "none" : "";
  toast.style.display = "block";
  host.style.display = "block";
  armToastTimer();
}

let watchToken = 0;

function setStatus(text: string, ok = false): void {
  const el = $("toastStatus");
  el.textContent = text;
  el.classList.toggle("ok", ok);
}

/** Tells the user when the agent has actually read the selection, instead of leaving them guessing. */
async function watchDelivery(): Promise<void> {
  const mine = ++watchToken;
  setStatus("Waiting for your agent to read it…");
  const started = Date.now();
  while (mine === watchToken && Date.now() - started < 120000) {
    await new Promise((r) => setTimeout(r, 1500));
    if (mine !== watchToken) return;
    const d = (await chrome.runtime.sendMessage({ type: "delivery" } satisfies ToBackground).catch(() => null)) as { delivered?: boolean } | null;
    if (d?.delivered) {
      setStatus("✓ Your agent has it", true);
      armToastTimer();
      return;
    }
    if (Date.now() - started > 20000) setStatus("Not read yet. Message your agent, e.g. “change this element”.");
  }
}

function armToastTimer(): void {
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, 30000);
}

function hideToast(): void {
  watchToken++;
  toast.style.display = "none";
  if (!active) host.style.display = "none";
}

toast.addEventListener("focusin", () => clearTimeout(toastTimer));
toast.addEventListener("mouseenter", () => clearTimeout(toastTimer));
toast.addEventListener("focusout", armToastTimer);
$("toastClose").addEventListener("click", hideToast);

async function sendAll(selections: Selection[]): Promise<SendResult> {
  const res = (await chrome.runtime.sendMessage({ type: "send", selections } satisfies ToBackground)) as SendResult | undefined;
  return res ?? { ok: false, reason: "bridge-down", message: "Pointer's background worker did not answer. Reload the page and try again." };
}

/** Attaches whatever is typed in the box to the current selection and re-sends it. Null when the box is empty. */
async function attachNote(): Promise<SendResult | null> {
  const input = $<HTMLInputElement>("note");
  const note = input.value.trim();
  if (!note || !lastSent.length) return null;
  lastSent = lastSent.map((s) => ({ ...s, userNote: truncate(note, LIMITS.note) }));
  input.value = "";
  return sendAll(lastSent);
}

$("note").addEventListener("keydown", async (e) => {
  e.stopPropagation();
  if (e.key === "Escape") return hideToast();
  if (e.key !== "Enter") return;
  const r = await attachNote();
  if (r) showToast(r.ok ? ["Instruction saved with the selection."] : [r.message], { error: !r.ok, note: !r.ok });
  if (r?.ok) void watchDelivery();
});
$("note").addEventListener("keyup", (e) => e.stopPropagation());

$("copy").addEventListener("click", async () => {
  await attachNote(); // an instruction typed but not yet submitted still belongs in the copied prompt
  const text = formatSelections(lastSent);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  showToast(["Copied. Paste it into your agent."], { note: false });
});

// ---------------------------------------------------------------- building the payload

function ancestorsOf(el: Element): Selection["element"]["ancestors"] {
  const out: Selection["element"]["ancestors"] = [];
  for (let cur = el.parentElement; cur && out.length < LIMITS.ancestors; cur = cur.parentElement) {
    out.push({ tag: cur.tagName.toLowerCase(), classes: Array.from(cur.classList).slice(0, 12).map((c) => truncate(c, 120)) });
  }
  return out;
}

function stylesOf(el: Element): Record<string, string> {
  const cs = getComputedStyle(el) as unknown as Record<string, string>;
  const out: Record<string, string> = {};
  for (const p of STYLE_PROPS) {
    const v = cs[p];
    if (v) out[p] = truncate(v, 200);
  }
  const family = (cs["fontFamily"] ?? "").split(",")[0]?.trim().replace(/^["']|["']$/g, "") ?? "";
  out["font"] = truncate(`${cs["fontWeight"]} ${cs["fontSize"]} ${family}`.trim(), 200);
  return out;
}

async function buildSelection(el: Element, rect: Rect, shot: CaptureShot | null): Promise<Selection> {
  const resolved = (await resolveSource(el)) ?? { framework: "none", confidence: "none" as Confidence, components: [] };
  const { route: frameworkRoute, ...src } = resolved;
  // A route file seen in the component chain beats one the framework reports, which beats a URL guess.
  const route = pickPageFile(src.components) ?? frameworkRoute;
  const sel: Selection = {
    version: 1,
    id: `sel_${Date.now().toString(36)}${crypto.randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    page: { url: sanitizeUrl(location.href), title: truncate(document.title, 300), viewport: { w: innerWidth, h: innerHeight }, ...(route ? { route } : {}) },
    element: {
      tag: el.tagName.toLowerCase(),
      selector: truncate(buildSelector(el), 1500),
      text: visibleText(el),
      html: serializeElement(el),
      attributes: collectAttributes(el),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) },
      styles: stylesOf(el),
      ancestors: ancestorsOf(el),
    },
    source: src,
  };
  if (shot) sel.screenshot = shot;
  return sel;
}

type CaptureShot = NonNullable<Selection["screenshot"]>;

const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30))));

async function finish(extra?: Element): Promise<void> {
  const els = picked.map((p) => p.el);
  if (extra && !els.includes(extra)) els.push(extra);
  if (!els.length) return;
  exit(false);

  // Hide our UI so it is not in the screenshot, and let the page repaint.
  host.style.display = "none";
  const settings = await getSettings();
  const rects = els.map(viewportRect);
  let shots: (CaptureShot | null)[] = els.map(() => null);
  if (settings.screenshots) {
    const visible = rects.map((r) => (r.w > 0 && r.h > 0 && r.x + r.w > 0 && r.y + r.h > 0 && r.x < innerWidth && r.y < innerHeight ? r : { x: 0, y: 0, w: 0, h: 0 }));
    await nextPaint();
    const res = (await chrome.runtime.sendMessage({ type: "capture", rects: visible, dpr: devicePixelRatio } satisfies ToBackground).catch(() => ({ ok: false }))) as CaptureResult;
    if (res.ok) shots = res.shots;
  }
  const selections: Selection[] = [];
  for (let i = 0; i < els.length; i++) selections.push(await buildSelection(els[i]!, rects[i]!, shots[i] ?? null));
  lastSent = selections;
  const result = await sendAll(selections);

  const first = selections[0]!;
  const named = first.source.components[0]?.name;
  if (result.ok) {
    const what = selections.length > 1 ? `${selections.length} elements` : shortLabel(els[0]!);
    showToast(["Sent to agent: ", { code: what }, ...(named && selections.length === 1 ? [" in ", { code: named }] : [])]);
    void watchDelivery();
  } else {
    showToast([result.message], { error: true });
  }
}

// ---------------------------------------------------------------- pick mode

let styleTag: HTMLStyleElement | null = null;

const isOurs = (e: Event) => e.composedPath().includes(host);

const onMove = (e: MouseEvent) => {
  if (isOurs(e)) return;
  setHovered(deepElementAt(e.clientX, e.clientY));
};

const onBlocked = (e: Event) => {
  if (isOurs(e)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
};

const onClick = (e: MouseEvent) => {
  if (isOurs(e)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const target = deepElementAt(e.clientX, e.clientY) ?? hovered;
  if (!target) return;
  choose(target, e.shiftKey);
};

function choose(el: Element, add: boolean): void {
  if (add) {
    if (picked.some((p) => p.el === el)) picked = picked.filter((p) => p.el !== el);
    else if (picked.length < LIMITS.maxSelections) picked.push({ el });
    renderTray();
    schedule();
    return;
  }
  void finish(el);
}

const onKey = (e: KeyboardEvent) => {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopImmediatePropagation();
    exit(true);
    return;
  }
  if (isOurs(e)) return;
  const el = hovered ?? document.body;
  switch (e.key) {
    case "ArrowUp": {
      const p = el.parentElement ?? (el.getRootNode() instanceof ShadowRoot ? (el.getRootNode() as ShadowRoot).host : null);
      if (p) {
        descendStack.push(el);
        setHovered(p, true);
      }
      break;
    }
    case "ArrowDown": {
      const next = descendStack.pop() ?? el.firstElementChild;
      if (next) setHovered(next, true);
      break;
    }
    case " ":
      choose(el, e.shiftKey);
      break;
    case "Enter":
      if (picked.length) void finish();
      else choose(el, false);
      break;
    default:
      return;
  }
  e.preventDefault();
  e.stopImmediatePropagation();
};

const onViewportChange = () => schedule();

function enter(): void {
  active = true;
  picked = [];
  hovered = null;
  descendStack = [];
  hideToast();
  document.documentElement.appendChild(host);
  host.style.display = "block";
  styleTag = document.createElement("style");
  styleTag.textContent = "html, html * { cursor: crosshair !important; }";
  (document.head ?? document.documentElement).appendChild(styleTag);
  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("click", onClick, true);
  for (const t of BLOCKED_EVENTS) window.addEventListener(t, onBlocked, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", onViewportChange, true);
  window.addEventListener("resize", onViewportChange);
  renderTray();
}

function exit(cancel: boolean): void {
  if (!active) {
    if (cancel) hideToast();
    return;
  }
  active = false;
  window.removeEventListener("mousemove", onMove, true);
  window.removeEventListener("click", onClick, true);
  for (const t of BLOCKED_EVENTS) window.removeEventListener(t, onBlocked, true);
  window.removeEventListener("keydown", onKey, true);
  window.removeEventListener("scroll", onViewportChange, true);
  window.removeEventListener("resize", onViewportChange);
  styleTag?.remove();
  styleTag = null;
  hoverBox.style.display = "none";
  picked = [];
  renderTray();
  $("pickedBoxes").textContent = "";
  if (cancel) host.style.display = toast.style.display === "block" ? "block" : "none";
}

// ---------------------------------------------------------------- wiring

if (!window.__pointerContentLoaded) {
  window.__pointerContentLoaded = true;
  chrome.runtime.onMessage.addListener((msg: ToContent) => {
    if (msg.type === "start") {
      if (active) exit(true);
      else enter();
    } else if (msg.type === "stop") exit(true);
  });
}
