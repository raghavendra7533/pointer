import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../src/client.ts";
import { createMcpServer } from "../src/mcp.ts";
import type { Bridge } from "../src/server.ts";
import { TOKEN, http, json, selection, start } from "./helpers.ts";

let bridge: Bridge | undefined;
afterEach(async () => {
  await bridge?.close();
  bridge = undefined;
});

async function connect(port: number) {
  const server = createMcpServer(new BridgeClient({ port, token: TOKEN }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const text = (r: any) => r.content.find((c: any) => c.type === "text").text as string;

describe("MCP contract", () => {
  it("lists the expected tools and a resource", async () => {
    const s = await start();
    bridge = s.bridge;
    const c = await connect(s.port);
    const tools = (await c.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(["clear_selection", "get_selected_element", "list_selections"]);
    const get = tools.find((t) => t.name === "get_selected_element")!;
    expect(get.description).toMatch(/when the user says 'this'/);
    expect(get.description).toMatch(/untrusted/);
    expect(get.description).toMatch(/userInstruction/);
    expect((await c.listResources()).resources.map((r) => r.uri)).toContain("pointer://selection");
  });

  it("returns schema-shaped JSON for a selection and attaches the screenshot as an image", async () => {
    const s = await start();
    bridge = s.bridge;
    const sel = selection({ screenshot: { mime: "image/png", base64: "iVBORw0KGgo=", w: 1, h: 1 }, userNote: "make it blue" });
    await http(s.port, { method: "POST", headers: json, body: JSON.stringify({ selections: [sel] }) });
    const c = await connect(s.port);
    const r: any = await c.callTool({ name: "get_selected_element", arguments: {} });
    const body = JSON.parse(text(r));
    expect(body.notice).toMatch(/untrusted/);
    expect(body.stale).toBe(false);
    expect(body.selections[0].element.tag).toBe("button");
    expect(body.userInstruction).toBe("make it blue");
    expect(body.selections[0].userNote).toBeUndefined();
    expect(body.selections[0].screenshot).toBeUndefined();
    expect(r.content.some((x: any) => x.type === "image" && x.mimeType === "image/png")).toBe(true);
    const noImg: any = await c.callTool({ name: "get_selected_element", arguments: { includeScreenshot: false } });
    expect(noImg.content.every((x: any) => x.type === "text")).toBe(true);
  });

  it("lists and clears selections", async () => {
    const s = await start();
    bridge = s.bridge;
    await http(s.port, { method: "POST", headers: json, body: JSON.stringify({ selections: [selection({ id: "a" }), selection({ id: "b" })] }) });
    const c = await connect(s.port);
    const list = JSON.parse(text(await c.callTool({ name: "list_selections", arguments: {} })));
    expect(list.selections.map((x: any) => x.index)).toEqual([1, 2]);
    await c.callTool({ name: "clear_selection", arguments: {} });
    const after = JSON.parse(text(await c.callTool({ name: "get_selected_element", arguments: {} })));
    expect(after.selections).toEqual([]);
  });

  it("reports a clear error when the bridge is down", async () => {
    const s = await start();
    const port = s.port;
    await s.bridge.close();
    const c = await connect(port);
    const r: any = await c.callTool({ name: "get_selected_element", arguments: {} });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/pointer-bridge start/);
  });

  it("serves the selection as a resource", async () => {
    const s = await start();
    bridge = s.bridge;
    await http(s.port, { method: "POST", headers: json, body: JSON.stringify({ selections: [selection()] }) });
    const c = await connect(s.port);
    const r = await c.readResource({ uri: "pointer://selection" });
    expect(JSON.parse((r.contents[0] as any).text).selections).toHaveLength(1);
  });
});
