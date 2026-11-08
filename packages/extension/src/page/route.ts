import { normalizePath } from "@pointer/core/paths";
import type { SourceComponent } from "@pointer/core/types";

export interface Route {
  file: string;
  inferred: boolean;
}

type Anyobj = Record<string, any>;

// A segment that is clearly data rather than a folder name.
const DYNAMIC_SEGMENT = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|[A-Za-z0-9_-]{22,})$/i;

const PAGE_FILE = /(^|\/)(page\.(t|j)sx?|\+page\.(svelte|ts|js)|index\.(t|j)sx?|[^/]+\.(astro|vue))$/;
const ROUTE_DIR = /(^|\/)(app|pages|routes|views|src\/(app|pages|routes|views))\//;

/** Picks the outermost component whose file looks like a route file (page.tsx, +page.svelte, pages/...). */
export function pickPageFile(components: SourceComponent[]): Route | null {
  for (let i = components.length - 1; i >= 0; i--) {
    const f = components[i]?.file;
    if (f && PAGE_FILE.test(f) && ROUTE_DIR.test(f)) return { file: f, inferred: false };
  }
  return null;
}

/**
 * The route file for the current page, from what the framework exposes. Anything guessed
 * from the URL is flagged `inferred` so the agent verifies it before editing.
 */
export function resolvePageRoute(win: Window = window): Route | null {
  const w = win as unknown as Anyobj;

  const custom = typeof w["__POINTER_PAGE__"] === "function" ? safeCall(() => w["__POINTER_PAGE__"]()) : w["__POINTER_PAGE__"];
  const customFile = typeof custom === "string" ? custom : (custom as Anyobj | null)?.["file"];
  if (typeof customFile === "string" && customFile) {
    const f = normalizePath(customFile);
    if (f) return { file: f, inferred: false };
  }

  // Next.js pages router: the route is exact, the extension is not.
  const nextPage = (w["__NEXT_DATA__"] as Anyobj | undefined)?.["page"];
  if (typeof nextPage === "string" && nextPage.startsWith("/") && !nextPage.startsWith("/_")) {
    return { file: `pages${nextPage === "/" ? "/index" : nextPage}.*`, inferred: true };
  }

  // Next.js app router: segment names for dynamic routes are not visible, so replace data-looking ones.
  const isNextApp = !!w["next"] || !!w["__next_f"] || !!win.document.querySelector('script[src*="/_next/"]');
  if (isNextApp) {
    const segs = win.location.pathname
      .split("/")
      .filter(Boolean)
      .map((s) => (DYNAMIC_SEGMENT.test(s) ? "[param]" : decodeURIComponent(s)));
    return { file: `app/${[...segs, "page.*"].join("/")}`, inferred: true };
  }
  return null;
}

function safeCall<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
