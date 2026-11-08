import type { StoredSet } from "@pointer/core/types";
import { DEFAULT_PORT, readToken } from "./config.ts";

export interface ClientOptions {
  port?: number;
  token?: string;
  fetchImpl?: typeof fetch;
}

export class BridgeDown extends Error {}
export class BridgeAuth extends Error {}

/** Thin HTTP client used by the MCP proxy and the hook. */
export class BridgeClient {
  private readonly port: number;
  private readonly token: string | undefined;
  private readonly f: typeof fetch;

  constructor(opts: ClientOptions = {}) {
    this.port = opts.port ?? (Number(process.env["POINTER_PORT"]) || DEFAULT_PORT);
    this.token = opts.token ?? readToken();
    this.f = opts.fetchImpl ?? fetch;
  }

  private async call(path: string, method = "GET"): Promise<Response> {
    if (!this.token) throw new BridgeAuth("No token found. Run `npx pointer-bridge start` once to create it.");
    let res: Response;
    try {
      res = await this.f(`http://127.0.0.1:${this.port}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(2000),
      });
    } catch {
      throw new BridgeDown("The Pointer bridge is not running. Start it with `npx pointer-bridge start`.");
    }
    if (res.status === 401) throw new BridgeAuth("The bridge rejected the token. Restart the bridge or re-read the token.");
    return res;
  }

  async get(opts: { consumeForHook?: boolean } = {}): Promise<StoredSet> {
    const res = await this.call(opts.consumeForHook ? "/selection?consume=hook" : "/selection?reader=agent");
    return (await res.json()) as StoredSet;
  }

  async clear(): Promise<void> {
    await this.call("/selection", "DELETE");
  }
}
