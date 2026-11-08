import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_PORT = 7391;
export const DEFAULT_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_RETENTION_MS = 60 * 60 * 1000;

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env["POINTER_CONFIG_DIR"]) return env["POINTER_CONFIG_DIR"];
  if (process.platform === "win32") return join(env["APPDATA"] ?? join(homedir(), "AppData", "Roaming"), "pointer");
  return join(env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"), "pointer");
}

export function tokenPath(dir = configDir()): string {
  return join(dir, "token");
}

/** Reads the shared token, creating it with user-only permissions on first run. */
export function loadOrCreateToken(dir = configDir()): string {
  const file = tokenPath(dir);
  if (existsSync(file)) {
    if (process.platform !== "win32" && (statSync(file).mode & 0o077) !== 0) chmodSync(file, 0o600);
    const t = readFileSync(file, "utf8").trim();
    if (t.length >= 32) return t;
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString("base64url");
  writeFileSync(file, token + "\n", { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(file, 0o600);
  return token;
}

/** Read-only variant for clients (hook, MCP proxy): never creates a token. */
export function readToken(dir = configDir()): string | undefined {
  try {
    const t = readFileSync(tokenPath(dir), "utf8").trim();
    return t || undefined;
  } catch {
    return undefined;
  }
}
