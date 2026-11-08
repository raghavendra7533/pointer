function esc(s: string): string {
  return typeof CSS !== "undefined" && CSS.escape
    ? CSS.escape(s)
    : s.replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c);
}

const STABLE_ATTRS = ["data-testid", "data-test", "data-cy", "data-qa"];

function isUnique(root: ParentNode, sel: string): boolean {
  try {
    return root.querySelectorAll(sel).length === 1;
  } catch {
    return false;
  }
}

function step(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList).filter((c) => !/^\d|[:/[\]]/.test(c)).slice(0, 3);
  let s = tag + classes.map((c) => "." + esc(c)).join("");
  const parent = el.parentElement;
  if (parent) {
    const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
    if (same.length > 1) s += `:nth-of-type(${same.indexOf(el) + 1})`;
  }
  return s;
}

/** Selector relative to the element's own root (document or shadow root). */
function localSelector(el: Element): string {
  const root = el.getRootNode() as Document | ShadowRoot;
  const tag = el.tagName.toLowerCase();
  if (el.id && isUnique(root, `#${esc(el.id)}`)) return `#${esc(el.id)}`;
  for (const a of STABLE_ATTRS) {
    const v = el.getAttribute(a);
    if (v && isUnique(root, `[${a}="${v.replace(/"/g, '\\"')}"]`)) return `${tag}[${a}="${v.replace(/"/g, '\\"')}"]`;
  }
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.tagName.toLowerCase() !== "html") {
    parts.unshift(step(cur));
    if (cur !== el && cur.id && isUnique(root, `#${esc(cur.id)}`)) {
      parts[0] = `#${esc(cur.id)}`;
      break;
    }
    if (isUnique(root, parts.join(" > "))) break;
    cur = cur.parentElement;
  }
  return parts.join(" > ");
}

/** Crosses open shadow roots with ` >>> `; the result is a hint for agents, not guaranteed to be a valid querySelector. */
export function buildSelector(el: Element): string {
  const chain: string[] = [];
  let cur: Element = el;
  for (let i = 0; i < 8; i++) {
    chain.unshift(localSelector(cur));
    const root = cur.getRootNode();
    if (root instanceof ShadowRoot) cur = root.host;
    else break;
  }
  return chain.join(" >>> ");
}

/** Short label such as `button.btn-primary` for toasts and overlays. */
export function shortLabel(el: Element): string {
  const classes = Array.from(el.classList).slice(0, 2);
  return el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "") + classes.map((c) => "." + c).join("");
}
