# Weave ↔ DeepSeek Harness: quality findings & rework plan

Companion to the DSH study clone (kept **outside** this repository's working
tree at `/tmp/dsh-clone`; this document records what was learned, not the cloned
code). DeepSeek Harness (`dsh`) is a large (~45-package) plugin-based agent
harness. **Weave is a much broader tool** — a Tauri desktop app with chat, a
backend-owned agent loop, native tool-calling across four provider protocols,
built-in + Python + WASM + MCP plugin runtimes, OAuth, an SSRF/sandbox security
surface, and a full GUI — so findings transfer where they apply to that breadth,
and are adapted rather than copied.

## What DSH does exceptionally well (and Weave's standing)

| # | DSH practice | Weave standing | Adopt? |
|---|--------------|----------------|--------|
| 1 | **Agent-facing contribution contracts** (`AGENTS.md` at root, `docs/`, and `.github/`; plus `CLAUDE.md`) — codified rules for AI agents editing the repo | Weave has excellent phase docs but **no AGENTS.md** | **Yes** — add root `AGENTS.md` |
| 2 | **`docs/defensive-patterns.md`** — "bug-class rules": patterns that *actually shipped or nearly shipped*, stated as the rule that prevents recurrence | Weave has hard-won lessons scattered in code comments + phase docs, not collected | **Yes** — add `docs/defensive-patterns.md` |
| 3 | **Incident postmortems** (`docs/postmortem/000N-*.md`) — numbered write-ups of real failures, with the rule that prevents them | Weave has live-probe transcripts but no postmortem culture | **Yes** — add `docs/postmortem/` |
| 4 | **`docs/testing.md`** + a `test-support` package and many vitest configs (unit / e2e / perf / stress / snapshot) | Frontend has 6 test files; Rust is solid | **Partially** — add `docs/testing.md`; grow frontend coverage |
| 5 | **Guard / loop-hygiene package** — bounds a run's tool calls and **times out individual tool executions on a worker thread** | Weave has `MAX_ROUNDS` + context-budget, but **tool execution ran synchronously on the agent-loop worker with no timeout** | **Yes** — implemented: async `execute_call` on its own thread with a 120s cap |
| 6 | **Fail-closed defensive defaults** (scrubbed env for spawned processes, private temp dirs, "never hand untrusted output the ambient environment") | Weave already does this (bubblewrap env allowlist, SSRF redirect revalidation, confined FS) | Retain — already strong |
| 7 | **Policy code under test** (`.github/issue-management/policy.mjs` is unit-tested) | Weave already unit-tests its frontend capability mirror against the backend source of truth | Retain — equivalent in spirit |
| 8 | **Comprehensive CI** with bounded concurrency, telemetry disabled in tests, explicit rationale comments per job | Weave CI is minimal (Rust+bubblewrap, web) | Retain, optionally grow later |
| 9 | "Everything is a plugin" / capability seams | Weave already has a real plugin system + capability registry/policy | Retain |

## The one code-level gap found and fixed

**Tool-execution timeout (guard).** Before this pass, `AgentLoop::execute_call`
called `plugin_manager.execute_capability(...)` **synchronously on the tokio
worker thread**: a hung tool (SQLite lock, stuck HTTP, runaway Python/WASM)
blocked the whole worker indefinitely and — because the abort flag is only
polled between tool calls — also made **Stop unable to interrupt it**. DSH's
`guard` package exists precisely to bound this.

**Fix (`src-tauri/src/agent/mod.rs`):** `execute_call` is now `async`, runs the
capability executor on its own OS thread, and awaits the result with a bounded
`TOOL_EXEC_TIMEOUT` (120s). Timeout and executor panic surface as normal
`CallOutcome::Error`s, still emit the StepFailed trace event, and the loop
continues against the model with a real error instead of stalling forever. This
is strictly better cancellation behavior on top of the earlier per-run abort
change.

## Weave-specific adaptation notes

Because Weave is broader, several DSH practices were adapted:

- **AGENTS.md** must cover not just "agent loop" but Weave's security
  invariants (backend-owned approval, single sandbox story, SSRF), its phase
  doc discipline, and the Rust+web test matrix.
- **defensive-patterns.md** draws rules from Weave's own shipped bugs
  (MCP OAuth RFC 9728 resolution, the bubblewrap write-illusion, the frozen-chat
  message creation, the context-budget overflow) rather than DSH's.
- **testing.md** documents Weave's real test matrix (Rust in `nix-shell shell.nix`
  because the Tauri Linux GUI stack needs gtk/webkit; web via vitest/tsc).
- Only patterns that transfer cleanly were adopted; DSH's vendoring, landlock
  native addon, and monorepo tooling are out of scope for a single-binary Tauri
  desktop app.
