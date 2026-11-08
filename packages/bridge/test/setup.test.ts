import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installClaudeHook, runSetup, type SetupEnv } from "../src/setup.ts";
import { auth, http, json, selection, start } from "./helpers.ts";
import type { Bridge } from "../src/server.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "pointer-setup-"));

function env(over: Partial<SetupEnv> = {}): { env: SetupEnv; lines: string[]; calls: string[][] } {
  const lines: string[] = [];
  const calls: string[][] = [];
  const base: SetupEnv = {
    claudeDir: tmp(),
    extensionDir: join(tmp(), "extension"),
    bundledExtension: undefined,
    platform: "linux",
    run: (cmd, args) => (calls.push([cmd, ...args]), { ok: true, found: cmd === "claude", output: "" }),
    out: (l) => lines.push(l),
  };
  return { env: { ...base, ...over }, lines, calls };
}

describe("installClaudeHook", () => {
  it("adds the hook once and keeps existing settings and a backup", () => {
    const dir = tmp();
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ theme: "dark", hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo hi" }] }] } }));
    expect(installClaudeHook(dir)).toBe("added");
    expect(installClaudeHook(dir)).toBe("present");
    const s = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
    expect(s.theme).toBe("dark");
    expect(s.hooks.UserPromptSubmit).toHaveLength(2);
    expect(existsSync(join(dir, "settings.json.pointer-backup"))).toBe(true);
  });

  it("creates settings.json when missing and refuses to overwrite a file it cannot parse", () => {
    const fresh = tmp();
    expect(installClaudeHook(fresh)).toBe("added");
    const broken = tmp();
    writeFileSync(join(broken, "settings.json"), "{ // comment\n}");
    expect(installClaudeHook(broken)).toBe("unreadable");
    expect(readFileSync(join(broken, "settings.json"), "utf8")).toBe("{ // comment\n}");
  });
});

describe("runSetup", () => {
  it("registers with the agent, installs the hook and unpacks the extension", () => {
    const bundled = tmp();
    writeFileSync(join(bundled, "manifest.json"), "{}");
    const { env: e, lines, calls } = env({ bundledExtension: bundled });
    expect(runSetup(e)).toBe(0);
    expect(calls[0]).toEqual(["claude", "mcp", "add", "--scope", "user", "pointer", "--", "npx", "-y", "pointer-bridge", "mcp"]);
    expect(existsSync(join(e.claudeDir, "settings.json"))).toBe(true);
    expect(existsSync(join(e.extensionDir, "manifest.json"))).toBe(true);
    expect(lines.join("\n")).toContain("Load unpacked");
  });

  it("treats an existing registration as success", () => {
    const { env: e } = env({ run: (cmd) => ({ ok: false, found: cmd === "claude", output: "MCP server pointer already exists" }) });
    expect(runSetup(e)).toBe(0);
  });
});

describe("delivery receipt", () => {
  let bridge: Bridge | undefined;
  afterEach(async () => bridge && (await bridge.close()));

  it("health reports when an agent read the selection, and resets on a new one", async () => {
    const s = await start();
    bridge = s.bridge;
    const health = async () => (await http(s.port, { path: "/health", headers: auth })).body.delivered;
    await http(s.port, { method: "POST", headers: json, body: JSON.stringify({ selections: [selection()] }) });
    expect(await health()).toBeNull();
    await http(s.port, { path: "/selection", headers: auth }); // the extension peeking does not count
    expect(await health()).toBeNull();
    await http(s.port, { path: "/selection?reader=agent", headers: auth });
    expect((await health()).via).toBe("mcp");
    await http(s.port, { method: "POST", headers: json, body: JSON.stringify({ selections: [selection()] }) });
    expect(await health()).toBeNull();
  });
});
