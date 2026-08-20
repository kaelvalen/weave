# Weave architecture

A concise map of how Weave fits together. Deeper records live in the phase
specs (`docs/phase*.md`) and the decision/hygiene docs
(`docs/defensive-patterns.md`, `docs/testing.md`, `docs/dsh-findings.md`,
`docs/postmortem/`).

## Shape

Weave is a Tauri desktop app with two halves:

- **Rust backend (`src-tauri/`)** owns the agent loop, all security decisions,
  and execution. It is the source of truth.
- **React + Zustand (`src/`)** renders the stream and relays UI decisions
  (approvals, answers). It never gates security.

```
React (render + relay)
  │  chat-stream / tool-call events   chat_approve_tool_call / chat_submit_answers
  ▼
Tauri commands + events
  ▼
AgentLoop (agent/mod.rs) ── per-run cancellation token
  ├─ AiBridge → OpenAI/Anthropic/Ollama/llama-server (native tool-calling)
  ├─ capability_policy (approval gate; MCP defaults gated)
  ├─ PluginManager → builtin / Python / WASM / MCP executors
  └─ execute_call: each tool on its own OS thread, bounded by TOOL_EXEC_TIMEOUT
```

## The agent loop

`agent/mod.rs` streams provider events, accumulates native tool-call deltas,
resolves them against the plugin registry, runs the approval gate, executes on
a bounded worker thread, and appends a **native tool result for every call_id**
(the completion rule) so the next provider request is never malformed. It stops
when a turn produces no tool calls, hits `MAX_ROUNDS`, or its own
cancellation token is set. Human-in-the-loop questions are the native
`weave.ask_user` tool, not an XML protocol.

## Plugins & capabilities

Plugins declare capabilities with real JSON Schemas
(`plugin_manager.rs`); native tool definitions are built from them. Built-in
Rust executors plus Python/PyO3 and WASM runtimes; MCP servers register as
capability sources (`mcp_client.rs`). Every capability has a backend
approval classification (`capability_policy.rs`), mirrored read-only on the
frontend with a drift-guard test.

## MCP

A client for the stateless `2026-07-28` revision (live-verified) with a legacy
`2025-06-18` session-based fallback (negotiated `initialize` + per-call
session). OAuth 2.1/CIMD authorization is implemented; every MCP capability is
gated by default and only an explicit `(server, tool)` allowlist opens it.
Scope and transport notes: `docs/phase8-mcp-spec.md`.

## Security model

See `docs/defensive-patterns.md` for the rules; the invariants are:

- **Backend owns the gate.** The frontend only displays it.
- **Deny by default.** Unclassified capabilities, unknown hosts, unsupported
  protocols, and non-allowlisted MCP tools are all rejected.
- **One sandbox.** Process execution goes through bubblewrap in
  `shell_plugin.rs` (fail-closed, read-only rootfs beyond the workspace bind).
- **SSRF + FS confinement.** Outbound HTTP revalidates every redirect; paths
  canonicalize (`..`, symlinks) then confine to workspace/app-data.
- **Bounded everything.** Tool execution has a timeout; context has a budget;
  runs have a round cap and a per-run cancel token.
- **Secrets.** Provider keys + MCP tokens mirror to the OS keychain and are
  redacted from plaintext when available (full fallback otherwise).

## Storage

One plaintext `~/.weave/config.json` for config + MCP state (secrets redacted
or keychain-backed); JSON files for notes/memory/workflows; the runtime event
bus feeds an in-memory/projected execution view (`runtime-kernel`).

## Crates & runtime

`crates/runtime-kernel` is a deliberately thin micro-kernel (event bus/store,
execution context, observability, runtime events) — only what the backend
uses, no dead framework. Process sandboxing has a single home (bubblewrap).
