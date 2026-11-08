/**
 * Turns whatever a dev server or framework reports as a file location into a
 * project-relative path. Handles Vite (/@fs/, /src/...), webpack (webpack-internal:///,
 * webpack://app/./), file:// URLs, query strings, and an optional project root.
 */
export function normalizePath(raw: string, root?: string): string | undefined {
  let p = raw.trim();
  if (!p) return undefined;
  p = p.replace(/^webpack-internal:\/\/\/(\([^)]*\)\/)?/, "");
  p = p.replace(/^webpack:\/\/[^/]*\//, "");
  p = p.replace(/^(?:file|https?):\/\/[^/]*/, "");
  p = p.replace(/[?#].*$/, "");
  p = p.replace(/^\/@fs\//, "/");
  p = p.replace(/^\/@id\/(__x00__)?/, "");
  p = p.replace(/^\.\//, "").replace(/^\/\.\//, "/");
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep raw */
  }
  if (/^[a-z]:[\\/]/i.test(p)) p = p.replace(/\\/g, "/");
  if (root) {
    const r = root.replace(/\\/g, "/").replace(/\/+$/, "");
    if (p.startsWith(r + "/")) p = p.slice(r.length + 1);
  }
  if (p.startsWith("/") && !isAbsoluteFsPath(p, root)) p = p.slice(1);
  if (!p || p === "/") return undefined;
  return p;
}

// A leading "/" is a dev-server URL path (/src/App.tsx), not a filesystem path,
// unless it sits under a well-known absolute prefix.
function isAbsoluteFsPath(p: string, root?: string): boolean {
  if (root) return false;
  return /^\/(Users|home|var|opt|tmp|mnt|workspace|usr)\//.test(p);
}

export function isDependencyPath(p: string): boolean {
  return /(^|\/)node_modules\//.test(p) || /\.vite\/deps\//.test(p);
}
