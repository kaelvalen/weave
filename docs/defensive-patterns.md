# Weave defensive patterns

Hard-won bug-class rules for Weave. Each entry is a class of defect that
shipped (or nearly shipped) in this codebase, stated as the rule that prevents
its recurrence. Read this before touching lifecycle, concurrency, security, or
agent-loop code. Companion test-tier guidance is in [testing.md](testing.md).

## A tool call must never block the agent loop indefinitely

`AgentLoop::execute_call` used to run the plugin executor synchronously on the
tokio worker. A hung tool (SQLite lock, stuck HTTP, runaway Python/WASM)
blocked the whole worker and — because the abort flag is polled only *between*
tool calls — made **Stop unable to interrupt it**. Now every executor runs on
its own OS thread and the loop awaits it with `TOOL_EXEC_TIMEOUT` (120s).
Rule: **never call a plugin executor inline on the agent-loop worker.**

## Cancellation is per-run, not global

Weave historically had one shared `Arc<AtomicBool>` abort: starting a new
message reset it, so a previously aborted run could be silently un-aborted, and
Stop killed every active generation. Rule: **each generation owns a fresh
cancellation token** (`AppState.current_run`), and `AgentLoop::run` takes the
token as a parameter.

## Fail closed, never passthrough

The approval gate, the SSRF guard, the filesystem confinement, and the MCP
version negotiation all default to **deny** for anything unclassified. An MCP
capability with no allowlist entry is gated even if its name reads as harmless —
a third-party server's behavior is opaque. An unknown capability id, an
unresolvable host, or an unsupported protocol is a clear error, never a silent
no-op.

## Every path canonicalizes before confinement

Literal prefix checks fail (`/tmp/../etc/passwd`, symlinks). Weave canonicalizes
(after `~`- and cwd-expansion, walking to the nearest existing ancestor) and
only then checks `is_within_any`. Always operate on the canonicalized path.

## Redirects are re-validated, and timeouts are bounded

`http.request`/`web.fetch` re-run the SSRF guard on every redirect hop and honor
`timeout_secs`. HTTP bodies and tool outputs are truncated before they reach
trace/telemetry so a huge result can't blow up state.

## Report orthogonal outcomes independently

A tool can fail for several reasons at once (timed out AND panicked AND returned
an error). Surface each independent fact on its own and normalize them through
one error path, so a caller never mistakes a cut-short run for a clean success.
`CallOutcome` distinguishes `Success` / `Error` / `Rejected`; the completion rule
requires every `call_id` to get exactly one paired result regardless of which.

## The frontend never gates

The backend owns all approval decisions. The frontend may *display* a gate
(`src/lib/capabilities.ts`) but never decides it — a Rust test fails if the
mirror drifts from `capability_policy.rs`.

## Don't reuse state across boundaries that can diverge

`AiBridge` holds a *copy* of the AI config; `system_set_config` is the only AI
config writer and always calls `update_config`. MCP tokens live in the OS
keychain and are redacted from `config.json`; `load()` rehydrates them from the
keychain — never leave the keychain and the file out of sync on two writes.

## Keychain access has no side effects in a probe

`keychain_available()` used to write and delete a throwaway credential just to
test the backend — an observable side effect. Probe platform support without
writing (`Entry::new`), and let per-operation writes fail back to plaintext.

## Principles

- **Backend owns the loop and the gate; the frontend renders.**
- **One sandbox; bounds everywhere; deny by default; English concrete messages.**
- **Ship a test with the change** (see `testing.md`), keep the build at zero
  warnings.
