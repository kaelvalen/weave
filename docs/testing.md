# Weave testing guide

How Weave is tested, what the test tiers prove, and how to run them. Companion
defensive rules (the bug-classes these tests guard) are in
[defensive-patterns.md](defensive-patterns.md).

## Tiers

### 1. Rust unit tests (in-crate `#[cfg(test)]`)

Live in the same file as the code. Cover the pure logic that is cheap to test in
isolation:

- `utils/ssrf.rs` — private/public IP ranges, scheme/credential rejection,
  cloud-metadata/loopback denial, redirect re-validation (no DNS on literal IPs).
- `utils/fs_security.rs` — `..` traversal, symlink escape, missing-leaf
  canonicalization, within-root checks.
- `utils/capability_policy.rs` — destructive/sensitive classification, MCP
  default-gating, per-server allowlist scoping, **and the frontend-mirror drift
  guard** (fails the build if `src/lib/capabilities.ts` diverges from the
  backend).
- `utils/secrets.rs` — keychain redaction + secret collection (no keychain in
  tests: the plaintext fallback path is exercised).
- `agent/mod.rs` — context-budget trimming and the `weave.ask_user` arg contract.

### 2. Rust integration tests (`src-tauri/tests/`)

Run the spine end-to-end against a **mock SSE provider**, so the real
ai_bridge → agent loop → approval gate → plugin execution → completion-rule
machinery is verified, not inspected:

- `common/mod.rs` — mock OpenAI-compatible SSE provider + `Harness`
  (auto-approve, auto-answer), `assert_completion_rule` (every `tool_call` id
  has exactly one paired `tool` result — the "next request won't 400" proof).
- `agent_loop_test.rs` — approved/rejected/errored sensitive calls, plain-text
  turns with no gate, and the `weave.ask_user` pause→answer→resume flow (with a
  negative check that no `<questions>` XML ever reaches the wire).
- `phase5_plugins.rs` — one round-trip per built-in plugin proving the migrated
  path.
- `mcp_integration_test.rs` — MCP as a tool source through the same spine, plus
  the **legacy session-based (2025-06-18) negotiate/initialize/list/call**
  round-trip against a mock session server. Live-OAuth/GitHub tests are
  `#[ignore]`d (they need network + tokens) and documented in the file.
- `python_runtime_test.rs` — the Python/pyO3 runtime.

### 3. Web unit tests (`src/*.test.ts(x)`, vitest)

`useChatStore.test.ts` covers the backend-event → store contract (approval state
machine, stream-order segments, session-persistence guard, and the
`weave.ask_user` questions card: store/dedupe/submit/clear). Other stores and
libs (capabilities drift, artifacts, theme, commands) round it out.

### 4. Not-yet-covered / aspirational

- Frontend component/UI rendering of the approval card and the ask_user card
  (store-level contracts are covered; DOM interaction is not).
- A full-spine *timed-out* tool test (a deliberately hanging executor asserting
  `TOOL_EXEC_TIMEOUT`).
- E2E / snapshot / stress tiers (the harness has none; keep tests hermetic).

## How to run

Rust **must run inside nix-shell**: the Tauri Linux GUI stack needs gtk/webkit
system libraries and the sandbox tests need `bubblewrap`, neither of which the
headless shell has.

```sh
nix-shell shell.nix --run 'cargo test --workspace'            # all Rust tiers
nix-shell shell.nix --run 'cargo check --workspace --all-targets'  # zero warnings
nix-shell shell.nix --run 'cargo test -p weave --test mcp_integration_test -- --ignored --nocapture'  # live tests

npm run typecheck && npm run lint && npm test && npm run build  # web
```

CI (`.github/workflows/ci.yml`) runs the Rust suite with bubblewrap installed and
the web suite, so the self-skipping sandbox tests actually execute there.

## Rules

- Ship a full-spine test in the **same commit** as any plugin migration or
  security change.
- Keep all tiers green and the build at zero warnings before finishing a change.
- Hermetic over live: prefer mocks so tests run offline in CI; keep hard-to-mock
  coverage in small, clearly-documented `#[ignore]`d live tests.
