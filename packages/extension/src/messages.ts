import type { Selection } from "@pointer/core/types";

export type ToBackground =
  | { type: "send"; selections: Selection[] }
  | { type: "capture"; rects: Rect[]; dpr: number }
  | { type: "explain-closed" }
  | { type: "delivery" }
  | { type: "status" };

export type SendResult =
  | { ok: true; count: number }
  | { ok: false; reason: "bridge-down" | "auth-failed" | "rejected"; message: string };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Shot {
  mime: "image/png" | "image/jpeg";
  base64: string;
  w: number;
  h: number;
}

/** One entry per requested rect; null where the element was off-screen or too large to fit the cap. */
export type CaptureResult = { ok: true; shots: (Shot | null)[] } | { ok: false };

export type ToContent = { type: "start" } | { type: "stop" };

export const BRIDGE_START_HINT = "Open your coding agent (it starts the bridge). Not set up yet? Run `npx pointer-bridge setup`.";
export const PAIR_HINT = "Not paired yet. Run `npx pointer-bridge doctor` and follow the fix it shows.";
