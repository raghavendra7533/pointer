import { isDependencyPath, normalizePath } from "@pointer/core/paths";
import type { Confidence, SourceComponent } from "@pointer/core/types";

export interface Detection {
  framework: string;
  components: SourceComponent[];
}

export interface ResolvedSource extends Detection {
  confidence: Confidence;
}

type Detector = (el: Element, win: Window) => Detection | null;
type Anyobj = Record<string, any>;

const MAX_CHAIN = 10;
const ANON = /^(anonymous|_?default|render|wrapper|component|<anonymous>)$/i;

function goodName(n: unknown): n is string {
  return typeof n === "string" && n.length > 0 && n.length < 80 && !ANON.test(n);
}

function baseName(file: string): string {
  return (file.split("/").pop() ?? file).replace(/\.[a-z0-9]+$/i, "");
}

function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function* ancestorsAndSelf(el: Element, limit = 40): Generator<Element> {
  let cur: Element | null = el;
  for (let i = 0; cur && i < limit; i++, cur = parentOf(cur)) yield cur;
}

function loc(file: unknown, line?: unknown, column?: unknown): Pick<SourceComponent, "file" | "line" | "column"> {
  const f = typeof file === "string" ? normalizePath(file) : undefined;
  if (!f) return {};
  const out: Pick<SourceComponent, "file" | "line" | "column"> = { file: f };
  if (typeof line === "number" && line > 0) out.line = line;
  if (typeof column === "number" && column >= 0) out.column = column;
  return out;
}

// ---------------------------------------------------------------- React

const FUNCTION_LIKE_TAGS = new Set([0, 1, 11, 14, 15]); // function, class, forwardRef, memo, simple memo

function reactName(type: Anyobj | null): string | undefined {
  if (!type) return undefined;
  const t = type as Anyobj;
  const n = t["displayName"] ?? t["name"] ?? t["render"]?.displayName ?? t["render"]?.name ?? t["type"]?.displayName ?? t["type"]?.name;
  return goodName(n) ? n : undefined;
}

/** React 19 dropped _debugSource; the creation stack of the element still names the file. */
function stackFile(stack: unknown): string | undefined {
  const text = typeof stack === "string" ? stack : (stack as Anyobj | undefined)?.["stack"];
  if (typeof text !== "string") return undefined;
  for (const line of text.split("\n")) {
    const m = /\(?((?:https?|file|webpack-internal):[^\s)]+?|\/[^\s)]+?):\d+:\d+\)?$/.exec(line.trim());
    if (!m) continue;
    if (/jsxDEV|jsx-dev-runtime|react-stack|react\.development|react_jsx|createElement|\.vite\/deps/.test(line)) continue;
    const f = normalizePath(m[1]!);
    if (f && !isDependencyPath(f)) return f;
  }
  return undefined;
}

const reactDetector: Detector = (el) => {
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
  if (!key) return null;
  const host = (el as unknown as Anyobj)[key] as Anyobj | undefined;
  if (!host) return null;
  const components: SourceComponent[] = [];
  // _debugSource on a fiber is where *that element* was written in JSX, i.e. in its
  // owner's file. So the nearest component takes the host's location, the next takes the
  // nearest component's usage site, and so on up the chain.
  let nextLoc = host["_debugSource"] as Anyobj | undefined;
  let nextStackFile = nextLoc ? undefined : stackFile(host["_debugStack"]);
  for (let f = host["return"] as Anyobj | null, i = 0; f && i < 200 && components.length < MAX_CHAIN; f = f["return"] as Anyobj | null, i++) {
    if (!FUNCTION_LIKE_TAGS.has(f["tag"])) continue;
    const name = reactName(f["type"]);
    if (!name) continue;
    const entry: SourceComponent = { name };
    if (nextLoc) Object.assign(entry, loc(nextLoc["fileName"], nextLoc["lineNumber"], nextLoc["columnNumber"]));
    else if (nextStackFile) entry.file = nextStackFile; // file only: transformed lines are not trustworthy
    components.push(entry);
    nextLoc = f["_debugSource"] as Anyobj | undefined;
    nextStackFile = nextLoc ? undefined : stackFile(f["_debugStack"]);
  }
  return components.length ? { framework: "react", components } : null;
};

