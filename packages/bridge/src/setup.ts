import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BridgeClient } from "./client.ts";
import { configDir } from "./config.ts";
import { Pairing } from "./pairing.ts";

export const MCP_ARGS = ["-y", "pointer-bridge", "mcp"];
export const HOOK_COMMAND = "npx -y pointer-bridge hook";

export interface SetupEnv {
  /** Where Claude Code keeps settings.json. */
  claudeDir: string;
  /** Where the extension is unpacked to, a path that never changes between updates. */
  extensionDir: string;
  /** The extension bundled with this package, if any. */
  bundledExtension: string | undefined;
  run: (cmd: string, args: string[], input?: string) => { ok: boolean; found: boolean; output: string };
  platform: NodeJS.Platform;
  out: (line: string) => void;
}

export function defaultEnv(distDir: string): SetupEnv {
  const bundled = join(distDir, "extension");
  return {
    claudeDir: process.env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude"),
    extensionDir: join(configDir(), "extension"),
    bundledExtension: existsSync(join(bundled, "manifest.json")) ? bundled : undefined,
    platform: process.platform,
    run: (cmd, args, input) => {
      const r = spawnSync(cmd, args, { encoding: "utf8", ...(input !== undefined ? { input } : {}) });
      return { ok: r.status === 0, found: !r.error, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
    },
    out: (l) => process.stdout.write(l + "\n"),
  };
}

type HookEntry = { hooks?: { type?: string; command?: string }[] };

/** Adds the UserPromptSubmit hook to Claude Code's settings.json without touching anything else. */
export function installClaudeHook(claudeDir: string): "added" | "present" | "unreadable" {
  const file = join(claudeDir, "settings.json");
  let settings: Record<string, any> = {};
  if (existsSync(file)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "unreadable";
      settings = parsed as Record<string, any>;
    } catch {
      return "unreadable"; // never overwrite a file we cannot parse (comments, typos): the user fixes it
    }
  }
  const hooks = (settings["hooks"] ??= {}) as Record<string, HookEntry[]>;
  const list = (hooks["UserPromptSubmit"] ??= []);
  if (!Array.isArray(list)) return "unreadable";
  if (list.some((e) => e.hooks?.some((h) => /pointer(-bridge)?\b.*\bhook\b/.test(h.command ?? "")))) return "present";
  list.push({ hooks: [{ type: "command", command: HOOK_COMMAND }] });
  mkdirSync(claudeDir, { recursive: true });
  if (existsSync(file)) writeFileSync(`${file}.pointer-backup`, readFileSync(file));
  const tmp = `${file}.pointer-tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
  renameSync(tmp, file);
  return "added";
}

/** Copies the bundled extension to a stable folder so "Load unpacked" is a one-time step. */
export function unpackExtension(env: SetupEnv): boolean {
  if (!env.bundledExtension) return false;
  rmSync(env.extensionDir, { recursive: true, force: true });
  mkdirSync(env.extensionDir, { recursive: true });
  cpSync(env.bundledExtension, env.extensionDir, { recursive: true });
  return true;
}

function registerAgent(env: SetupEnv, agent: "claude" | "codex"): "added" | "present" | "missing" | "failed" {
  const args = agent === "claude" ? ["mcp", "add", "--scope", "user", "pointer", "--", "npx", ...MCP_ARGS] : ["mcp", "add", "pointer", "--", "npx", ...MCP_ARGS];
  const r = env.run(agent, args);
  if (!r.found) return "missing";
  if (r.ok) return "added";
  return /already exists/i.test(r.output) ? "present" : "failed";
}

function copyToClipboard(env: SetupEnv, text: string): boolean {
  const cmds: [string, string[]][] = env.platform === "darwin" ? [["pbcopy", []]] : env.platform === "win32" ? [["clip", []]] : [["wl-copy", []], ["xclip", ["-selection", "clipboard"]]];
  return cmds.some(([cmd, args]) => env.run(cmd, args, text).ok);
}

const tick = "✓";
const dot = "·";

export function runSetup(env: SetupEnv): number {
  const { out } = env;
  let problems = 0;
  out("Setting up Pointer\n");

  const claude = registerAgent(env, "claude");
  if (claude === "added" || claude === "present") out(`${tick} Claude Code: Pointer MCP server ${claude === "added" ? "added" : "already added"}`);
  else if (claude === "failed") {
    out(`✗ Claude Code: \`claude mcp add\` failed. Run: claude mcp add --scope user pointer -- npx ${MCP_ARGS.join(" ")}`);
    problems++;
  } else out(`${dot} Claude Code not found, skipped`);

  const codex = registerAgent(env, "codex");
  if (codex === "added" || codex === "present") out(`${tick} Codex: Pointer MCP server ${codex === "added" ? "added" : "already added"}`);
  else if (codex === "failed") {
    out("✗ Codex: `codex mcp add` failed. See docs/agents.md");
    problems++;
  }

  if (claude !== "missing") {
    const hook = installClaudeHook(env.claudeDir);
    if (hook === "unreadable") {
      out(`✗ Could not edit ${join(env.claudeDir, "settings.json")}. Add the UserPromptSubmit hook by hand: ${HOOK_COMMAND}`);
      problems++;
    } else out(`${tick} Claude Code hook ${hook === "added" ? "installed (your selection reaches the agent when you send a prompt)" : "already installed"}`);
  }

  if (unpackExtension(env)) {
    out(`${tick} Extension ready at ${env.extensionDir}`);
    const copied = copyToClipboard(env, env.extensionDir);
    const opened = env.platform === "darwin" && env.run("open", ["-a", "Google Chrome", "chrome://extensions"]).ok;
    out(`\nOne last step, once per browser${opened ? " (Chrome's extensions page just opened)" : ""}:`);
    out(`  1. ${opened ? "Turn on Developer mode (top right)" : "Open chrome://extensions and turn on Developer mode"}`);
    out(`  2. Click Load unpacked and choose ${copied ? "the folder (its path is on your clipboard, paste it with Cmd/Ctrl+Shift+G or Ctrl+L)" : "the folder above"}`);
    out("  3. Press Alt+Shift+P on any page, click an element, and ask your agent about it");
  } else {
    out(`${dot} Extension not bundled in this install. Load packages/extension/dist as an unpacked extension.`);
  }
  return problems ? 1 : 0;
}

