import { request } from "node:http";
import { createBridge, type Bridge } from "../src/server.ts";
import type { Selection } from "@pointer/core/types";

export const TOKEN = "t".repeat(43);
export const EXT_ORIGIN = "chrome-extension://" + "a".repeat(32);

export function selection(over: Partial<Selection> = {}): Selection {
  return {
    version: 1,
    id: "sel_1",
    createdAt: "2026-11-08T14:02:11Z",
    page: { url: "http://localhost:3000/", title: "T", viewport: { w: 1, h: 1 } },
    element: {
      tag: "button",
      selector: "button",
      text: "Go",
      html: "<button>Go</button>",
      attributes: {},
      rect: { x: 0, y: 0, w: 1, h: 1 },
      styles: {},
      ancestors: [],
    },
    source: { framework: "react", confidence: "exact", components: [{ name: "Card", file: "/Users/me/p/src/Card.tsx", line: 3 }] },
    ...over,
  };
}

export async function start(opts: Partial<Parameters<typeof createBridge>[0]> = {}): Promise<{ bridge: Bridge; port: number }> {
  const bridge = createBridge({ token: TOKEN, log: () => {}, ...opts });
  const port = await bridge.listen();
  return { bridge, port };
}

export interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: any;
}

/** Raw http so tests can control Host and Origin, which fetch forbids. */
export function http(port: number, o: { method?: string; path?: string; headers?: Record<string, string>; body?: string | Buffer; host?: string }): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, method: o.method ?? "GET", path: o.path ?? "/selection", headers: { host: o.host ?? `127.0.0.1:${port}`, ...o.headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          let body: unknown = text;
          try {
            body = text ? JSON.parse(text) : undefined;
          } catch {
            /* leave as text */
          }
          failure = undefined;
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      },
    );
    // A server that rejects early may reset the socket while we are still uploading.
    let failure: Error | undefined;
    req.on("error", (e) => {
      failure = e;
      setTimeout(() => reject(e), 200).unref();
    });
    req.on("response", () => failure && void 0);
    if (o.body !== undefined) req.write(o.body);
    req.end();
  });
}

export const auth = { authorization: `Bearer ${TOKEN}` };
export const json = { ...auth, "content-type": "application/json" };
