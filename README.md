# Pointer

[![CI](https://github.com/raghavendra7533/pointer/actions/workflows/ci.yml/badge.svg)](https://github.com/raghavendra7533/pointer/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/pointer-bridge)](https://www.npmjs.com/package/pointer-bridge) [![license: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Click any element in Chrome. Your coding agent knows exactly what you mean, and which file to edit.**

Pointer hands the element you clicked (DOM, styles, screenshot and source location) to Claude Code, Codex, or any MCP-capable agent. No pasting HTML, no "the second blue button in the header card". Everything stays on your machine.

<!-- demo GIF goes here: click, prompt, agent edit (under 15 seconds) -->

## Quick start

```sh
npx pointer-bridge setup
```

That registers Pointer with Claude Code (and Codex if installed), installs the hook that hands your selection to the agent, and unpacks the browser extension. Then, once per browser, open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick the folder `setup` printed.

Press `Alt+Shift+P` on any page, click an element, and tell your agent what to change. The toast says **✓ Your agent has it** when it has read the selection. If something is off, run `npx pointer-bridge doctor`: it checks each link from browser to agent and prints the fix.

## How you use it

| You do | Pointer does |
| --- | --- |
| `Alt+Shift+P` or toolbar icon | Enters pick mode; hover draws an overlay labelled with tag, classes and component name |
| Click | Selects, suppresses the page's own click handlers, sends to the bridge, toasts `Sent to agent: button.btn in PricingCard`, then `✓ Your agent has it` once the agent reads it |
| Shift-click | Adds to a tray of numbered chips (up to 10). `Enter` sends them in order, `Esc` cancels |
| Type in the toast field (optional) | Stores your instruction as `userNote` alongside the selection |
| "Copy as prompt instead" | Puts a formatted block on the clipboard for agents without MCP. Includes anything typed in the box |
| Arrow Up/Down, Space, Enter | Keyboard-only picking: parent/child, select, confirm |

The toolbar badge is a green dot when the bridge is up, red when it is down (it starts with your agent), amber when not paired.

The prompt names the page, its URL and title, and the file that renders it (`page-file: app/account/page.tsx`) when it can tell. A file read from the component chain or from `window.__POINTER_PAGE__` is exact; one inferred from the URL (Next.js) is labelled as a guess. Any stack can set `window.__POINTER_PAGE__ = "src/routes/account.tsx"`.

## It works with any stack

Pointer always gives the agent grep-friendly hints (selector, classes, `id`, `data-*`, visible text). On top of that it maps the element to a component and file when your stack exposes it, and says so honestly with `confidence`: `exact` (the nearest component has a file), `component-only`, or `none`.

| Stack | How | Result |
| --- | --- | --- |
| React 17 to 19 (dev) | Fiber walk; `_debugSource`, or the creation stack on React 19 | Component chain, file, and line when available |
| Vue 2 and 3 (dev) | `__vueParentComponent` / `__vue__` and `__file` | Component chain and file |
| Svelte 4 and 5 (dev) | `__svelte_meta` | File, line, column |
| Angular (dev) | `ng.getOwningComponent` | Component chain (names only) |
| Astro, Vue inspector, code-inspector, react-dev-inspector, `data-source` | Attributes written by the dev plugin | File and line |
| Lit, Stencil, vanilla web components | Custom element tags across shadow roots | Component names |
| **Anything else** (Solid, Qwik, Marko, htmx, your own) | `window.__POINTER_SOURCE__` | Whatever you return |

Plug any stack in with one function in your dev entry point:

```js
if (import.meta.env.DEV) {
  window.__POINTER_SOURCE__ = (el) => lookUpYourComponent(el) // → { framework, components: [{ name, file, line }] } or null
}
```

Production builds expose nothing useful; Pointer falls back to hints. A wrong path is worse than none, so Pointer never guesses.

## Agent setup

**Claude Code.** `npx pointer-bridge register claude` adds the MCP server. For automatic context, add the hook to `~/.claude/settings.json` (it prints the selection once, inside an untrusted-content block, and stays silent when there is none, it is stale, or the bridge is down):

```json
{ "hooks": { "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "npx -y pointer-bridge hook" }] }] } }
```

**Codex and other MCP clients.** `npx pointer-bridge register codex`, or add to `~/.codex/config.toml`:

```toml
[mcp_servers.pointer]
command = "npx"
args = ["-y", "pointer-bridge", "mcp"]
```

The agent calls `get_selected_element` when you say "this" or "the selected element". See [docs/agents.md](docs/agents.md) for details and what has been tested.

## Safe by default

Loopback only, token on every request, `Host` and `Origin` checks, no form values ever read, passwords masked, banking and mail sites off by default, no telemetry. Page content reaches your model provider through your agent, and is marked as untrusted data. Keep your agent's permission prompts on. Details: [SECURITY.md](SECURITY.md).

## What Pointer is not

No hosted service, accounts, or analytics. Not a browser-automation or testing tool (use Playwright or the Chrome DevTools MCP). It does not edit the page or your files; the agent does. Chromium-based browsers only for now.

## How it compares

Stagewise, React Grab and the Chrome DevTools MCP overlap with parts of this. Pointer's angle: **agent-agnostic through MCP**, **honest source-mapping confidence across stacks**, and a **written threat model with tests** for the localhost bridge. Check the others and pick what fits.

## Docs

[ARCHITECTURE.md](ARCHITECTURE.md) · [SECURITY.md](SECURITY.md) · [docs/agents.md](docs/agents.md) · [CONTRIBUTING.md](CONTRIBUTING.md) · [CHANGELOG.md](CHANGELOG.md)

## Roadmap

Next: signed Web Store listing, selection history, full iframe and closed shadow DOM traversal, a payload preview before sending, Firefox. Open an issue if one of these would unblock you.

MIT licensed.
