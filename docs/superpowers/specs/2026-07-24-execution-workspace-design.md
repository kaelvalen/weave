# Execution Workspace — Design Spec

Date: 2026-07-24
Status: Approved direction (user), implementation in progress

## Problem

The product critique: the backend is an AI runtime platform, the UI is a chat client — they don't represent each other. Code-level findings sharpen this:

1. **Two backends exist; the rich one never runs.** The live path (`src-tauri`) is `chat_send_message → ai_bridge.chat_stream` (direct LLM call). The agent loop lives in the frontend (`src/stores/useChatStore.ts` parses `<call>` tags with regex, then invokes `plugin_execute`). The crates world (`planning`, `execution-runtime`, `cognitive-runtime`, `knowledge`) is declared as dependencies but almost never instantiated: `PlanStarted` is never constructed, `Executor::execute_plan` is a simulation stub, `cognitive-runtime/src/agent.rs` isn't even compiled.
2. **The UI shows fabricated data**, which is worse than empty screens: `StatusBar.tsx` hardcodes model name/latency/VRAM/workers/queue; `ExecutionView.tsx` empty-state stat cards are hardcoded; `LocalModels.tsx` shows identical hardcoded quant/ctx/flash-attn badges on every model; `runtime_get_observability` has permanently-zero counters (`total_planner_runs`, `total_tokens_consumed`, `memory_reads/hits`).

## Decision

**UI = a projection of the runtime event stream.** The UI binds to the event contract, not to planner internals. When the real planner is wired in later (Phase 2, out of scope here), the UI does not change.

Identity: *"Weave is an execution-first AI workspace."* First-15-seconds test: when the user submits a goal, the first thing on screen is a Goal card and a live step stream — the assistant text is the execution's output, not a chat bubble.

## Scope

### Phase 0 — Honesty pass

- Remove all hardcoded/fake stats from `StatusBar.tsx`, `ExecutionView.tsx` empty state, `LocalModels.tsx` badges. Show real data where available; hide what isn't available. Never fabricate.
- Hide the dead intent chip in `ChatMessage` (backend hardcodes `intent: None`).

### Phase 1 — Event contract + Execution Workspace

**Rust: extend `RuntimeEvent` (additive, back-compat)** in `crates/runtime-kernel/src/runtime_event.rs`:

```rust
pub struct RuntimeEvent {
    // ... existing fields unchanged ...
    pub params: Option<serde_json::Value>,  // tool input, strings truncated ~2KB
    pub output: Option<serde_json::Value>,  // tool result, truncated
    pub error: Option<String>,              // structured error message
}
```

**New Tauri commands** (registered in `src-tauri/src/main.rs`):

| Command | Signature | Purpose |
|---|---|---|
| `runtime_note_plan` | `(trace_id: String, title: String, steps: Vec<PlannedStep{plugin_id, capability}>) -> ()` | Emits genuine `plan_started` event (summary = goal title, `params.steps` = plan). Called by the frontend agent loop after parsing tool calls, before executing them. Honest: it records the actual plan of the loop that runs. |
| `trace_list` | `(limit: Option<usize>) -> Vec<TraceSummary>` | Persisted traces, newest first. `TraceSummary { goal_id, title, started_at, ended_at, step_count, failure_count, total_latency_ms, status: running/succeeded/failed }` |
| `trace_get` | `(goal_id: String) -> Vec<RuntimeEvent>` | All persisted events for one trace. |
| `runtime_get_model_stats` | `() -> ModelStats { active_model, ollama_running, total_tokens, last_tps, avg_tps, loaded_models: [{ name, vram_bytes }] }` | Real telemetry: Ollama `eval_count`/`eval_duration` captured in `ai_bridge` streaming (currently discarded), `/api/ps` for loaded models/VRAM. |
| `local_model_info` | `(filename: String) -> LocalModelDetails { quant, context_length, parameter_count }` | Best-effort GGUF header parse; nulls when unknown. |

**Persistence:** every `runtime-event` is appended as JSONL to `app_data_dir/traces/events.jsonl` (rotate at ~10k events / 8MB). Append happens in the existing bridge in `src-tauri/src/lib.rs` so all producers are covered.

**Observability:** `record_tokens` actually called (Ollama final-chunk stats; OpenAI/Anthropic usage best-effort).

**Bug fix:** `com.weave.builtin.workflow` / `com.weave.builtin.canvas` have executors registered but no `Plugin` entries in `create_builtin_plugins()` → `plugin_execute` fails with `PluginNotFound`. Add the entries.

**TypeScript mirror** (`src/types/runtime.ts`): `RuntimeEvent` + `ExecutionStep`, `TraceSummary`, `ModelStats`, `LocalModelDetails`, `PlannedStep` matching the above.

**Shared component:** `src/components/execution/StepTimeline.tsx` — `StepTimeline({ steps: ExecutionStep[], live?: boolean })`. Vertical node list: status icon (spinner → check/x), capability, plugin, latency, expandable params/output/error, entry animation (existing CSS keyframes, no new deps).

