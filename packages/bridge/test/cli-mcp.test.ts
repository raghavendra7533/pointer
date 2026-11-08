import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildBridge } from "../build.mjs";
import { http, json, selection } from "./helpers.ts";

const cli = join(import.meta.dirname, "..", "dist", "cli.js");
const clients: Client[] = [];

beforeAll(async () => {
  await buildBridge();
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });

async function launch(port: number, configDir: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "node",
    args: [cli, "mcp", "--port", String(port)],
    env: { ...process.env, POINTER_CONFIG_DIR: configDir } as Record<string, string>,
    stderr: "ignore",
  });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  clients.push(client);
  return client;
}

const text = (r: any) => JSON.parse(r.content.find((c: any) => c.type === "text").text);

describe("pointer mcp hosts the bridge", () => {
  it("serves the HTTP API itself, and a second session proxies to the first", async () => {
    const port = await freePort();
    const dir = mkdtempSync(join(tmpdir(), "pointer-mcp-"));
    const first = await launch(port, dir);
    const token = readFileSync(join(dir, "token"), "utf8").trim();

    // The browser side talks to the HTTP API that the MCP process started.
    const posted = await http(port, {
      method: "POST",
      path: "/selection",
      headers: { ...json, authorization: `Bearer ${token}` },
      body: JSON.stringify({ selections: [selection({ userNote: "from the browser" })] }),
    });
    expect(posted.status).toBe(201);
    expect(text(await first.callTool({ name: "get_selected_element", arguments: {} })).userInstruction).toBe("from the browser");

    // A second agent session finds the port taken, does not crash, and sees the same data.
    const second = await launch(port, dir);
    expect(text(await second.callTool({ name: "get_selected_element", arguments: {} })).userInstruction).toBe("from the browser");
  });
});