// ---------------------------------------------------------------- Vue

function vue3Name(inst: Anyobj): string | undefined {
  const t = inst["type"] ?? {};
  const n = t["name"] ?? t["__name"] ?? (typeof t["__file"] === "string" ? baseName(t["__file"]) : undefined);
  return goodName(n) ? n : undefined;
}

const vueDetector: Detector = (el) => {
  const components: SourceComponent[] = [];
  for (const node of ancestorsAndSelf(el, 6)) {
    let inst = (node as unknown as Anyobj)["__vueParentComponent"] as Anyobj | undefined;
    if (inst) {
      for (let i = 0; inst && i < 100 && components.length < MAX_CHAIN; inst = inst["parent"] as Anyobj | undefined, i++) {
        const name = vue3Name(inst);
        if (!name) continue;
        components.push({ name, ...loc(inst["type"]?.["__file"]) });
      }
      return components.length ? { framework: "vue", components } : null;
    }
    // Vue 2
    let vm = (node as unknown as Anyobj)["__vue__"] as Anyobj | undefined;
    if (vm) {
      for (let i = 0; vm && i < 100 && components.length < MAX_CHAIN; vm = vm["$parent"] as Anyobj | undefined, i++) {
        const o = vm["$options"] ?? {};
        const n = o["name"] ?? o["_componentTag"] ?? (typeof o["__file"] === "string" ? baseName(o["__file"]) : undefined);
        if (goodName(n)) components.push({ name: n, ...loc(o["__file"]) });
      }
      return components.length ? { framework: "vue", components } : null;
    }
  }
  return null;
};

// ---------------------------------------------------------------- Svelte (4 and 5, dev builds)

const svelteDetector: Detector = (el) => {
  for (const node of ancestorsAndSelf(el, 12)) {
    const meta = (node as unknown as Anyobj)["__svelte_meta"] as Anyobj | undefined;
    if (!meta) continue;
    const components: SourceComponent[] = [];
    const seen = new Set<string>();
    for (let m: Anyobj | undefined = meta; m && components.length < MAX_CHAIN; m = m["parent"] as Anyobj | undefined) {
      const l = (m["loc"] ?? m) as Anyobj;
      const where = loc(l["file"], l["line"], l["column"]);
      if (!where.file || seen.has(where.file)) continue;
      seen.add(where.file);
      components.push({ name: baseName(where.file), ...where });
    }
    return components.length ? { framework: "svelte", components } : null;
  }
  return null;
};

// ---------------------------------------------------------------- Angular (dev mode `ng` global)

const angularDetector: Detector = (el, win) => {
  const ng = (win as unknown as Anyobj)["ng"] as Anyobj | undefined;
  if (!ng || typeof ng["getOwningComponent"] !== "function") return null;
  const components: SourceComponent[] = [];
  try {
    let cur: unknown = ng["getOwningComponent"](el) ?? ng["getComponent"]?.(el);
    for (let i = 0; cur && i < MAX_CHAIN; i++) {
      const name = (cur as Anyobj)["constructor"]?.["name"];
      if (goodName(name)) components.push({ name });
      const host = ng["getHostElement"]?.(cur) as Element | undefined;
      cur = host ? ng["getOwningComponent"](host) : null;
    }
  } catch {
    return null;
  }
  return components.length ? { framework: "angular", components } : null;
};

// ---------------------------------------------------------------- Attribute conventions

/** "path:line:col" with an optional trailing tag, as written by several dev plugins. */
function parseLocString(v: string): Pick<SourceComponent, "file" | "line" | "column"> {
  const m = /^(.*?):(\d+)(?::(\d+))?(?::[A-Za-z][\w-]*)?$/.exec(v.trim());
  return m ? loc(m[1], Number(m[2]), m[3] ? Number(m[3]) : undefined) : loc(v);
}

