# Changelog

All notable changes are documented here. Format follows [Keep a Changelog](https://keepachangelog.com), versions follow [SemVer](https://semver.org).

## [0.1.0] - Unreleased

### Added
- `pointer setup` (registers the MCP server, installs the Claude Code hook, unpacks the bundled extension) and `pointer doctor` (checks each link and prints the fix).
- Delivery receipt: the toast changes to "✓ Your agent has it" once the agent reads the selection, or says what to do if it has not after 20 seconds.
- Simpler options page: one status line and one fix, with settings and advanced collapsed.
- Chrome/Edge (Manifest V3) extension: hover overlay, click-to-select, shift-click multi-select with a removable tray, keyboard operation (arrows, Space, Enter, Esc), cropped screenshot, in-page instruction field, "Copy as prompt", connection status badge, per-site gating.
- Local bridge (`pointer-bridge`): loopback-only HTTP API, token auth, Host and Origin checks, strict CORS, payload caps and schema validation, in-memory store with TTL.
- MCP server over stdio: `get_selected_element`, `list_selections`, `clear_selection`, and a `pointer://selection` resource.
- Claude Code `UserPromptSubmit` hook that injects a fresh selection once, inside an untrusted-content delimiter.
- Stack-agnostic source mapping: React (17 to 19), Vue 2 and 3, Svelte 4 and 5, Angular (dev), Astro and common inspector-plugin attributes, web components, and a `window.__POINTER_SOURCE__` escape hatch for any other stack. Honest `confidence` of `exact`, `component-only` or `none`.
- Zero-step bridge: `pointer mcp` hosts the HTTP bridge, so registering the MCP server is the whole agent setup. Extension pairs automatically (trust-on-first-use, origin pinned); no token to copy.
- `page:` now includes the page title, and `page-file:` names the route file (exact from the component chain or `window.__POINTER_PAGE__`; inferred and labelled for Next.js).
- Payload sanitizer: no form values, password fields masked, SVG bodies and `data:` URIs replaced, credentials and secret-looking query values stripped.
