# Weave

> AI-native desktop workspace with backend-owned native tool calling.

Weave is a Tauri desktop workspace for chat, files, notes, plugins, local and
cloud models, and execution telemetry. The Rust backend owns the agent loop:
provider requests, tool resolution, approval decisions, plugin execution, and
native tool-result history. React renders the stream and relays approval
decisions.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Rust](https://img.shields.io/badge/rust-1.70+-orange.svg)
![Tauri](https://img.shields.io/badge/tauri-v2-purple.svg)
![React](https://img.shields.io/badge/react-18-blue.svg)

## Features

- **Backend agent loop** - `src-tauri/src/agent/mod.rs` continues provider
  turns until no further native tool calls are returned.
- **Native tool calling** - OpenAI-shaped providers, Anthropic, Ollama, and
  llama-server-backed GGUF models use structured tool calls rather than XML or
  JSON parsing from assistant prose.
- **Approval policy** - sensitive reads, network requests, and destructive
  operations are gated in the backend. The frontend policy copy is display-only.
- **Plugin system** - built-in Rust executors plus Python and WASM plugin
  runtimes, with `.wpk`/`manifest.toml` discovery.
- **Workspace security** - filesystem operations are canonicalized and confined
  to the workspace/app-data roots; outbound HTTP blocks private and reserved
  addresses and revalidates redirects.
- **Streaming UI** - chat text, tool-call state, approvals, execution traces,
  artifacts, sessions, and model telemetry are rendered in React/Zustand.

## Native Tool Calling

The old `<call plugin="...">` and free-text JSON heuristics are no longer an
execution path. The backend sends JSON Schema tool definitions to the provider,
accumulates streamed tool-call deltas, and appends a native result for every
tool-call ID:

- OpenAI-shaped providers use `assistant.tool_calls` and `role: "tool"` results.
- Anthropic uses `tool_use` and `tool_result` content blocks.
- Ollama uses its native `/api/chat` `tools` and `message.tool_calls` fields.
- GGUF models started by Weave's `llama-server` use the OpenAI-compatible
  `/v1/chat/completions` path.

If a provider or model does not support native tools, set
`ai.local.use_native_tools` to `false`. This is a static configuration choice,
not a runtime guess: a model returning text instead of a tool call cannot be
distinguished from a model legitimately deciding not to call a tool.

The local probe performed on 2026-08-11 produced these results:

- `Qwen3.5-9B-Q4_K_M.gguf` through `llama-server`: native streaming
  `tool_calls` and `finish_reason: "tool_calls"` confirmed.
- `qwen2.5-coder-7b-instruct-q4_k_m.gguf`: tools were accepted but the model
  returned XML text and no native `tool_calls`; use the static flag accordingly.
- Ollama 0.32.6 was also started with the same Qwen3.5 GGUF: both
  `stream:false` and `stream:true` requests to `/api/chat` returned native
  `message.tool_calls` with the expected `probe-ok` argument. The temporary
  probe model was removed after the test.

The Ollama/Qwen3.5 leg was independently re-run and verified on 2026-08-13
against a real local server (Ollama 0.32.7, `qwen3.5:9b`) with the
transcript committed: see `docs/probes/ollama-native-tools-2026-08-13/`.

## Architecture

```text
React + Zustand
  |  chat-stream-chunk / chat-tool-call-detected
  |  chat_approve_tool_call
  v
Tauri commands and events
  v
Rust AgentLoop
  |-- AiBridge
  |     |-- OpenAI-shaped providers
  |     |-- Anthropic
  |     |-- Ollama / llama-server
  |-- capability_policy (backend approval source of truth)
  |-- PluginManager
        |-- Built-in Rust plugins
        |-- Python runtime
        |-- WASM runtime
        |-- MCP client (2026-07-28, single-round-trip)
```

`runtime-kernel` supplies `ExecutionContext`, events, observability, and event
storage. The `capabilities` crate remains a coder-plugin routing helper. The
previous unused planning, workflow, knowledge, memory, and runtime crates were
removed after the architecture inventory.

## Built-in Plugins

| Plugin | Representative capabilities |
| --- | --- |
| File Manager | `file.read`, `file.write`, `file.list`, `file.search`, `file.delete`, `file.mkdir` |
| Calculator | `calc.eval`, `calc.convert`, `calc.stats` |
| Notes | `note.create`, `note.list`, `note.get`, `note.update`, `note.delete`, `note.search` |
| System | `sys.info`, `sys.time`, `sys.uptime`, `sys.hostname`, `sys.disk` |
| Shell | `shell.exec` with timeout and dangerous-command blocking |
| Web Fetcher | `web.fetch` with SSRF protection |
| HTTP Client | `http.request` with SSRF protection |
| SQLite | `db.query`, `db.execute`, `db.tables` |
| Git | `git.status`, `git.init`, `git.add`, `git.commit`, `git.log`, `git.diff`, `git.branch` |
| Memory | `memory.store`, `memory.recall`, `memory.delete`, profile operations |
| Canvas | node and edge actions delivered through Tauri events |
| Workflows | JSON-backed workflow templates, not the removed workflow-runtime crate |
| Coder | file inspection, patches, checks, search, symbols, history, and project operations |

Every built-in capability has a real JSON Schema definition. The backend
`capability_policy.rs` classification is mirrored by the frontend only for
badges and filters; a Rust test fails if the mirror drifts.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, TypeScript, Tailwind CSS, shadcn/ui |
| State | Zustand + Immer |
| Backend | Tauri v2 + Rust |
| Providers | OpenAI, Anthropic, Kimi, OpenCode, Ollama, llama-server |
| Plugin runtimes | Built-in Rust, Python/PyO3, WASM |
| Tests | Rust unit/integration tests + Vitest |

## Getting Started

### Prerequisites

- Rust 1.70 or newer
- Node.js 18 or newer
- Tauri system dependencies for your platform
- `cargo-tauri`, unless using the provided Nix shell

### Development

```bash
git clone https://github.com/kaelvalen/weave.git
cd weave
npm install
npm run tauri:dev
```

On NixOS or a matching Nix environment:

```bash
nix-shell shell.nix --run 'npm run tauri:dev'
```

Build the application with:

```bash
npm run tauri:build
```

Run checks with:

```bash
npm run typecheck
npm run lint
npm test
nix-shell shell.nix --run 'cargo test --workspace'
```

### Configuration

On first run, Weave creates `~/.weave/config.json`. Provider settings include
API keys, model names, endpoint URLs, temperatures, and token limits. Local
settings include:

```json
{
  "local": {
    "api_url": "http://localhost:11434",
    "model_alias": "llama3",
    "use_native_tools": true
  }
}
```

Set `use_native_tools` to `false` for a local model/template that does not
return structured native tool calls. Weave's GGUF path starts `llama-server`
itself and uses its OpenAI-compatible endpoint.

## Adding Plugins

Place `.wpk` files or plugin directories containing `manifest.toml` in
`~/.weave/plugins/`:

```text
~/.weave/plugins/
  my-plugin/
    manifest.toml
    engine/
      main.wasm
```

Example manifest:

```toml
[plugin]
id = "com.example.my-plugin"
name = "My Plugin"
version = "1.0.0"
author = "Your Name"
description = "What this plugin does"

[capabilities]
provide = ["my.capability"]

[capabilities.schemas]
"my.capability" = '{"type":"object","properties":{"value":{"type":"string"}},"required":["value"]}'

[capabilities.descriptions]
"my.capability" = "Process a string value"

[runtime]
type = "wasm"
entry = "engine/main.wasm"
```

Supported active runtime executors are `builtin`, `wasm`, `python`, and `mcp`
(see below). The manifest model recognizes `nodejs` for compatibility, but
no Node.js executor is currently registered.

## MCP Servers

Weave can add tools from an MCP server as a capability source, registered
into the same plugin registry as builtins — from the Plugin Marketplace
("Add MCP Server"), or via `mcp_add_server(url, name)`.

**Scope: MCP specification revision `2026-07-28` only.** This is the
stateless-core rewrite of MCP — no `initialize`/`Mcp-Session-Id` handshake,
`MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name` request headers, `resultType`
on every result, and Multi Round-Trip Requests (MRTR) in place of
server-initiated streams for mid-call input. **Older MCP revisions
(2025-11-25 and earlier, session-based) are not supported** — Weave calls
`server/discover` before trusting anything else from a server and rejects
one that doesn't declare `2026-07-28` support, rather than silently falling
back to a legacy transport.

Within `2026-07-28`, Weave implements **single-round-trip `tools/call`
only**. A server that responds with `resultType: "input_required"`
(MRTR mid-call elicitation, e.g. asking the user "Delete 3 files?" before
finishing) surfaces as a clear tool-execution error, not a hang — Weave
does not yet drive the follow-up round trip that would answer it.

**Live-server verified (2026-08-13):** a full `server/discover` →
`tools/list` → `tools/call` round trip was run through Weave's own client
against GitHub's official public MCP server (`api.githubcopilot.com/mcp/`),
which is protocol-2026-07-28. The run surfaced three real-world
requirements the mock tests couldn't: `_meta` protocol-negotiation fields
on every request, SSE-framed responses even for single round trips
(`event: message` / `data:`), and server identity under
`_meta.io.modelcontextprotocol/serverInfo` — all three now handled by the
client. Evidence and re-run instructions:
`docs/probes/mcp-live-github-2026-08-13/`.

**OAuth 2.1 / CIMD authorization (implemented 2026-08-13):** a server that
challenges 401 registers in an unauthenticated state; the Marketplace
"Add MCP Server" dialog then offers an **Authorize** step. Weave resolves
the challenge — `Mcp-Authorization` names the authorization server
directly, while `WWW-Authenticate: Bearer resource_metadata="..."` points
at an RFC 9728 protected-resource metadata document that must be fetched
first and read via its `authorization_servers` field — then performs RFC 8414 discovery — path-aware (§3: well-known between
host and issuer path) with append fallback, both forms existing in the
wild — opens the authorization page in the system browser
with a PKCE (S256) challenge and a CIMD client identity (an HTTPS
metadata-document URL), captures the loopback redirect, exchanges the
code for tokens, persists them in `~/.weave/config.json`, and
re-registers the server's tools. The RFC 9728 resolution step was added
after a live failure against Puter MCP exposed the naive
double-`.well-known` bug (2026-08-13). Token refresh
(`mcp_oauth_refresh`) is available; automatic refresh-on-401 inside a
tool call is not yet wired. Note: Weave does not yet host its CIMD
metadata document — set `WEAVE_CIMD_CLIENT_ID` if you host one, and see
`docs/phase8-mcp-spec.md` Part 2 §5 for the self-hosting prerequisite for
servers that strictly validate CIMD.

**Every MCP-sourced capability requires approval by default**, the same as
builtin `SENSITIVE_CAPS`/`DESTRUCTIVE_CAPS`, but for a different reason:
those are hand-classified by reading each plugin's code; an MCP server's
internals are third-party and opaque, and can change without Weave's
knowledge. There is no equivalent hand-classification to fall back to, so
the default is gated, full stop, until a specific server/tool is
explicitly allowlisted.

Server connection state — URL, discovered auth endpoints, tokens, and the
allowlist — lives in `~/.weave/config.json` alongside the existing provider
API keys: same plaintext-file storage this project already uses (no OS
keychain integration), extended rather than duplicated into a second store.
OAuth 2.1/Client ID Metadata Document (CIMD) authorization is scoped for a
follow-up — Weave does not yet run the CIMD flow, so only MCP servers that
require no authentication are connectable today.

Full design record: `docs/phase8-mcp-spec.md`.

## Project Status

- [x] Chassis inventory and keep/discard decisions
- [x] Backend-native agent loop and provider tool-call streaming
- [x] Backend approval policy and native completion-rule handling
- [x] Plugin JSON Schema migration and spine round-trip tests
- [x] Dead crate/module removal
- [x] Frontend Vitest scaffolding and security regression coverage
- [ ] Phase 6 UX audit with live screens and reproduction evidence
- [x] MCP (2026-07-28) integration: registry, default-gated approvals, single-round-trip tool calls
- [ ] MCP real-server validation against a live 2026-07-28 server (Phase 8.4 — not yet run)
- [ ] MCP OAuth 2.1/CIMD authorization flow (unauthenticated servers only today)

## Contributing

Contributions are welcome. Keep plugin schemas explicit, preserve the backend
approval boundary, and add a full-spine test in the same commit as any plugin
migration.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).

---

Built with the Weave Team.
