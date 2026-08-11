# Weave Rebuild — Phase 0: Chassis Inventory

**Commit:** `b820442` · **Date:** 2026-08-11 · **Scope:** discovery only, no code changes.
**Method:** per-module `rg` reference counts over `src-tauri/src` (all `.rs`) and `src`
(all `.ts`/`.tsx`), plus manual reads of every unresolved module. A KEEP decision means the
module is wired into the running app (registered, imported, or mounted); DISCARD means it is
not reachable from any entry point (`main.rs` invoke_handler / `App.tsx` mount graph / plugin
registry) and can be deleted; REWRITE means it is reachable but its current implementation is
wrong for the target architecture (native tool-calling).

Decisions are binding for later phases: **no module is touched in Phase 3+ without a row here.**

---

## 1. Already resolved (re-verified at b820442, no re-investigation needed)

| Module | Path | Evidence (verified) | Decision |
|---|---|---|---|
| runtime-kernel | crates/runtime-kernel | 36 `runtime_kernel::` references across 20 src-tauri files | KEEP |
| capabilities | crates/capabilities | 1 use: `capabilities::route_capability` at coder_plugin.rs:23; dep in src-tauri/Cargo.toml:19 | KEEP |
| execution-runtime (crate) | crates/execution-runtime | 0 references from src-tauri; wrapper runtime/execution_runtime.rs has 0 external callers | DISCARD |
| cognitive-runtime | crates/cognitive-runtime | 0 references | DISCARD |
| knowledge | crates/knowledge | 0 references | DISCARD |
| planning | crates/planning | 0 references; `planner_index` field flagged dead by compiler | DISCARD |
| workflow-runtime (crate) | crates/workflow-runtime | 0 references (workflow_plugin.rs is separate — see §3) | DISCARD |
| memory (crate) | crates/memory | 0 references; distinct from memory_plugin.rs | DISCARD |
| plugin-runtime (crate) | crates/plugin-runtime | 0 references; real runtimes are runtime/wasm.rs + runtime/python.rs | DISCARD |
| runtime/wasm.rs | src-tauri/src/runtime/wasm.rs | called from plugin_manager.rs:462 | KEEP |
| runtime/python.rs | src-tauri/src/runtime/python.rs | called from plugin_manager.rs:369,454; test file exists (tests/python_runtime_test.rs) | KEEP |
| file/git/sqlite/http/web/shell/calc plugins | src-tauri/src/plugins/*.rs | all registered in create_builtin_plugins(); file/git/sqlite/http/web hardened (fs_security.rs/ssrf.rs) | KEEP, migrate in Phase 3 |
| coder_plugin (+ 8 submodules) | src-tauri/src/plugins/coder_plugin* | registered, most complex plugin; uses `capabilities` crate | KEEP, migrate last in Phase 3 |
| useChatStore.ts | src/stores/useChatStore.ts | entire agent loop (XML parsing, approval state machine) moves to backend in Phase 2 | DISCARD (parsing) / UI-state slice may survive |
| styles.css, tailwind.config.js | src/, root | HSL CSS-variable system; only 2/64 component files contain hex literals | KEEP |

---

## 2. Open items — resolved

| Module | Lines | Classification | Storage / mechanism | Hidden dep on DISCARD crate? | Decision |
|---|---|---|---|---|---|
| plugins/note_plugin.rs | 259 | Functional — full CRUD + search + pin; 7 capabilities | JSON files in `~/.weave/notes/*.json` (AppConfig::notes_dir) | No — imports: chrono, serde, runtime-kernel (trait only) | **KEEP** |
| plugins/canvas_plugin.rs | 216 | Functional — forwards actions over tokio broadcast channel; 7 capabilities | None (ephemeral) — canvas_tx → main.rs:34 emits `canvas-action` Tauri event; no frontend listener yet | No | **KEEP** |
| plugins/memory_plugin.rs | 285 | Functional — KV store + user profile; 6 capabilities; `read_memory()`/`default_profile()` feed system prompt (plugin_manager.rs:535) | JSON file `~/.weave/memory.json` (AppConfig::app_data_dir) | **No** — imports serde_json/std/chrono/AppConfig only; does NOT use crates/memory | **KEEP** |
| plugins/workflow_plugin.rs | 183 | Functional — CRUD template store; 4 capabilities | JSON files `~/.weave/workflows/*.json` (AppConfig::workflows_dir) | **No** — imports chrono/serde/AppConfig only; does NOT use crates/workflow-runtime | **KEEP** |
| plugins/sys_plugin.rs | 124 | Functional — read-only system info (env consts, uptime/df/hostname subprocess) | None | No | **KEEP** |
| runtime/plugin_runtime.rs | 23 | Stub — thin wrapper (`discover_and_load`, `plugin_dir`) delegating to PluginManager; zero callers outside its own module declaration | — | No | **DISCARD** |
| stores/useAppStore.ts | 141 | Functional — view/artifact/sidebar navigation state | zustand (memory) | — | **KEEP** (22 files import it) |
| stores/useThemeStore.ts | 101 | Functional — persisted theme/custom themes | zustand persist | — | **KEEP** (6 files) |
| stores/useRuntimeStore.ts | 386 | Functional — runtime-event aggregation, execution groups, telemetry (feeds ExecutionView) | zustand + immer | — | **KEEP** (14 files) |
| stores/useModelPreferenceStore.ts | 36 | Functional — persisted recent/favorite models | zustand persist | — | **KEEP** (2 files) |

---

## 3. Full per-file inventory (every file in the repo)

### 3.1 src-tauri — core

| File | Evidence | Decision |
|---|---|---|
| main.rs | Tauri entry; invoke_handler registers all 44 commands; canvas event bridge (canvas_rx → `canvas-action`) | KEEP |
| lib.rs | AppState assembly, ExecutionContext factory, runtime event bridge to frontend | KEEP |
| ai_bridge.rs (2011) | chat_stream for OpenAI/Anthropic/Ollama/Kimi; **no `tools` field — Phase 2 converts to native tool-calling** | KEEP (extend in Phase 2) |
| github_plugin.rs | Real GitHub client; used by commands/plugin.rs (list org repos, install from repo/release) | KEEP |
| plugin_loader.rs | `DynamicPluginLoader` — **0 instantiations** anywhere; logic duplicated by plugin_manager.rs `load_wpk_plugin`/`load_directory_plugin` | **DISCARD** |
| plugin_manager.rs (632) | Plugin registry, builtin executor map, capability discovery, system prompt builder | KEEP |
| models/chat.rs, models/manifest.rs, models/plugin.rs, models/mod.rs | Serialization types used by commands + plugin system | KEEP |
| commands/mod.rs + chat/models/plugin/runtime/session/system.rs | All 44 commands registered in main.rs invoke_handler (verified list) | KEEP (chat.rs is the Phase 2 target) |
| utils/config.rs, errors.rs, mod.rs | Config load/save/migration, error enum, module decls | KEEP |
| utils/fs_security.rs, utils/ssrf.rs | Phase-1 security modules (canonicalize + confinement, SSRF guard); ssrf has 5 unit tests | KEEP |
| plugins/mod.rs | module declarations | KEEP |
| runtime/mod.rs | declares wasm/python/plugin_runtime/execution_runtime | KEEP (trim plugin_runtime + execution_runtime in Phase 3) |
| runtime/execution_runtime.rs | wrapper, 0 external callers | **DISCARD** |
| tests/python_runtime_test.rs + tests/fixtures/plugins/echo_python/* | python runtime integration test + fixture plugin | KEEP |

### 3.2 src-tauri — plugins (beyond §1/§2)

| File | Evidence | Decision |
|---|---|---|
| coder_plugin.rs + coder_plugin/{capabilities,filesystem,history,parser,patch,process,project_detector,security}.rs (1544) | registered; routes through `capabilities::route_capability` (line 23); has its own security module | KEEP, migrate last in Phase 3 |

### 3.3 Frontend — root, stores, hooks, lib, types

| File | Evidence | Decision |
|---|---|---|
| main.tsx, App.tsx, vite-env.d.ts | entry + mount graph (mounts TopNav, Workspace, WorkspaceSidebar, CommandPalette, Toaster, ThemeProvider, useRuntimeEvents) | KEEP |
| stores/useApprovalModeStore.ts | persisted ask/accept-edits mode, consumed by useChatStore + SettingsPanel | KEEP |
| stores/usePluginStore.ts | plugin discovery/install/execute IPC facade (used by FileManager, ChatPanel, NotesManager, CommandPalette, profile hooks) | KEEP |
| stores/useChatStore.ts | see §1 — parsing DISCARDs to backend in Phase 2 | see §1 |
| hooks/useChatStream.ts | chat-stream event listener; used by ChatPanel + ChatCommandCenter | KEEP |
| hooks/useRuntimeEvents.ts | runtime-event listener; used by App + ExecutionView | KEEP |
| hooks/useSystemPulse.ts | system stats polling; used by TopNav + StatusBar | KEEP |
| hooks/usePlugins.ts | **0 importers** (only self) | **DISCARD** |
| hooks/useTauriCommand.ts | **0 importers** (only self) | **DISCARD** |
| hooks/profile/useMemories.ts, useProfile.ts, useTeachAI.ts | used by ProfilePanel/TeachBar (memory.recall / memory.store / memory.update_profile) | KEEP |
| lib/ipc.ts | used by IdeBottomDrawer, GitPanel, WorkspaceSearch | KEEP |
| lib/modelStats.ts | used by RuntimeView, StatusBar, TopNav, useSystemPulse | KEEP |
| lib/editorTheme.ts | used by NotesManager + FileEditor | KEEP |
| lib/errors.ts, lib/utils.ts | 8 and 19 importers respectively | KEEP |
| lib/capabilities.ts | approval-gate source of truth (13 importers) | KEEP |
| types/app.ts, chat.ts, plugin.ts, runtime.ts | 6/7/4/10 importers respectively | KEEP |

### 3.4 Frontend — components

All components below are reachable from the mount graph (App.tsx → TopNav/Workspace/WorkspaceSidebar/CommandPalette) or are primitives re-exported through components.json; all classified KEEP. DISCARD candidates: none.

| Group | Files | Evidence |
|---|---|---|
| layout/ (5) | TopNav, StatusBar, ThemeProvider, Workspace, WorkspaceSidebar | mounted from App.tsx/Workspace.tsx |
| chat/ (10) | AgentActivityAccordion, ArtifactCard, ArtifactPanel, ArtifactsListPanel, ChatCommandCenter, ChatHistorySidebar, ChatInput, ChatMessage, ChatPanel, ToolCallCard | mounted via ChatPanel (useChatStore consumer); Artifact* via ChatMessage/CommandPalette |
| files/ (6) | FileDiffViewer, FileEditor, FileManager, GitPanel, IdeBottomDrawer, WorkspaceSearch | mounted via Workspace.tsx (FileManager view) |
| execution/ (4) | ExecutionPanel, ExecutionView, InspectorPanel, StepTimeline | mounted via Workspace.tsx (execution view, useRuntimeStore) |
| artifacts/ (1) | ArtifactsView | mounted via Workspace.tsx |
| capabilities/ (1) | CapabilitiesView | mounted via Workspace.tsx |
| memory/ (1) | MemoryView | mounted via Workspace.tsx |
| models/ (1) | RuntimeView | mounted via Workspace.tsx |
| notes/ (1) | NotesManager | mounted via Workspace.tsx |
| plugins/ (3) | GithubPluginPanel, PluginCard, PluginMarket | mounted via Workspace.tsx (plugins view) |
| profile/ (6) | ContextGrid, ContextHeader, MemoryTimeline, ProfilePanel, SystemFooter, TeachBar | mounted via Workspace.tsx (profile view) |
| settings/ (1) | SettingsPanel | mounted via Workspace.tsx |
| workspace/ (4) | ExecutionSection, GoalCard, runtimeSelectors, SectionLabel | mounted via Workspace.tsx/ExecutionView |
| ui/ (20 primitives + CommandPalette) | avatar, badge, button, card, collapsible, confirm-dialog, dialog, dropdown-menu, input, label, scroll-area, select, separator, skeleton, slider, sonner, switch, tabs, textarea, tooltip | shadcn primitives; CommandPalette mounted from App.tsx |

### 3.5 crates — per-file (DISCARD crates die whole; files listed for completeness)

| Crate | Files | Decision |
|---|---|---|
| runtime-kernel | lib.rs, kernel.rs, artifact.rs, blackboard.rs, errors.rs, event_bus.rs, event_store.rs, execution_context.rs, observability.rs, policy_engine.rs, resource_manager.rs, runtime_event.rs, sandbox.rs, subsystem.rs, task_graph.rs | KEEP |
| capabilities | lib.rs, capability.rs, capability_graph.rs, capability_registry.rs, permission_registry.rs, tool_registry.rs, typed_contract.rs, utils.rs | KEEP |
| execution-runtime | lib.rs, dependency_resolver.rs, execution_graph.rs, execution_registry.rs, executor.rs, node_state.rs, ready_queue.rs, retry_policy.rs, utils.rs, worker_pool.rs | DISCARD (0 refs) |
| cognitive-runtime | lib.rs, mod.rs, agent.rs, models.rs, models/chat.rs, providers/{anthropic,llamacpp,mod,ollama,openai,vllm}.rs, services.rs, traits.rs, utils.rs | DISCARD (0 refs; provider logic duplicated in src-tauri ai_bridge.rs) |
| knowledge | lib.rs, facts.rs, knowledge_graph.rs, ontology.rs, planner_index.rs, semantic_index.rs | DISCARD (0 refs) |
| memory | lib.rs, mod.rs, consolidation.rs, retrieval.rs, storage.rs, vector_index.rs | DISCARD (0 refs) |
| planning | lib.rs, mod.rs, execution_optimizer.rs, goal_analyzer.rs, htn_planner.rs, logical_plan.rs, physical_planner.rs, plan_generator.rs, planner_engine.rs, reasoning.rs, reflection_engine.rs, utils.rs | DISCARD (0 refs) |
| plugin-runtime | lib.rs, mod.rs, discovery.rs, lifecycle.rs, plugin_types.rs | DISCARD (0 refs) |
| workflow-runtime | lib.rs, mod.rs, scheduler.rs, utils.rs, workflow_engine.rs | DISCARD (0 refs) |
| setup_crates.py | one-shot scaffold generator, not referenced by build/CI | **DISCARD** |

### 3.6 Root / config / scripts / assets

| File | Evidence | Decision |
|---|---|---|
| Cargo.toml, Cargo.lock (root) | workspace definition + authoritative lockfile (verified: `cargo check --workspace` green) | KEEP |
| src-tauri/Cargo.toml, build.rs | package manifest, tauri-build | KEEP |
| src-tauri/Cargo.lock | stale duplicate from pre-workspace era; root lockfile is authoritative | **DISCARD** |
| src-tauri/tauri.conf.json, capabilities/default.json | app config + Tauri permissions | KEEP |
| src-tauri/gen/schemas/*.json (4) | generated by tauri-build | KEEP (generated) |
| src-tauri/icons/* (5) | referenced by tauri.conf.json | KEEP |
| src-tauri/code_artifact_*.py (4) | stray `yolov8_person_detection.py` copies; referenced by nothing | **DISCARD** |
| shell.nix | dev shell (nix) — toolchain for this workspace | KEEP |
| package.json, package-lock.json, vite.config.ts, tsconfig.json, tsconfig.node.json, tailwind.config.js, postcss.config.js, eslint.config.js, components.json, index.html, .prettierrc, .prettierignore, .gitignore | build/lint config; all exercised by `npm run build` / `npm run lint` | KEEP |
| README.md | marketing + architecture claims; tool-calling section inaccurate until Phase 2 lands | REWRITE (with Phase 2) |
| LICENSE | MIT | KEEP |
| docs/WDL.md, docs/superpowers/ | design-language spec | KEEP |
| scripts/check_architecture.py | crate-dependency contract checker (updated in Phase-1 commit for github-plugin removal) | KEEP |
| refactor_imports.py | one-shot import-path migrator; reads `src-tauri/src/core/...` paths that no longer exist | **DISCARD** |
| update_ai_bridge.py | one-shot migrator; reads `src-tauri/src/core/ai_bridge.rs` which no longer exists | **DISCARD** |
| request.txt | empty (0 bytes) | **DISCARD** |
| perplexity-notu.md | user scratch note, unreferenced (957 B) | **DISCARD** (confirm with user) |
| src/assets/* (8 files) | model provider logos + weave logos, referenced by UI | KEEP |

---

## 4. Hidden-dependency confirmations (asked explicitly)

| Check | Result |
|---|---|
| memory_plugin.rs ↔ crates/memory | **No dependency.** Imports: serde_json, std::collections, chrono, AppConfig, runtime-kernel trait. Storage is `~/.weave/memory.json` directly. |
| workflow_plugin.rs ↔ crates/workflow-runtime | **No dependency.** Imports: chrono, serde, AppConfig. Storage is `~/.weave/workflows/*.json` directly. |
| note_plugin / canvas_plugin / sys_plugin ↔ any DISCARD crate | **No dependency.** Trait object is runtime-kernel (KEEP) only. |
| useChatStore.ts ↔ DISCARD crates | Frontend only; calls `plugin_execute` IPC — unaffected by crate removal. |
| canvas_plugin end-to-end | Registered → canvas_tx → main.rs subscriber → `canvas-action` Tauri event. No frontend listener yet (capability surface + approval-gated only). |

---

## 5. Cross-cutting notes for later phases

1. **Phase 2 (native tool-calling):** ai_bridge.rs gains per-provider `tools`; commands/chat.rs persists `plugin_calls` metadata; useChatStore.ts keeps only UI-state slice (streaming, messages, approval rendering) — the XML parser and approval state machine move behind the IPC boundary. Approval gate (capabilities.ts + executeToolCall) stays in the frontend until backend gating lands.
2. **Phase 3 (crate pruning):** delete DISCARD crates from `crates/` + root Cargo.toml members; delete runtime/plugin_runtime.rs + runtime/execution_runtime.rs and their module decls; delete the 4 dead frontend files (usePlugins.ts, useTauriCommand.ts) and the 3 stale scripts (refactor_imports.py, update_ai_bridge.py, setup_crates.py) + stray artifacts (code_artifact_*.py, src-tauri/Cargo.lock). Keep `capabilities` + `runtime-kernel`.
3. **Phase 5 (regression tests):** cover the Phase-1 security surface — approval-gate behavior (sensitive caps require approval in `ask` mode), XML-only tool-call parsing (no JSON fallback), fs_security canonicalization/confinement, ssrf IP-block tests (5 already exist).

## 6. Acceptance criteria — checklist

- [x] Every unresolved module read and classified (10/10 open items have decisions, no TBD)
- [x] Every file in the repo has a recorded decision: backend (3.1, 3.2), frontend (3.3, 3.4), crates (3.5), root/config/assets (3.6)
- [x] Each decision carries a one-line evidence citation (reference count, test presence, or manual read summary)
- [x] Hidden-dependency checks for memory_plugin and workflow_plugin completed and documented
- [x] DISCARD decisions verified as unreachable from entry points (main.rs invoke_handler, App.tsx mount graph, plugin registry)
