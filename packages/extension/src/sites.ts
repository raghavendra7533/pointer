/** Per-site gate (EXT-12). Pure so it can be unit tested. */

const DEV_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|.*\.localhost|.*\.local|.*\.test)$/;

const SENSITIVE: RegExp[] = [
  /(^|\.)mail\.google\.com$/,
  /(^|\.)(outlook\.(live|office|office365)\.com|mail\.yahoo\.com|proton\.me|mail\.proton\.me|icloud\.com)$/,
  /(^|\.)(paypal|venmo|stripe|wise|coinbase|robinhood|schwab|fidelity|vanguard|chase|wellsfargo|bankofamerica|citi|capitalone|americanexpress|hsbc|barclays)\.(com|co\.uk)$/,
  /(^|[.-])(bank|banking|netbanking|ebank)([.-]|$)/,
  /(^|\.)(accounts\.google\.com|login\.microsoftonline\.com|appleid\.apple\.com)$/,
  /(^|\.)(1password|bitwarden|lastpass|dashlane)\.com$/,
];

export type SiteDecision = { allowed: true } | { allowed: false; reason: string };

function matchesHost(pattern: string, host: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (!p) return false;
  if (p.startsWith("*.")) return host === p.slice(2) || host.endsWith(p.slice(1));
  return host === p;
}

export function checkSite(rawUrl: string | undefined, mode: "sensitive-blocked" | "allowlist", allowedHosts: string[]): SiteDecision {
  let u: URL;
  try {
    u = new URL(rawUrl ?? "");
  } catch {
    return { allowed: false, reason: "This page has no address Pointer can inject into." };
  }
  if (u.protocol === "chrome:" || u.protocol === "chrome-extension:" || u.protocol === "edge:" || u.protocol === "about:") {
    return { allowed: false, reason: "Chrome does not let extensions run on browser pages." };
  }
  if (u.hostname === "chromewebstore.google.com" || u.hostname === "chrome.google.com" || u.hostname === "microsoftedge.microsoft.com") {
    return { allowed: false, reason: "Chrome does not let extensions run on the Web Store." };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "file:") {
    return { allowed: false, reason: `Pointer cannot run on ${u.protocol} pages.` };
  }
  if (u.pathname.toLowerCase().endsWith(".pdf")) {
    return { allowed: false, reason: "Pointer cannot run inside Chrome's PDF viewer." };
  }
  const host = u.hostname.toLowerCase();
  if (allowedHosts.some((p) => matchesHost(p, host))) return { allowed: true };
  if (mode === "allowlist" && !DEV_HOST.test(host) && u.protocol !== "file:") {
    return { allowed: false, reason: `${host} is not on your allowlist. Add it in the Pointer options.` };
  }
  if (!DEV_HOST.test(host) && SENSITIVE.some((r) => r.test(host))) {
    return { allowed: false, reason: `${host} looks like a banking, mail or sign-in site, so Pointer is off there. Add it to the allowlist in the options to override.` };
  }
  return { allowed: true };
}
