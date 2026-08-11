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

Supported active runtime executors are `builtin`, `wasm`, and `python`. The
manifest model recognizes `nodejs` for compatibility, but no Node.js executor
is currently registered.

## Project Status

- [x] Chassis inventory and keep/discard decisions
- [x] Backend-native agent loop and provider tool-call streaming
- [x] Backend approval policy and native completion-rule handling
- [x] Plugin JSON Schema migration and spine round-trip tests
- [x] Dead crate/module removal
- [x] Frontend Vitest scaffolding and security regression coverage
- [ ] Phase 6 UX audit with live screens and reproduction evidence

## Contributing

Contributions are welcome. Keep plugin schemas explicit, preserve the backend
approval boundary, and add a full-spine test in the same commit as any plugin
migration.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).

---

Built with the Weave Team.
