# Contributing

Thanks for helping. Pointer is deliberately small (about 3,000 lines of TypeScript for v1), so the bar for new code is "does this serve the core loop: click, hand over, edit the right file".

## Setup

```sh
corepack enable        # or: npm i -g pnpm
pnpm install
pnpm build
pnpm test              # unit + bridge integration + MCP contract + hook
pnpm test:e2e          # Playwright, loads the real extension in Chromium
pnpm lint && pnpm typecheck
```

Load `packages/extension/dist` as an unpacked extension in `chrome://extensions`.

## Layout

| Path | What |
| --- | --- |
| `packages/core` | Data contract (zod), sanitizer, selector builder, formatter, path normalizer. No I/O. |
| `packages/bridge` | HTTP API, MCP server, hook, CLI. Node 20+, no native deps. |
| `packages/extension` | MV3 extension: service worker, content script, main-world detectors, options. |
| `examples/` | Fixture pages (React, Vue, plain, custom) and the Playwright suite. |

## Adding source mapping for a stack

This is the most useful contribution. Detectors live in `packages/extension/src/page/detectors.ts` and are plain functions `(el, window) => { framework, components } | null`.

1. Find what the dev build exposes on DOM nodes or globals.
2. Add a detector and register it in `DETECTORS`.
3. Add unit tests with synthetic nodes in `packages/extension/test/detectors.test.ts`. If a real fixture is cheap, add one to `examples/fixtures` and an e2e case.
4. Only return `file` when you are sure. A wrong path is worse than none. `confidence` is derived: `exact` means the nearest component has a file, `component-only` means names only.

## Security-sensitive changes

Anything touching `server.ts`, the sanitizer, `format.ts`, or extension permissions needs a test that fails without the change, and a note in `SECURITY.md` if the threat model moves. Please do not add dependencies without a strong reason; the supply chain is part of the threat model.

## Commits and PRs

Small PRs, one concern each. Update `CHANGELOG.md` for user-visible changes.
