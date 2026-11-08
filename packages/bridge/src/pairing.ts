import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./config.ts";

export const PAIRING_WINDOW_MS = 10 * 60 * 1000;

/**
 * Trust-on-first-use pairing so nobody has to copy a token by hand.
 *
 * While a short window is open and nothing is paired yet, the first extension origin
 * that asks is pinned and gets the token. Web pages cannot forge the browser's Origin
 * header, so they cannot pair. After that, only the pinned origin is accepted, and it can
 * ask again (reinstall, cleared storage). State lives in files so `pointer pair` can
 * re-open the window on a bridge that is already running.
 */
export class Pairing {
  constructor(
    private readonly dir = configDir(),
    private readonly now: () => number = Date.now,
  ) {}

  private get pairedFile(): string {
    return join(this.dir, "paired-origin");
  }
  private get untilFile(): string {
    return join(this.dir, "pairing-until");
  }

  pairedOrigin(): string | undefined {
    try {
      return readFileSync(this.pairedFile, "utf8").trim() || undefined;
    } catch {
      return undefined;
    }
  }

  windowOpen(): boolean {
    if (this.pairedOrigin() || !existsSync(this.untilFile)) return false;
    try {
      return this.now() < Number(readFileSync(this.untilFile, "utf8"));
    } catch {
      return false;
    }
  }

  openWindow(ms = PAIRING_WINDOW_MS): void {
    rmSync(this.pairedFile, { force: true });
    writeFileSync(this.untilFile, String(this.now() + ms), { mode: 0o600 });
  }

  /** Opens a window only if the bridge has never been paired and no window is currently open. */
  openIfUnpaired(): void {
    if (!this.pairedOrigin() && !this.windowOpen()) this.openWindow();
  }

  /** "paired": newly pinned. "known": already the pinned origin. "closed": refused. */
  pair(origin: string): "paired" | "known" | "closed" {
    const current = this.pairedOrigin();
    if (current) return current === origin ? "known" : "closed";
    if (!this.windowOpen()) return "closed";
    writeFileSync(this.pairedFile, origin + "\n", { mode: 0o600 });
    rmSync(this.untilFile, { force: true });
    return "paired";
  }
}