const ATTRIBUTE_SOURCES: { framework: string; read: (el: Element) => Pick<SourceComponent, "file" | "line" | "column"> | null }[] = [
  {
    framework: "astro",
    read: (el) => {
      const f = el.getAttribute("data-astro-source-file");
      if (!f) return null;
      const [l, c] = (el.getAttribute("data-astro-source-loc") ?? "").split(":").map(Number);
      return loc(f, l, c);
    },
  },
  { framework: "vue", read: (el) => (el.hasAttribute("data-v-inspector") ? parseLocString(el.getAttribute("data-v-inspector")!) : null) },
  { framework: "source-inspector", read: (el) => (el.hasAttribute("data-insp-path") ? parseLocString(el.getAttribute("data-insp-path")!) : null) },
  {
    framework: "source-inspector",
    read: (el) => {
      const f = el.getAttribute("data-inspector-relative-path");
      return f ? loc(f, Number(el.getAttribute("data-inspector-line")), Number(el.getAttribute("data-inspector-column"))) : null;
    },
  },
  { framework: "source-inspector", read: (el) => (el.hasAttribute("data-source") ? parseLocString(el.getAttribute("data-source")!) : null) },
  { framework: "source-inspector", read: (el) => (el.hasAttribute("data-pointer-source") ? parseLocString(el.getAttribute("data-pointer-source")!) : null) },
];

const attributeDetector: Detector = (el) => {
  for (const node of ancestorsAndSelf(el, 12)) {
    for (const s of ATTRIBUTE_SOURCES) {
      const where = s.read(node);
      if (where?.file) return { framework: s.framework, components: [{ name: baseName(where.file), ...where }] };
    }
  }
  return null;
};

// ---------------------------------------------------------------- Web components (Lit, Stencil, FAST, vanilla)

const webComponentDetector: Detector = (el) => {
  const components: SourceComponent[] = [];
  for (const node of ancestorsAndSelf(el, 40)) {
    if (node.tagName.includes("-") && components.length < MAX_CHAIN) components.push({ name: node.tagName.toLowerCase() });
  }
  return components.length ? { framework: "web-components", components } : null;
};

// ---------------------------------------------------------------- Escape hatch for any other stack

/**
 * Apps can expose `window.__POINTER_SOURCE__ = (el) => ({ framework, components })`
 * to map elements from stacks Pointer has no detector for (Solid, Qwik, Marko, ...).
 * The result is still page content: it is clamped and normalised like everything else.
 */
const customDetector: Detector = (el, win) => {
  const fn = (win as unknown as Anyobj)["__POINTER_SOURCE__"];
  if (typeof fn !== "function") return null;
  try {
    const out = fn(el) as Anyobj | null | undefined;
    if (!out || !Array.isArray(out["components"])) return null;
    const components: SourceComponent[] = [];
    for (const c of out["components"].slice(0, MAX_CHAIN)) {
      if (!c || !goodName(c.name)) continue;
      components.push({ name: c.name, ...loc(c.file, c.line, c.column) });
    }
    const fw = typeof out["framework"] === "string" ? out["framework"].slice(0, 40) : "custom";
    return components.length ? { framework: fw, components } : null;
  } catch {
    return null;
  }
};

/** Order matters only for ties; the best-scoring detection wins. */
export const DETECTORS: Detector[] = [
  customDetector,
  reactDetector,
  vueDetector,
  svelteDetector,
  angularDetector,
  attributeDetector,
  webComponentDetector,
];

function score(d: Detection): number {
  const first = d.components[0];
  if (first?.file) return first.line ? 4 : 3;
  if (d.components.some((c) => c.file)) return 2;
  return d.components.length ? 1 : 0;
}

export function confidenceOf(d: Detection | null): Confidence {
  if (!d || !d.components.length) return "none";
  return d.components[0]?.file ? "exact" : "component-only";
}

/** Runs every detector and keeps the most informative result. Never throws. */
export function resolveSource(el: Element, win: Window = window): ResolvedSource {
  let best: Detection | null = null;
  for (const detect of DETECTORS) {
    let d: Detection | null;
    try {
      d = detect(el, win);
    } catch {
      d = null;
    }
    if (d && (!best || score(d) > score(best))) best = d;
  }
  return best ? { ...best, confidence: confidenceOf(best) } : { framework: "none", components: [], confidence: "none" };
}
