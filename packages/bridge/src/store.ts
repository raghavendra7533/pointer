import type { Selection, StoredSet } from "@pointer/core/types";

export interface StoreOptions {
  ttlMs: number;
  retentionMs: number;
  now?: () => number;
}

/** In-memory only. Selections are stale after ttlMs and dropped after retentionMs. */
export class SelectionStore {
  private selections: Selection[] = [];
  private receivedAt = 0;
  private hookDeliveredAt = 0;
  private delivered: { at: number; via: "hook" | "mcp" } | null = null;
  private readonly now: () => number;

  constructor(private readonly opts: StoreOptions) {
    this.now = opts.now ?? Date.now;
  }

  set(selections: Selection[]): void {
    this.selections = selections;
    this.receivedAt = this.now();
    this.hookDeliveredAt = 0;
    this.delivered = null;
  }

  clear(): void {
    this.selections = [];
    this.receivedAt = 0;
    this.hookDeliveredAt = 0;
    this.delivered = null;
  }

  get(): StoredSet {
    const age = this.now() - this.receivedAt;
    if (this.selections.length && age > this.opts.retentionMs) this.clear();
    if (!this.selections.length) return { selections: [], receivedAt: "", ageMs: 0, stale: false };
    return {
      selections: this.selections,
      receivedAt: new Date(this.receivedAt).toISOString(),
      ageMs: age,
      stale: age > this.opts.ttlMs,
    };
  }

  /** Returns the set once for the hook, so a selection is not re-injected on every prompt. */
  consumeForHook(): StoredSet {
    const cur = this.get();
    if (!cur.selections.length || cur.stale || this.hookDeliveredAt === this.receivedAt) {
      return { ...cur, selections: [] };
    }
    this.hookDeliveredAt = this.receivedAt;
    this.markDelivered("hook");
    return cur;
  }

  /** Records that an agent read the current selection, so the browser can say so. */
  markDelivered(via: "hook" | "mcp"): void {
    if (this.selections.length && !this.delivered) this.delivered = { at: this.now(), via };
  }

  delivery(): { at: string; via: "hook" | "mcp" } | null {
    return this.delivered ? { at: new Date(this.delivered.at).toISOString(), via: this.delivered.via } : null;
  }

  count(): number {
    return this.selections.length;
  }
}
