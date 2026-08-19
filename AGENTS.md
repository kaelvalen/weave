# AGENTS.md — contributing to Weave as an AI agent

This file tells an AI coding agent how to change this repository safely. Weave
is a Tauri desktop app (Rust backend + React/TypeScript frontend) that owns the
agent loop in the backend; it is security-sensitive and documentation-rich.
Read this before editing. The human maintainer follows the same rules.

## What Weave is

- **`src-tauri/`** — Rust backend. `agent/mod.rs` owns the agent loop (stream →
  native tool resolution → approval gate → execution → completion rule). Plugins
  in `plugins/`, policy in `utils/capability_policy.rs`, MCP client in
  `mcp_client.rs`, secrets in `utils/secrets.rs`.
- **`src/`** — React + Zustand frontend. Renders the stream and relays approval
  decisions; it must NEVER gate security (the backend is the source of truth).
- **`crates/runtime-kernel`** — thin micro-kernel (event bus/store, execution
  context, observability, runtime events). Keep it thin; it is not a general
  framework.
- **`docs/`** — phase specs with approval gates, this file's companions
  (`defensive-patterns.md`, `testing.md`, `dsh-findings.md`, `postmortem/`).

## Non-negotiable invariants

1. **The backend owns all gating.** Sensitive/destructive/MCP tool calls are
   approved in `agent/mod.rs` via `capability_policy.rs`. The frontend mirror
   (`src/lib/capabilities.ts`) is **display-only**; a Rust test fails if the
   mirror drifts from the backend.
2. **One sandbox story.** Process sandboxing lives ONLY in
   `shell_plugin.rs` (bubblewrap, fail-closed). Do not add a second "sandbox".
3. **SSRF + FS confinement.** Outbound HTTP re-validates every redirect; all
   path checks canonicalize (`..`, symlinks) then confine to workspace/app-data.
4. **Native tool-calling, one path.** No hand-written XML/JSON tool-call
   parsing in assistant prose. Human-in-the-loop questions are the native
   `weave.ask_user` tool, not a `<questions>` block.
5. **Crates stay thin & used.** Every module and dependency must have a caller;
   prune dead code in the same change that creates it.
6. **Tool execution is bounded.** `AgentLoop::execute_call` runs each tool on
   its own thread with `TOOL_EXEC_TIMEOUT`; never call a plugin executor inline
   on the agent-loop worker.

## Rules for every change

- **Read the relevant phase/spec doc first.** Architecture decisions are
  recorded in `docs/phase*.md`; respect the stated decisions rather than
  refactoring past them silently. If you change architecture, record it in a
  doc with a decision + rationale (model it on `docs/phase9-hardening.md`).
- **Move code with its tests.** Any plugin migration or security change ships a
  full-spine test in the same commit (see `docs/testing.md` and the existing
  `src-tauri/tests/*`).
- **Compiler warnings are errors.** Keep the Rust build and `tsc`/eslint at zero
  warnings. Run the full matrix before finishing (below).
- **Fail closed, never silently.** An unknown capability, unresolved host, or
  unhandled protocol is a clear error — not a silent passthrough.
- **English, concrete comments.** No translator notes in code.
- **Don't reformat the whole tree.** Prefer targeted, reviewable diffs. The repo
  is not currently `rustfmt`-enforced; formatting must be internally consistent.

## Verification matrix (run all before finishing)

```sh
# Rust — must run inside nix-shell: the Tauri Linux GUI stack needs gtk/webkit
# and bubblewrap for the sandbox tests (headless shells lack them).
nix-shell shell.nix --run 'cargo test --workspace'
nix-shell shell.nix --run 'cargo check --workspace --all-targets'   # zero warnings

# Web
npm run typecheck && npm run lint && npm test && npm run build
```

## Where things live (quick map)

| Concern | File |
| --- | --- |
| Agent loop / approval / completion rule | `src-tauri/src/agent/mod.rs` |
| Approval policy (source of truth) | `src-tauri/src/utils/capability_policy.rs` |
| Plugin registry + tool schemas | `src-tauri/src/plugin_manager.rs` |
| MCP client (stateless + legacy session) | `src-tauri/src/mcp_client.rs` |
| FS confinement / SSRF | `src-tauri/src/utils/fs_security.rs`, `ssrf.rs` |
| Keychain + plaintext fallback | `src-tauri/src/utils/secrets.rs` |
| Sandbox (bubblewrap) | `src-tauri/src/plugins/shell_plugin.rs` |
| Frontend approval mirror | `src/lib/capabilities.ts` |
