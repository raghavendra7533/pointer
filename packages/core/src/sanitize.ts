import { LIMITS } from "./limits.ts";

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + "…";
}

/** String-level scrub, used in the extension and again in the bridge (defense in depth). */
export function sanitizeHtmlString(html: string): string {
  const out = html
    .replace(/<svg\b([^>]*)>[\s\S]*?<\/svg>/gi, (_m, attrs: string) => `<svg${attrs}>…</svg>`)
    .replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+(;[a-z0-9=.+-]+)*,[^"'\s)>]*/gi, "data:…");
  return truncate(out, LIMITS.html);
}

const FORM_TAGS = new Set(["input", "textarea", "select"]);

/** Serialises an element without ever exposing what the user typed into form controls. */
export function serializeElement(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  const controls = [clone, ...Array.from(clone.querySelectorAll("input, textarea, select"))];
  for (const c of controls) {
    const tag = c.tagName.toLowerCase();
    if (!FORM_TAGS.has(tag)) continue;
    if (tag === "input" && (c.getAttribute("type") || "").toLowerCase() === "password") {
      for (const a of Array.from(c.attributes)) if (a.name !== "type") c.removeAttribute(a.name);
      continue;
    }
    c.removeAttribute("value");
    c.removeAttribute("checked");
    if (tag === "textarea") c.textContent = "";
    if (tag === "select") for (const o of Array.from(c.querySelectorAll("option"))) o.removeAttribute("selected");
  }
  return sanitizeHtmlString(clone.outerHTML);
}

const SECRET_PARAM = /token|key|secret|passw|auth|session|code|sig|jwt|credential/i;

/** Drops credentials and hash, masks values of secret-looking query params. */
export function sanitizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.username = "";
    u.password = "";
    u.hash = "";
    for (const k of Array.from(u.searchParams.keys())) {
      if (SECRET_PARAM.test(k)) u.searchParams.set(k, "[redacted]");
    }
    return truncate(u.toString(), 2048);
  } catch {
    return truncate(raw, 2048);
  }
}

export function sanitizeAttribute(name: string, value: string, tag: string): string | null {
  const n = name.toLowerCase();
  if (n === "value" && FORM_TAGS.has(tag)) return null;
  if (n.startsWith("on")) return null; // inline handlers are code, not hints
  return truncate(value.replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+(;[a-z0-9=.+-]+)*,\S*/gi, "data:…"), 300);
}

export function collectAttributes(el: Element): Record<string, string> {
  const tag = el.tagName.toLowerCase();
  const out: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    if (Object.keys(out).length >= LIMITS.attributes) break;
    const v = sanitizeAttribute(a.name, a.value, tag);
    if (v !== null) out[a.name] = v;
  }
  return out;
}

/** Visible text, never the contents of form controls or password fields. */
export function visibleText(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (FORM_TAGS.has(tag)) return "";
  const raw = (el as HTMLElement).innerText ?? el.textContent ?? "";
  return truncate(raw.replace(/\s+/g, " ").trim(), LIMITS.text);
}
