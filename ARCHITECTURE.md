# Architecture

One page: components, data flow, decisions, rejected alternatives, known limits.

## Components

```
 browser tab                                   your machine
┌───────────────────────────────┐   POST /selection   ┌────────────────────────────┐
│ page world   page.js          │   (token, loopback)  │ bridge (pointer start)     │
│   reads framework internals   │  ┌─────────────────▶ │  HTTP API, 127.0.0.1 only  │
│ isolated     content.js       │  │                   │  validate · scrub · store  │
│   overlay, tray, payload      │  │                   │  in-memory, TTL            │
│ service worker background.js  │──┘                   └──────┬───────────┬─────────┘
│   screenshot, POST, status    │                             │ GET       │ GET ?consume=hook
└───────────────────────────────┘                             │           │
                                                  ┌───────────▼──┐   ┌────▼───────────────┐
                                                  │ pointer mcp  │   │ pointer hook       │
                                                  │ stdio MCP    │   │ UserPromptSubmit   │
                                                  └──────┬───────┘   └────┬───────────────┘
                                                  Codex / Claude Code / any MCP client
```

- **`packages/core`**: the data contract (zod), sanitizer, selector builder, formatter, path normalizer. Pure, shared by extension and bridge, so the same rules run on both sides.
- **`packages/bridge`**: one npm package, one binary: `mcp` (stdio MCP server that also hosts the HTTP API), `start` (standalone API), `hook` (prompt hook), `pair` (re-open the pairing window).
- **`packages/extension`**: MV3 extension with four small scripts. `page.js` runs in the page's main world, `content.js` in the isolated world, `background.js` is a stateless service worker, `options.js` is the settings page.

## Data flow

1. The user presses the shortcut. The worker checks the per-site gate, then injects `page.js` (main world) and `content.js` on demand. Nothing runs at page load.
2. Hover: `requestAnimationFrame` loop; the rect is measured only when the hovered element or the viewport changes.
3. Click (capture phase, handlers suppressed): the content script asks the page world to resolve the source by dispatching `pointer:resolve` on the element; `page.js` answers via `postMessage` with a per-request nonce. The result is clamped and its confidence recomputed in the isolated world.
4. UI is hidden, the worker takes one `captureVisibleTab` and crops each element (max 800px, under 500 KB).
5. The payload (see `packages/core/src/schema.ts`) is POSTed by the service worker. The bridge checks Host, Origin and token, enforces size and schema, scrubs again, normalises file paths against `--root`, and stores the set.
6. Agents read it: the MCP tools return JSON (screenshot as an image part), the hook prints a delimited text block once per selection.

## Decisions and rejected alternatives

| Decision | Choice | Rejected | Why |
| --- | --- | --- | --- |
| Agent interface | MCP tools on the bridge | A plugin per agent | One integration covers Claude Code, Codex and any MCP client |
| Automatic context | `UserPromptSubmit` hook, MCP as the portable path | Relying on the agent to always call a tool | The hook injects without the agent deciding to fetch |
| Extension to bridge | HTTP POST to loopback with a token | Native messaging | Native messaging needs per-OS registration; loopback installs with one `npx`, at the cost of token, Origin and Host checks (tested) |
| Process model | `pointer mcp` hosts the bridge itself; if the port is taken it proxies to the existing one. `pointer start` stays for a standalone bridge | A separate bridge the user must start | The agent already launches the MCP process, so hosting the bridge there removes a setup step. Cost: the bridge lives with that session |
| Token handling | Trust-on-first-use pairing over loopback, origin pinned afterwards; token still required on every request | Copy-pasting the token | Web pages cannot forge Origin, so pairing is as strong as the file-based token against the web; a rival extension could race it during the window |
| State | Bridge memory; stateless worker | Extension storage | MV3 workers sleep; the bridge is the source of truth |
| Source detection | Main-world script with pluggable detectors | Content script only; React-only | Isolated worlds cannot see framework internals; a registry plus `__POINTER_SOURCE__` makes any stack addable without touching the pipeline |
| Confidence | Derived from whether the nearest component has a file | Trusting the page's claim | A wrong path is worse than none |
| Hook delivery | Once per selection | Every prompt for 10 minutes | Re-injecting the same block on every prompt is noise and cost |
| Relay | None | Hosted relay, accounts | Adds privacy risk and surface the goal does not need |
| Bundling | esbuild, no framework in the extension | React/Vite UI | Under 20 KB of content script; the UI is a closed shadow root |

## Source mapping notes

- React 17/18: `_debugSource` on a fiber is where that *element* was written, i.e. in its owner's file. Pointer therefore assigns the host fiber's location to the nearest component, and each component's usage site to the next one up. This is what makes the chain correct rather than off by one.
- React 19 removed `_debugSource`. Pointer falls back to the creation stack for the **file only**; transformed line numbers from a dev server are not trusted.
- Production builds: nothing useful is exposed; hints only.

## Known limits

- Cross-origin iframes and closed shadow roots are not traversed. Same-origin iframe content has no source mapping (the main-world script runs only in the top frame).
- Screenshots need the `activeTab` grant that the shortcut or toolbar click provides; only visible parts of an element are captured.
- Page handlers registered on `window` in the capture phase before the picker starts can still run.
- Selections do not persist across bridge restarts by design.
