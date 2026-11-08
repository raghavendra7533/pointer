import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Pairing } from "../src/pairing.ts";
import type { Bridge } from "../src/server.ts";
import { EXT_ORIGIN, TOKEN, auth, http, start } from "./helpers.ts";

const OTHER = "chrome-extension://" + "b".repeat(32);
let bridge: Bridge | undefined;
afterEach(async () => {
  await bridge?.close();
  bridge = undefined;
});

const dir = () => mkdtempSync(join(tmpdir(), "pointer-pair-"));
const pair = (port: number, origin?: string) =>
  http(port, { method: "POST", path: "/pair", headers: origin ? { origin } : {} });

describe("pairing", () => {
  it("hands the token to the first extension while the window is open, then pins it", async () => {
    const pairing = new Pairing(dir());
    pairing.openWindow();
    const s = await start({ pairing });
    bridge = s.bridge;
    const r = await pair(s.port, EXT_ORIGIN);
    expect(r.status).toBe(200);
    expect(r.body.token).toBe(TOKEN);
    expect(pairing.pairedOrigin()).toBe(EXT_ORIGIN);
    // the window closed: a different extension is refused, the same one may ask again
    expect((await pair(s.port, OTHER)).status).toBe(403);
    expect((await pair(s.port, EXT_ORIGIN)).body.paired).toBe("known");
  });

  it("refuses everyone when no window is open", async () => {
    const s = await start({ pairing: new Pairing(dir()) });
    bridge = s.bridge;
    const r = await pair(s.port, EXT_ORIGIN);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("pairing_closed");
    expect(JSON.stringify(r.body)).not.toContain(TOKEN);
  });

  it("refuses web pages, requests without an Origin, and bad Hosts, even with the window open", async () => {
    const pairing = new Pairing(dir());
    pairing.openWindow();
    const s = await start({ pairing });
    bridge = s.bridge;
    expect((await pair(s.port, "https://evil.example.com")).status).toBe(403);
    expect((await pair(s.port, "http://localhost:3000")).status).toBe(403);
    expect((await pair(s.port)).status).toBe(403);
    expect((await http(s.port, { method: "POST", path: "/pair", headers: { origin: EXT_ORIGIN }, host: "evil.example.com" })).status).toBe(403);
    expect((await http(s.port, { method: "GET", path: "/pair", headers: { origin: EXT_ORIGIN } })).status).toBe(403);
    expect(pairing.pairedOrigin()).toBeUndefined();
    expect(pairing.windowOpen()).toBe(true);
  });

  it("expires the window", () => {
    let now = 1000;
    const p = new Pairing(dir(), () => now);
    p.openWindow(500);
    expect(p.windowOpen()).toBe(true);
    now = 2000;
    expect(p.windowOpen()).toBe(false);
    expect(p.pair(EXT_ORIGIN)).toBe("closed");
  });

  it("once paired, only that origin may use the API, even with a valid token", async () => {
    const pairing = new Pairing(dir());
    pairing.openWindow();
    const s = await start({ pairing });
    bridge = s.bridge;
    await pair(s.port, EXT_ORIGIN);
    expect((await http(s.port, { headers: { ...auth, origin: EXT_ORIGIN } })).status).toBe(200);
    expect((await http(s.port, { headers: { ...auth, origin: OTHER } })).status).toBe(403);
    // no Origin (hook, MCP proxy) still works with the token
    expect((await http(s.port, { headers: auth })).status).toBe(200);
  });

  it("`pair` re-opens the window on a running bridge and clears the old pin", async () => {
    const d = dir();
    const pairing = new Pairing(d);
    pairing.openWindow();
    const s = await start({ pairing });
    bridge = s.bridge;
    await pair(s.port, EXT_ORIGIN);
    new Pairing(d).openWindow(); // what `pointer pair` does, from another process
    expect((await pair(s.port, OTHER)).body.paired).toBe("paired");
  });

  it("keeps its files private", () => {
    const d = dir();
    const p = new Pairing(d);
    p.openWindow();
    p.pair(EXT_ORIGIN);
    expect(readFileSync(join(d, "paired-origin"), "utf8").trim()).toBe(EXT_ORIGIN);
    writeFileSync(join(d, "pairing-until"), "not a number");
    expect(new Pairing(d).windowOpen()).toBe(false);
  });

  it("does not expose /pair when pairing is not configured", async () => {
    const s = await start();
    bridge = s.bridge;
    expect((await pair(s.port, EXT_ORIGIN)).status).toBe(401); // falls through to the normal token check
  });
});
