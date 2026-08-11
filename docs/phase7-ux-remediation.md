# Weave Phase 7 — UX Remediation Backlog

Status: **OPEN** — backlog for findings from the Phase-6 screenshot audit.
Format: Bulgu → Kanıt (code references) → Öneri. Fixes land as separate,
reviewable commits; each fix should carry a regression test where testable.

## Closed in this audit (reference record)

| # | Finding | Fix commit |
|---|---|---|
| 1 | Duplicate notes (identical create invocations) | `d662412` — `note_plugin.rs::create` idempotent on (title, content); regression test with isolated HOME |
| 2 | Epoch dates (1/21/1970) — seconds fed to `new Date()` (ms) | `d662412` — `ChatMessage.tsx::formatTime` (`* 1000`); `ArtifactsView.tsx` artifact timestamp (`* 1000`). `useRuntimeStore` `ts: string` is chrono ISO-8601 — correctly untouched |
| 3 | Monitor contradicts status bar ("offline" while cloud model active) | `d662412` — `RuntimeView.tsx` Inference row derives from telemetry `active_model`; `· remote` annotation when not local; "Server" → "Local Server" |
| 4 | Plugin modal "Runtime" empty | `d662412` — wire contract: backend serializes `runtime_type` as `type` (`models/plugin.rs` `#[serde(rename = "type")]`); `types/plugin.ts` + `PluginCard.tsx:256` now read `runtime.type` |
| 5 | Anthropic Model field without placeholder | `d662412` — `SettingsPanel.tsx` placeholder `claude-sonnet-4-20250514` |
| 7 | Empty "Trace / No execution steps yet" box on plain-chat turns | `d662412` — `ChatMessage.tsx:487` wrapped in `hasPluginCalls \|\| hasRuntimeExecution` |
| 9 | Approval mode lacks a security-adjacent visual distinction | `(this commit)` — amber active state + inline "gate off" note in `ChatCommandCenter.tsx`; ConfirmDialog before enabling Auto-Approve; persisted-mode startup reminder (`lib/approvalReminder.ts`, once-per-runtime, non-dismissable, "Switch to Ask" action) + vitest regression |
| 10 | Theme delete sits flush next to Clone without confirmation | `(this commit)` — `SettingsPanel.tsx` delete now gated by ConfirmDialog ("Delete theme?" with active-theme fallback note), separated from "Clone to Custom" by a divider, with `aria-label`/`title`; store regression tests prove `deleteTheme` falls back to defaults when the active theme is removed |
| 8 | Files view breaks the single-nav pattern | `(this commit)` — the standalone 48px icon-only rail was removed; Explorer/Git/Search are now icon + visible-label tabs inside the 260px sidebar panel header. Follows the app-wide "every nav item has a visible label" convention without promoting Files-scoped concepts to the main navigation |
| 6 | Files status bar cursor/scroll mismatch | `(this commit)` — `FileEditor.tsx` now listens to `viewportChanged` (it was never handled, so the readout froze at "Ln 1, Col 1" on open). The cursor still tracks the real selection only; scrolling updates the visible range, and `lib/cursorReadout.ts` shows the first visible line (`Ln N · view`) while the cursor is scrolled out of view. Pure readout logic extracted and unit-tested (3 vitest cases) |

## Backlog

Phase 7 backlog is empty — all findings from the screenshot audit are closed.

## Dispositions (verified, not bugs — no action planned)

### #11 Profile shows seed data ("Weave User")

- **Kanıt:** `src-tauri/src/plugins/memory_plugin.rs:254-262` —
  `default_profile()` seeds name/role/bio/tech_stack. The stored
  `~/.weave/memory.json` matches name/role/bio/ai_directives but has
  `tech_stack: []` (the code default carries 6 items), so the stored profile
  was written before the current default or by an `update_profile` call with an
  empty stack — either way it is seed-sourced, not user-entered data.
- **Disposition:** expected behavior; `get_profile` falls back only when the
  `_user_profile` key is absent (`memory_plugin.rs:264-271`). If a user has
  never edited the profile, the UI legitimately shows the seed.

### #12 "Memory Health 100%" with zero signals

- **Kanıt:** `src/hooks/profile/useMemories.ts:174-179` — `memories.length === 0
  → return 100` is an explicit "all clear" default, then
  `avg confidence * 85 + volume term`.
- **Disposition:** intentional; can be revisited if the health formula is
  perceived as misleading (e.g. show "no signals yet" instead of a percentage
  when `memories.length === 0`).

## Backlog acceptance criteria

- Each fix ships with code references in its commit message (Bulgu → Kanıt →
  Öneri mapping from this document).
- Regression tests: vitest for frontend state/component logic; Rust unit or
  spine tests where backend behavior changes (mirror `note_plugin` dedup test).
- No backlog item merges without a test in the same commit (Phase-5 rule).
