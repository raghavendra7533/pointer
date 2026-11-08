# Security

Pointer reads page content and hands it to an agent that can edit files and run commands. The two risks that matter are **a hostile page steering the agent** and **other local processes or websites abusing the bridge**. This document is the short form of the threat model.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting ("Security" tab, "Report a vulnerability") instead of a public issue. Expect a first response within 72 hours. Do not include real secrets in reports.

## Threat model

| Threat | Impact | Mitigation (and where it is tested) |
| --- | --- | --- |
| A website posts to the bridge on localhost | Fake selections injected into the agent's context | Token on every request (constant-time compare); `Origin` must be a `chrome-extension://` id (optionally pinned with `--origin`); no wildcard CORS; only `application/json` accepted. `packages/bridge/test/server.test.ts` |
| DNS rebinding against `127.0.0.1` | A remote page reaches the bridge as if local | `Host` must be `127.0.0.1:<port>` or `localhost:<port>`; checked before anything else. Same test file |
| A malicious extension or page tries to pair | It obtains the token | Pairing is trust-on-first-use: it works only while a 10-minute window is open and nothing is paired, requires a `chrome-extension://` Origin that web pages cannot forge, and pins that origin afterwards. Re-pairing needs a local `pointer pair`. Residual risk: another extension you install could win a race during the window. `packages/bridge/test/pairing.test.ts` |
| Another local user or process reads the token | Unauthorized access to selections | Token file with `0600` in a `0700` directory, re-tightened on start; bridge binds `127.0.0.1` only. Note: any process running as *you* can still read it. That is out of scope for a local dev tool |
| Prompt injection via page text or HTML | Hostile page tells the agent to run commands or exfiltrate data | The user's own note is typed into the extension (a page cannot write to it) and is rendered *outside* the untrusted block as `<user-instruction>`; everything from the page stays inside. Output wrapped in `<selected-element untrusted="...">`; page text cannot close the block (the closing tag is escaped, newlines flattened); the MCP tool descriptions and result `notice` say page content is data; nothing is ever auto-executed. **Keep your agent's permission prompts on.** `packages/core/test/format.test.ts` |
| Sensitive data in the DOM | Secrets sent to a model provider | Form `value`s never read; password fields reduced to `<input type="password">`; `data:` URIs and SVG bodies replaced; secret-looking URL query values redacted, credentials and hash dropped; banking, mail and sign-in sites blocked by default; optional allowlist-only mode. `packages/core/test/sanitize.test.ts`, e2e leak test |
| Over-broad extension permissions | Review friction and distrust | `activeTab`, `scripting`, `storage`, `alarms`; host access to `127.0.0.1` and `localhost` only. No `<all_urls>`. Scripts are injected on demand, never at page load |
| Malicious page script spoofs the source resolver | Wrong file path shown | The page world is untrusted by nature; results are clamped and confidence is recomputed in the isolated world. Treat paths as hints |
| Supply-chain compromise | Malicious code in a trusted dev tool | Two runtime dependencies in the bridge (`zod`, `@modelcontextprotocol/sdk`); none in the extension; lockfile; Dependabot; npm provenance on publish |

## Known limits

- Content that reaches the model is whatever is in the selected element (up to 3,000 characters of HTML plus attributes and a screenshot). Selected content is sent to whichever model provider your agent uses.
- Same-origin iframes and open shadow roots are traversed; closed shadow roots and cross-origin iframes are not.
- Selections live in memory only. They are marked stale after 10 minutes (`--ttl`) and dropped after an hour. Screenshots are never written to disk.
- The hook and the stdio MCP process read the token file directly, so they work only as the same OS user that started the bridge.

## Privacy

No telemetry, no analytics, no network calls except to `127.0.0.1`.
