# Weave Hardening Pass — Decision Record

**Status:** Implemented + verified (Rust `cargo test --workspace` green, web
`typecheck`/`test`/`build` green).

This documents the fixes to the five review concerns raised against the
codebase, so the *reasons* (not just the diffs) survive.

---

## 1. MCP strategy: no more blanket protocol reject; legacy fallback

**Concern:** the client spoke only `2026-07-28` and rejected every other
revision (`discover` hard-failed on any non-2026-07-28 server).

**Fix (`src-tauri/src/mcp_client.rs`):**
- `discover` no longer rejects on version — it reports supported versions.
- New `ServerSession` + `choose_session` + `establish_session`: a server
  advertising `2025-06-18` is connected via the legacy `initialize` handshake
  (`Mcp-Session-Id` echoed on every request).
- New `list_tools_with_session` / `call_tool_with_session`: drive the legacy
  single-round-trip path; stateless servers short-circuit to the existing
  live-verified path.
- Refusal, when it happens, is precise at negotiation time (only truly
  unsupported revisions: `2024-11-25` and earlier / legacy bidirectional SSE
  transport).
- Hermetic mock-session test in `tests/mcp_integration_test.rs` proves the
  initialize handshake, session-id echo, and session-carrying list/call.

**Residual (documented, not silently hidden):** the Marketplace/registration
UX still prefers the live-verified `2026-07-28` stateless flow; wiring a legacy
server's tools through the full executor/OAuth path is a follow-up. The client
*capability to connect to* session servers now exists and is tested.

## 2. Test coverage

**Concern:** thin tests for a security-sensitive surface; bubblewrap tests
self-skipped.

**Fix:**
- New `utils/fs_security` tests: `..` traversal, symlink escape,
  missing-leaf-for-write canonicalization.
- New `utils/ssrf` tests: literal private hosts rejected without DNS, cloud
  metadata / loopback URLs denied, redirect targets re-validated.
- New `weave.ask_user` agent-loop integration test (pause → answers → native
  tool result → completion rule).
- `scripts/check_architecture.py` contract still passes.
- `.github/workflows/ci.yml` installs `bubblewrap` on Linux so the shell.exec
  sandbox tests actually run in CI instead of self-skipping.

## 3. Breadth / sustainability: OS keychain + accurate claims

**Concern:** tokens in plaintext `config.json`, no keychain; README overstated.

**Fix (`src-tauri/src/utils/secrets.rs` + `config.rs`):**
- Provider API keys + MCP OAuth tokens are mirrored into the OS keychain
  (macOS Keychain / Windows Credential Manager / Linux kernel keyring via the
  `keyring` crate, portable backends) and redacted from the on-disk JSON when
  the keychain accepts them.
- Full transparent fallback: any keychain unavailability (headless/container
  Linux) keeps the historical plaintext behaviour, so the app always works.
- README now describes keychain-with-fallback instead of "no OS keychain".

## 4. Vestigial crates / single sandbox story

**Concern:** dead `capabilities` crate; dead `runtime-kernel` modules including
a fake `sandbox.rs`; two sandbox stories.

**Fix:**
- Deleted `crates/capabilities` (unused — `coder_plugin::capabilities` is a
  submodule, not the crate) and dead `runtime-kernel` modules (`kernel`,
  `sandbox`, `blackboard`, `subsystem`, `task_graph`, `artifact`,
  `policy_engine`, `resource_manager`); removed their deps (`memory-stats`,
  `async-trait`, `wait-timeout`) and the `src-tauri` dependency on the crate.
- One sandbox story remains: bubblewrap in `shell_plugin.rs` (fail-closed).

## 5. Smells

**Fix:**
- Turkish error strings → English (`llama_swap.rs`, `agent/mod.rs`); removed
  the Turkish scrivener note reference in code comments.
- Replaced the hand-rolled `<questions>` XML protocol with a native
  `weave.ask_user` tool: real JSON Schema (`PluginManager::ask_user_schema`),
  agent-loop handling that bypasses the approval gate, answers returned as a
  normal native tool result, and the XML parser + prompt block deleted.

## Verification

```sh
nix-shell shell.nix --run 'cargo test --workspace'   # Rust (all pass)
npm run typecheck && npm test && npm run build       # web (all pass)
```

---

## Follow-up audit — additional findings and disposition

A second review pass (beyond the original five concerns) found and resolved:

| # | Finding | Disposition |
|---|---------|-------------|
| A1 | **Single global cancellation token.** `AppState.abort_generation` was one `Arc<AtomicBool>` shared by every generation: starting a new message reset it (`chat.rs:59`), so an already-aborted prior run could be silently un-aborted, and Stop killed every active generation. | **Fixed** — each generation now owns a fresh per-run token (`AppState.current_run: Mutex<Option<Arc<AtomicBool>>>`); `AgentLoop::run` takes `run_abort`; `chat_abort_generation` targets the latest run only. |
| A2 | **Dead `runtime-kernel/src/errors.rs`** (`KernelError` + its `WeaveError` had no users after the crate prune). | **Fixed** — module + `thiserror` dep removed. |
| A3 | **AiBridge config staleness suspicion** (`ai_bridge.config` is a startup clone; a single `update_config` call). | **Verified OK** — the only AI-config writer is `system_set_config`, which always calls `update_config(config.ai.clone())`; SettingsPanel routes every save through it. No change needed. |
| A4 | **MCP OAuth access-token expiry** — no auto-refresh on 401 inside `tools/call`; token expiry leaves tools failing until manual re-authorize. | **Documented limitation** (already stated in README). Deliberately not half-implemented; an executor without a config/AS handle would ship broken refresh. |
| A5 | **`weave.ask_user` is native-tool-only** — local models with `use_native_tools=false` (tools cleared) can no longer ask clarifying questions the way the old `<questions>` XML allowed. | **Accepted + documented** — low-capability local models lose the interactive ask; a prompt-based XML degrade path was intentionally not reintroduced (it was the smell being removed). |
| A6 | **Keychain probe wrote a throwaway credential** on first use (side effect). | **Fixed** — `keychain_available()` now probes platform support via `Entry::new` with no write; write failures still fall back. Also wired `delete_mcp_secrets` on server removal so orphaned OAuth tokens are purged. |
| A7 | **Frontend coverage / bundle.** | **Fixed (coverage)** — added `weave.ask_user` questions-card store tests (dedupe / submit / clear). Bundle code-splitting remains a polish note (1.9MB single chunk). |
| A8 | **Compiler warnings** (unused imports, shared-test-harness dead-code). | **Fixed** — cleaned unused imports; `#![allow(dead_code)]` on the shared test harness with a comment explaining it is compiled into several binaries. |
