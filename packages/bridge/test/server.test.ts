import { afterEach, describe, expect, it } from "vitest";
import type { Bridge } from "../src/server.ts";
import { EXT_ORIGIN, auth, http, json, selection, start } from "./helpers.ts";

let bridge: Bridge | undefined;
afterEach(async () => {
  await bridge?.close();
  bridge = undefined;
});

const post = (port: number, body: unknown, headers: Record<string, string> = json) =>
  http(port, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("bridge security", () => {
  it("requires a token on every route", async () => {
    const s = await start();
    bridge = s.bridge;
    expect((await http(s.port, {})).status).toBe(401);
    expect((await http(s.port, { path: "/health" })).status).toBe(401);
    expect((await http(s.port, { method: "DELETE" })).status).toBe(401);
    expect((await post(s.port, { selections: [selection()] }, { "content-type": "application/json" })).status).toBe(401);
    expect((await http(s.port, { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    expect(s.bridge.store.count()).toBe(0);
  });

  it("rejects a foreign Host header (DNS rebinding)", async () => {
    const s = await start();
    bridge = s.bridge;
    for (const host of ["evil.example.com", `evil.example.com:${s.port}`, "127.0.0.1", `127.0.0.1:${s.port + 1}`]) {
      const r = await http(s.port, { headers: auth, host });
      expect(r.status, host).toBe(403);
      expect(r.body.error).toBe("bad_host");
    }
    expect((await http(s.port, { headers: auth, host: `localhost:${s.port}` })).status).toBe(200);
  });

  it("rejects web origins even with a valid token", async () => {
    const s = await start();
    bridge = s.bridge;
    for (const origin of ["https://evil.example.com", "http://localhost:3000", "null", "chrome-extension://short"]) {
      const r = await http(s.port, { headers: { ...json, origin }, method: "POST", body: JSON.stringify({ selections: [selection()] }) });
      expect(r.status, origin).toBe(403);
      expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    }
    expect(s.bridge.store.count()).toBe(0);
  });

  it("accepts the extension origin and echoes it, never a wildcard", async () => {
    const s = await start();
    bridge = s.bridge;
    const r = await http(s.port, { headers: { ...auth, origin: EXT_ORIGIN } });
    expect(r.status).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe(EXT_ORIGIN);
  });

  it("can pin one extension origin", async () => {
    const s = await start({ allowedOrigins: [EXT_ORIGIN] });
    bridge = s.bridge;
    const other = "chrome-extension://" + "b".repeat(32);
    expect((await http(s.port, { headers: { ...auth, origin: other } })).status).toBe(403);
    expect((await http(s.port, { headers: { ...auth, origin: EXT_ORIGIN } })).status).toBe(200);
  });

  it("answers preflight only for the extension origin", async () => {
    const s = await start();
    bridge = s.bridge;
    const ok = await http(s.port, { method: "OPTIONS", headers: { origin: EXT_ORIGIN } });
    expect(ok.status).toBe(204);
    expect(ok.headers["access-control-allow-headers"]).toContain("authorization");
    const bad = await http(s.port, { method: "OPTIONS", headers: { origin: "https://evil.example.com" } });
    expect(bad.status).toBe(403);
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("accepts only application/json", async () => {
    const s = await start();
    bridge = s.bridge;
    for (const ct of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      expect((await post(s.port, { selections: [selection()] }, { ...auth, "content-type": ct })).status, ct).toBe(415);
    }
  });

  it("rejects oversize payloads, including bodies that lie about their length", async () => {
    const s = await start();
    bridge = s.bridge;
    const big = JSON.stringify({ selections: [selection({ userNote: "x".repeat(1_100_000) })] });
    // declared Content-Length over the cap
    const declared = await post(s.port, big, { ...json, "content-length": String(Buffer.byteLength(big)) });
    expect(declared.status).toBe(413);
    // chunked, no declared length
    expect((await post(s.port, big)).status).toBe(413);
    expect(s.bridge.store.count()).toBe(0);
  });

  it("rejects malformed JSON and schema violations", async () => {
    const s = await start();
    bridge = s.bridge;
    expect((await post(s.port, "{nope")).status).toBe(400);
    expect((await post(s.port, { selections: [{ ...selection(), version: 2 }] })).status).toBe(422);
    expect((await post(s.port, { selections: [] })).status).toBe(422);
    const eleven = Array.from({ length: 11 }, (_, i) => selection({ id: "s" + i }));
    expect((await post(s.port, { selections: eleven })).status).toBe(422);
    const html = selection();
    html.element.html = "x".repeat(10000);
    expect((await post(s.port, { selections: [html] })).status).toBe(422);
  });
});

describe("bridge behaviour", () => {
  it("stores, returns and clears a set", async () => {
    const s = await start();
    bridge = s.bridge;
    const a = selection({ id: "a" });
    const b = selection({ id: "b" });
    const r = await post(s.port, { selections: [a, b] });
    expect(r.status).toBe(201);
    expect(r.body.ids).toEqual(["a", "b"]);
    const got = await http(s.port, { headers: auth });
    expect(got.body.selections.map((x: { id: string }) => x.id)).toEqual(["a", "b"]);
    expect(got.body.stale).toBe(false);
    expect((await http(s.port, { method: "DELETE", headers: auth })).status).toBe(200);
    expect((await http(s.port, { headers: auth })).body.selections).toEqual([]);
  });

  it("scrubs html and normalises source paths with --root", async () => {
    const s = await start({ root: "/Users/me/p" });
    bridge = s.bridge;
    const sel = selection();
    sel.element.html = '<div><svg><path d="x"/></svg><img src="data:image/png;base64,AAAA"></div>';
    await post(s.port, { selections: [sel] });
    const got = (await http(s.port, { headers: auth })).body.selections[0];
    expect(got.source.components[0].file).toBe("src/Card.tsx");
    expect(got.element.html).not.toContain("<path");
    expect(got.element.html).not.toContain("AAAA");
  });

  it("flags selections as stale after the TTL and drops them after retention", async () => {
    const s = await start({ ttlMs: 30, retentionMs: 120 });
    bridge = s.bridge;
    await post(s.port, { selections: [selection()] });
    expect((await http(s.port, { headers: auth })).body.stale).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    const stale = (await http(s.port, { headers: auth })).body;
    expect(stale.stale).toBe(true);
    expect(stale.selections).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 100));
    expect((await http(s.port, { headers: auth })).body.selections).toEqual([]);
  });

  it("hands a selection to the hook once, and never a stale one", async () => {
    const s = await start({ ttlMs: 40 });
    bridge = s.bridge;
    const consume = () => http(s.port, { path: "/selection?consume=hook", headers: auth });
    expect((await consume()).body.selections).toEqual([]);
    await post(s.port, { selections: [selection()] });
    expect((await consume()).body.selections).toHaveLength(1);
    expect((await consume()).body.selections).toEqual([]);
    await post(s.port, { selections: [selection({ id: "new" })] });
    await new Promise((r) => setTimeout(r, 70));
    expect((await consume()).body.selections).toEqual([]);
  });

  it("returns 404 and 405 for unknown routes and methods", async () => {
    const s = await start();
    bridge = s.bridge;
    expect((await http(s.port, { path: "/nope", headers: auth })).status).toBe(404);
    expect((await http(s.port, { method: "PUT", headers: auth })).status).toBe(405);
  });
});
