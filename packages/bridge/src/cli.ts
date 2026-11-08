#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BridgeClient } from "./client.ts";
import { DEFAULT_PORT, DEFAULT_RETENTION_MS, DEFAULT_TTL_MS, configDir, loadOrCreateToken } from "./config.ts";
import { runHook } from "./hook.ts";
import { PAIRING_WINDOW_MS, Pairing } from "./pairing.ts";
import { createMcpServer } from "./mcp.ts";
import { createBridge } from "./server.ts";
import { defaultEnv, runDoctor, runSetup } from "./setup.ts";

const HELP = `pointer: hand the element you clicked in Chrome to your coding agent

Usage:
  pointer setup                          One-time setup: register with your agent, install the hook, unpack the extension
  pointer doctor [--port N]              Check every link from browser to agent and say how to fix what is broken
  pointer start [--port N] [--root DIR] [--ttl SECONDS] [--origin ORIGIN] [--verbose]
  pointer mcp [--port N]                 MCP server over stdio (what agents launch). Starts the bridge too
  pointer pair                           Re-open the pairing window for the browser extension
  pointer hook [--port N]                Claude Code UserPromptSubmit hook
  pointer register [claude|codex|print]  Register the MCP server with an agent
  pointer token                          Print the token (only needed for manual setup)

The bridge only listens on 127.0.0.1. Selections are held in memory.`;

const MCP_ARGS = ["-y", "pointer-bridge", "mcp"];

function pairingNote(pairing: Pairing): string {
  const origin = pairing.pairedOrigin();
  return origin
    ? `Paired with ${origin}. Run \`pointer pair\` to pair a different browser profile.\n`
    : `Waiting for the Pointer extension to pair: click its toolbar icon within ${PAIRING_WINDOW_MS / 60000} minutes.\n`;
}

function die(msg: string): never {
  process.stderr.write(msg + "\n");
  process.exit(1);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      port: { type: "string" },
      root: { type: "string" },
      ttl: { type: "string" },
      origin: { type: "string", multiple: true },
      verbose: { type: "boolean", default: false },
      hook: { type: "boolean", default: false },
    },
  });
  const port = values.port ? Number(values.port) : Number(process.env["POINTER_PORT"]) || DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) die("Invalid --port");

  switch (cmd) {
    case "start": {
      const token = loadOrCreateToken();
      const ttlMs = values.ttl ? Number(values.ttl) * 1000 : DEFAULT_TTL_MS;
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) die("Invalid --ttl");
      const pairing = new Pairing();
      pairing.openIfUnpaired();
      const bridge = createBridge({
        token,
        port,
        pairing,
        ttlMs,
        retentionMs: Math.max(DEFAULT_RETENTION_MS, ttlMs),
        verbose: values.verbose,
        ...(values.root ? { root: values.root } : {}),
        ...(values.origin ? { allowedOrigins: values.origin } : {}),
      });
      try {
        await bridge.listen();
      } catch (e) {
        die(`Could not listen on 127.0.0.1:${port}: ${(e as Error).message}`);
      }
      process.stderr.write(
        `Pointer bridge listening on http://127.0.0.1:${port}\n` +
          pairingNote(pairing),
      );
      const stop = () => void bridge.close().then(() => process.exit(0));
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      return;
    }
    case "mcp": {
      // The agent launches this process, so it also hosts the bridge: no separate "start" step.
      // If another agent session already owns the port, this one simply talks to that bridge.
      const token = loadOrCreateToken();
      const pairing = new Pairing();
      pairing.openIfUnpaired();
      const bridge = createBridge({ token, port, pairing });
      try {
        await bridge.listen();
        process.stderr.write(`Pointer bridge on http://127.0.0.1:${port}\n${pairingNote(pairing)}`);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") die(`Could not listen on 127.0.0.1:${port}: ${(e as Error).message}`);
      }
      const server = createMcpServer(new BridgeClient({ port, token }));
      await server.connect(new StdioServerTransport());
      const quit = () => process.exit(0);
      process.stdin.on("end", quit);
      process.stdin.on("close", quit);
      return;
    }
    case "setup": {
      process.exit(runSetup(defaultEnv(dirname(fileURLToPath(import.meta.url)))));
      break;
    }
    case "doctor": {
      const { checks, ok } = await runDoctor(defaultEnv(dirname(fileURLToPath(import.meta.url))), port);
      for (const c of checks) process.stdout.write(`${c.ok ? "✓" : "✗"} ${c.label}\n${c.ok ? "" : `    ${c.fix}\n`}`);
      process.stdout.write(ok ? "\nAll good. Press Alt+Shift+P on any page.\n" : "\nFix the items marked ✗ and run `npx pointer-bridge doctor` again.\n");
      process.exit(ok ? 0 : 1);
      break;
    }
    case "pair": {
      new Pairing().openWindow();
      process.stdout.write(
        `Pairing window open for ${PAIRING_WINDOW_MS / 60000} minutes. Click the Pointer toolbar icon (or open its options and press "Test connection") to pair.\n`,
      );
      return;
    }
    case "hook": {
      process.stdout.write(await runHook(new BridgeClient({ port })));
      return;
    }
    case "token": {
      process.stdout.write(loadOrCreateToken() + "\n");
      return;
    }
    case "register": {
      const target = positionals[0] ?? "claude";
      const base = ["mcp", "add", "pointer", "--", "npx", ...MCP_ARGS];
      if (target === "claude" || target === "codex") {
        const r = spawnSync(target, base, { stdio: "inherit" });
        if (r.error) {
          process.stderr.write(`Could not run \`${target}\`. Run this yourself:\n  ${target} ${base.join(" ")}\n`);
          process.exit(1);
        }
        process.exit(r.status ?? 0);
      }
      process.stdout.write(
        `Claude Code: claude ${base.join(" ")}\n` +
          `Codex:       codex ${base.join(" ")}\n` +
          `Codex config.toml:\n[mcp_servers.pointer]\ncommand = "npx"\nargs = ${JSON.stringify(MCP_ARGS)}\n\n` +
          `Claude Code hook (settings.json):\n${JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "npx -y pointer-bridge hook" }] }] } }, null, 2)}\n` +
          `Config dir: ${configDir()}\n`,
      );
      return;
    }
    default:
      process.stdout.write(HELP + "\n");
      if (cmd && cmd !== "help" && cmd !== "--help" && cmd !== "-h") process.exit(1);
  }
}

main().catch((e: unknown) => die(e instanceof Error ? e.message : String(e)));
