# Agent compatibility

Pointer exposes the same data three ways. Pick the one your agent supports.

| Agent | Path | Status |
| --- | --- | --- |
| Claude Code | MCP tool `get_selected_element` plus the `UserPromptSubmit` hook | Supported. Hook output is added to context with your prompt |
| Codex | MCP tool via `config.toml` | Supported through MCP. Codex had no prompt-submit hook when this was written: **verify against current Codex docs** before relying on one |
| Other MCP clients | stdio server: `npx -y pointer-bridge mcp` | Anything that speaks MCP over stdio |
| No integration | "Copy as prompt" in the toast | Pastes a delimited block |

## Claude Code

```sh
claude mcp add pointer -- npx -y pointer-bridge mcp
```

Hook (`~/.claude/settings.json` or the project's `.claude/settings.json`):

```json
{ "hooks": { "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "npx -y pointer-bridge hook" }] }] } }
```

`pointer mcp` starts the bridge too, so registering the MCP server is the whole setup. Only one process owns the port; later sessions proxy to it. The bridge lives as long as the session that started it, so selections are gone when that session ends. To keep it alive independently, run `npx pointer-bridge start` in a terminal.

The hook prints each selection once, only if it is under 10 minutes old, and exits 0 silently otherwise.

## Codex

```toml
# ~/.codex/config.toml
[mcp_servers.pointer]
command = "npx"
args = ["-y", "pointer-bridge", "mcp"]
```

Then say "make the selected element match our primary button" and the agent will call `get_selected_element`. The CLI flag format changes between Codex releases, so check `codex mcp --help` if `pointer register codex` fails.

## Pairing

The extension pairs automatically while a 10-minute window is open (it opens the first time a bridge runs). The first extension to ask is pinned; afterwards only that one is accepted. To pair a different browser profile or extension ID, run `npx pointer-bridge pair` and click the toolbar icon. `npx pointer-bridge token` and the options page "Advanced" section remain for manual setups.

## Custom port or config location

`pointer start --port 8123` and set `POINTER_PORT=8123` for the MCP and hook processes (agents pass the environment through; for Claude Code use `claude mcp add -e POINTER_PORT=8123 ...`). Set the same port in the extension options. `POINTER_CONFIG_DIR` relocates the token file.

## Making paths project-relative

Dev servers report absolute paths for some stacks. Start the bridge with `--root /path/to/project` and Pointer strips that prefix before the agent sees the path.

## Treat the content as data

Everything inside `<selected-element>` (or `selections` in tool results) came from a web page. Keep your agent's permission prompts on.