export interface Check {
  ok: boolean;
  label: string;
  fix?: string;
}

/** What `pointer doctor` prints: each link in the chain from browser to agent, with the fix for the first broken one. */
export async function runDoctor(env: SetupEnv, port: number): Promise<{ checks: Check[]; ok: boolean }> {
  const checks: Check[] = [];
  const client = new BridgeClient({ port });
  let bridgeUp = false;
  try {
    await client.get();
    bridgeUp = true;
  } catch {
    /* reported below */
  }
  checks.push({
    ok: bridgeUp,
    label: bridgeUp ? "Bridge is running" : "Bridge is not running",
    fix: "It starts with your agent. Open Claude Code or Codex once Pointer is set up, or run: npx pointer-bridge start",
  });
  const paired = new Pairing().pairedOrigin();
  checks.push({ ok: !!paired, label: paired ? "Browser extension is paired" : "Browser extension has not paired yet", fix: "Click the Pointer toolbar icon, or run: npx pointer-bridge pair" });
  const settingsFile = join(env.claudeDir, "settings.json");
  let hookOk = false;
  try {
    hookOk = /pointer(-bridge)?\b.*\bhook\b/.test(readFileSync(settingsFile, "utf8"));
  } catch {
    /* not installed */
  }
  checks.push({ ok: hookOk, label: hookOk ? "Claude Code hook is installed" : "Claude Code hook is not installed", fix: "Run: npx pointer-bridge setup" });
  const mcp = env.run("claude", ["mcp", "list"]);
  if (mcp.found) checks.push({ ok: /\bpointer\b/.test(mcp.output), label: /\bpointer\b/.test(mcp.output) ? "Claude Code knows about Pointer" : "Pointer is not registered with Claude Code", fix: "Run: npx pointer-bridge setup" });
  return { checks, ok: checks.every((c) => c.ok) };
}
