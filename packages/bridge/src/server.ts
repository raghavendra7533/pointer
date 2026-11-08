import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { LIMITS, SelectionSetSchema } from "@pointer/core";
import { normalizePath } from "@pointer/core/paths";
import { sanitizeHtmlString } from "@pointer/core/sanitize";
import type { Selection } from "@pointer/core/types";
import { SelectionStore } from "./store.ts";
import { DEFAULT_RETENTION_MS, DEFAULT_TTL_MS } from "./config.ts";
import type { Pairing } from "./pairing.ts";

export interface BridgeOptions {
  token: string;
  port?: number;
  ttlMs?: number;
  retentionMs?: number;
  /** Project root, used to turn absolute source paths into relative ones. */
  root?: string;
  verbose?: boolean;
  /** Extra exact origins to accept besides chrome-extension://<id>. Empty means any extension id. */
  allowedOrigins?: string[];
  /** When set, enables POST /pair and pins requests to the paired extension origin. */
  pairing?: Pairing;
  log?: (line: string) => void;
}

const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
export const HOST = "127.0.0.1";

function digest(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

function tokenOk(header: string | undefined, token: string): boolean {
  const m = /^Bearer (.+)$/.exec(header ?? "");
  return !!m && timingSafeEqual(digest(m[1]!), digest(token));
}

function send(res: ServerResponse, status: number, body: unknown, cors: Record<string, string> = {}): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...cors,
  });
  res.end(data);
}

class TooLarge extends Error {}

function readBody(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (c: Buffer) => {
      if (over) return;
      size += c.length;
      if (size > max) {
        over = true;
        chunks.length = 0;
        reject(new TooLarge());
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Defense in depth: the extension already sanitises, but the bridge never trusts its caller. */
function scrub(selections: Selection[], root?: string): Selection[] {
  return selections.map((s) => ({
    ...s,
    element: { ...s.element, html: sanitizeHtmlString(s.element.html) },
    source: {
      ...s.source,
      components: s.source.components.map((c) => {
        const file = c.file ? normalizePath(c.file, root) : undefined;
        const { file: _drop, ...rest } = c;
        return file ? { ...rest, file } : rest;
      }),
    },
  }));
}

export interface Bridge {
  server: Server;
  store: SelectionStore;
  listen(): Promise<number>;
  close(): Promise<void>;
}

export function createBridge(opts: BridgeOptions): Bridge {
  const store = new SelectionStore({
    ttlMs: opts.ttlMs ?? DEFAULT_TTL_MS,
    retentionMs: opts.retentionMs ?? DEFAULT_RETENTION_MS,
  });
  const log = opts.log ?? ((l) => process.stderr.write(l + "\n"));
  let boundPort = opts.port ?? 0;

  const originAllowed = (origin: string, path: string): boolean => {
    if (!EXTENSION_ORIGIN.test(origin)) return false;
    if (path === "/pair" && opts.pairing) return true; // pairing decides for itself
    if (opts.allowedOrigins?.length && !opts.allowedOrigins.includes(origin)) return false;
    const pinned = opts.pairing?.pairedOrigin();
    return !pinned || pinned === origin;
  };

  const server = createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? "/", "http://placeholder");
    let status = 0;
    const done = (s: number, body: unknown, cors: Record<string, string> = {}) => {
      status = s;
      send(res, s, body, cors);
      if (opts.verbose) log(`${req.method} ${url.pathname} ${status} ${Date.now() - started}ms`);
    };

    // 1. DNS rebinding: the Host header must name loopback and our port.
    const host = (req.headers.host ?? "").toLowerCase();
    if (host !== `127.0.0.1:${boundPort}` && host !== `localhost:${boundPort}`) return done(403, { error: "bad_host" });

    // 2. Origin: browsers always send it on cross-origin requests; only our extension may.
    const origin = req.headers.origin;
    const cors: Record<string, string> = {};
    if (origin !== undefined) {
      if (!originAllowed(origin, url.pathname)) return done(403, { error: "bad_origin" });
      cors["access-control-allow-origin"] = origin;
      cors["vary"] = "Origin";
    }

    if (req.method === "OPTIONS") {
      if (origin === undefined) return done(403, { error: "bad_origin" });
      res.writeHead(204, {
        ...cors,
        "access-control-allow-methods": "GET, POST, DELETE",
        "access-control-allow-headers": "authorization, content-type",
        "access-control-max-age": "600",
      });
      res.end();
      if (opts.verbose) log(`OPTIONS ${url.pathname} 204`);
      return;
    }

    // Pairing is the one route that cannot need a token: it is how the extension gets it.
    if (url.pathname === "/pair" && opts.pairing) {
      if (req.method !== "POST" || origin === undefined) return done(403, { error: "bad_origin" }, cors);
      const outcome = opts.pairing.pair(origin);
      if (outcome === "closed") return done(403, { error: "pairing_closed" }, cors);
      return done(200, { token: opts.token, paired: outcome }, cors);
    }

    // 3. Token on every request.
    if (!tokenOk(req.headers.authorization, opts.token)) return done(401, { error: "unauthorized" }, cors);

    try {
      if (url.pathname === "/health" && req.method === "GET") {
        return done(200, { ok: true, version: 1, count: store.count(), delivered: store.delivery() }, cors);
      }

      if (url.pathname === "/selection") {
        if (req.method === "GET") {
          const consume = url.searchParams.get("consume") === "hook";
          if (!consume && url.searchParams.get("reader") === "agent") store.markDelivered("mcp");
          return done(200, consume ? store.consumeForHook() : store.get(), cors);
        }
        if (req.method === "DELETE") {
          store.clear();
          return done(200, { ok: true }, cors);
        }
        if (req.method === "POST") {
          const ct = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
          if (ct !== "application/json") return done(415, { error: "unsupported_media_type" }, cors);
          const declared = Number(req.headers["content-length"] ?? 0);
          if (declared > LIMITS.payloadBytes) {
            req.resume(); // drain and discard; only token holders get this far
            return done(413, { error: "payload_too_large" }, cors);
          }
          let raw: string;
          try {
            raw = await readBody(req, LIMITS.payloadBytes);
          } catch (e) {
            if (e instanceof TooLarge) {
              req.resume(); // drain and discard; only token holders get this far
              return done(413, { error: "payload_too_large" }, cors);
            }
            throw e;
          }
          let json: unknown;
          try {
            json = JSON.parse(raw);
          } catch {
            return done(400, { error: "invalid_json" }, cors);
          }
          const parsed = SelectionSetSchema.safeParse(json);
          if (!parsed.success) {
            return done(422, { error: "invalid_selection", issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join(".")) }, cors);
          }
          const clean = scrub(parsed.data.selections as Selection[], opts.root);
          store.set(clean);
          return done(201, { ok: true, count: clean.length, ids: clean.map((s) => s.id) }, cors);
        }
        return done(405, { error: "method_not_allowed" }, cors);
      }
      return done(404, { error: "not_found" }, cors);
    } catch {
      return done(500, { error: "internal_error" }, cors);
    }
  });

  return {
    server,
    store,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(opts.port ?? 0, HOST, () => {
          boundPort = (server.address() as AddressInfo).port;
          resolve(boundPort);
        });
      }),
    close: () => new Promise((resolve) => (server.close(() => resolve()), server.closeAllConnections())),
  };
}