**Execution Workspace (chat view redesign):** user message → Goal card (not a bubble); below it the live execution section (plan steps from `plan_started` + step timeline fed by `runtime-event`s grouped by `goal_id` = message id); assistant answer de-emphasized as execution output; right panel lists artifacts produced by the thread (`artifact_produced` events, openable). `useChatStore` calls `runtime_note_plan` after parsing tool calls.

**Execution view (global history):** loads persisted traces via `trace_list`/`trace_get` on mount, merges with live ring buffer; honest empty state (real counts only); inspector shows params/output/error JSON.

**Chrome:** StatusBar shows only real data (active model from preference store, CPU/RAM, running-step count, tokens/TPS from `runtime_get_model_stats`, Ollama status); sidebar regrouped Workspace / Knowledge / System; command palette gains real capability search (`plugin_get_all`), memory search (`memory.recall`), and actions beyond the 10 hardcoded nav items; Models screen shows `local_model_info`/`runtime_get_model_stats` data, fake badges removed.

**Motion:** CSS keyframes only (existing `viewEnter`/`messageEnter`/`shimmer` idioms). No animation libraries. No new npm dependencies.

## Explicitly out of scope (Phase 2, later)

Wiring the real `PlannerEngine`/`TaskGraph`/`Executor` into the live path; DAG edges between steps (no edge data exists today); real planner decision records (reason/confidence); GPU telemetry beyond Ollama `/api/ps`; blackboard/knowledge-graph browsing.

## Design system constraints

Extreme-flat aesthetic: no box-shadows (globally disabled), 1px `border-border` separators only, `bg-surface-1/2` tokens, `font-mono text-xs` chrome, `text-[10px] uppercase tracking-wider` section labels, max font-weight 600. Match it.

## File ownership (parallel implementation)

- **BE (Rust):** `crates/runtime-kernel/*`, `src-tauri/*`
- **FE-workspace:** `src/components/chat/*`, `src/components/workspace/*` (new), `src/components/layout/Workspace.tsx`, `src/App.tsx`, `src/stores/useChatStore.ts`, `src/styles.css` (additive)
- **FE-execution:** `src/components/execution/*`, `src/stores/useRuntimeStore.ts`, `src/hooks/useRuntimeEvents.ts`, `src/types/runtime.ts`
- **FE-chrome:** `src/components/layout/{TopNav,WorkspaceSidebar,StatusBar}.tsx` (export names/props unchanged), `src/components/ui/CommandPalette.tsx`, `src/components/models/*`

## Verification

- `nix-shell --run "cargo check --workspace"` clean (plain `cargo` fails to link outside nix-shell on this NixOS host)
- `npm run build` (= `tsc && vite build`) clean
- Manual sanity: event contract serde round-trip test in `runtime_event.rs` extended for new fields

---

## Round 2 — Goal-centric consolidation (2026-07-24, user feedback round 2)

Design manifesto: **"The UI should visualize state transitions, not conversations."** Runtime speaks first, the LLM last. Everything below must remain honest — derived from real events/commands, never fabricated.

- **Goal as an object**: GoalCard carries status (running/completed/failed), started time, duration, and counts (plan steps / steps / artifacts / memory updates) via a new `goalStats(state, goalId)` selector in `useRuntimeStore`. User↔assistant message pairing: execution data is keyed to the assistant message id (= traceId); the user message's GoalCard displays the paired assistant message's stats.
- **Message order**: Goal → Execution (collapsed when done — progressive disclosure) → inline Artifact cards (name, created, size via `artifact_produced.params.size_bytes` — new backend stat in plugin.rs; Open/Reveal actions) → Assistant summary (collapsed by default when execution data exists; raw stream hidden while executing).
- **Human plan**: PLAN chips show capability descriptions from the plugin store (fallback: capability id).
- **Execution route merged**: the standalone Executions nav item is removed; `Workspace.tsx` routes 'execution' → chat; a bottom drawer in ChatCommandCenter (Ctrl+E) hosts the new shared `ExecutionPanel` (`goalIds?: string[]` prop — "This thread" vs "All traces" tabs).
- **Trace chain**: `ExecutionPanel` renders per-goal GoalTrace cards as stage sections — PLANNING (planned capabilities) → STEPS (StepTimeline) → ARTIFACTS (with size) → MEMORY (updates) — collapsible, running goals expanded with a planning pulse.
- **Models → Runtime view**: top "Loaded runtime" card (Ollama status, loaded model name/VRAM/context/TPS, session tokens) above the existing library/download UI.
- **Capabilities capability-first**: group by capability id across plugins ("N providers"), expand → provider plugins with state + real reliability metrics.
- **Memory categories**: `memory.store` accepts optional `category` (persisted, serde default for old entries); MemoryView groups Semantic/Procedural/Episodic/Working/General; Teach bar gains a category select. No invented classification of old entries.
- **Motion**: existing CSS keyframes + planning-section pulse and step-icon color transitions. No new dependencies.

Round-2 contracts (implemented across two agents):
- `goalStats(state, goalId): GoalStats` (standalone export from useRuntimeStore).
- `artifactsForGoal` return extended with `size_bytes: number | null`.
- `ExecutionPanel({ goalIds?, className? })` exported from `src/components/execution/ExecutionPanel.tsx`.
- Memory entry: additive optional `category: string | null`.
