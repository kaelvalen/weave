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

## Backlog (prioritized)

### P2 — #8 Files view breaks the single-nav pattern

- **Bulgu:** Files view adds a second, unlabeled icon rail (explorer/git/search
  icons with no tooltips) plus the file tree panel on top of the main sidebar —
  three nested chrome levels, unlike every other view.
- **Kanıt:** `src/components/files/FileManager.tsx:181` (`sidebarTab` state),
  `433-475` (activity bar `<button>`s with `title` attributes only, no visible
  labels), then `475+` the explorer panel inside a 260px sidebar column.
- **Öneri:** either label the rail (add tooltips + aria-labels at minimum,
  which are missing today) or fold explorer/git/search into the existing main
  navigation as tabs; decide in a design pass, not incrementally.

### P2 — #10 Theme delete sits flush next to Clone without grouping

- **Bulgu:** destructive filled delete button sits immediately beside "Clone to
  Custom" with no gap or grouping; no confirmation dialog visible.
- **Kanıt:** `src/components/settings/SettingsPanel.tsx:491-502` — outline
  "Clone to Custom" followed directly by `variant="destructive"` icon button;
  `deleteTheme(activeThemeId)` called with no confirm.
- **Öneri:** group clone/delete with spacing (e.g. `gap-2` + divider) and wrap
  delete in the existing `ConfirmDialog` pattern used by `FileManager`; only
  destructive styling may remain after confirmation.

### P3 — #6 Files cursor/scroll mismatch (needs reproduction)

- **Bulgu:** status bar reads "Ln 1, Col 1" while the viewport shows content
  around line 64. Low confidence — the user may have scrolled.
- **Kanıt:** `src/components/files/FileEditor.tsx:97` cursor initialized to
  `{line:1, col:1}`; updated on `vu.selectionSet || vu.docChanged` (`:249-253`),
  rendered at `:433`. Scroll position is not synced to the cursor.
- **Öneri:** reproduce in a live session first. If the cursor does not update
  after initial load, the update predicate needs a `vu.viewportChanged` case or
  the status bar should reflect the last visible line instead of the cursor.

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
