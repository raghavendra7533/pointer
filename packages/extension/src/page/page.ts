/**
 * Runs in the page's main world, the only place framework internals are visible.
 * The content script dispatches `pointer:resolve` on the target element; we answer
 * with window.postMessage carrying the same nonce.
 */
import { resolveSource } from "./detectors.ts";
import { resolvePageRoute } from "./route.ts";

declare global {
  interface Window {
    __pointerPageLoaded?: boolean;
  }
}

if (!window.__pointerPageLoaded) {
  window.__pointerPageLoaded = true;
  document.addEventListener(
    "pointer:resolve",
    (e) => {
      const nonce = (e as CustomEvent<string>).detail;
      if (typeof nonce !== "string") return;
      const target = (e.composedPath()[0] ?? e.target) as Element | null;
      const result = target instanceof Element ? resolveSource(target) : null;
      window.postMessage({ type: "pointer:source", nonce, result, route: resolvePageRoute(window) }, window.location.origin === "null" ? "*" : window.location.origin);
    },
    true,
  );
}
