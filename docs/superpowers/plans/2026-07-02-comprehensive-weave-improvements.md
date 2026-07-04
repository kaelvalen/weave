# Comprehensive Weave Improvements Implementation Plan

> **For agentic workers:** Execute tasks in order. Each task is self-contained and should be verified before moving on.

**Goal:** Bring the Weave codebase to a more polished, type-safe, secure, and maintainable state by fixing tooling, frontend type/UX issues, targeted Rust backend bugs, repository clutter, and external-plugin hardening.

**Architecture:** Keep changes minimal and aligned with existing patterns (React + Zustand + shadcn/ui frontend, Tauri v2 + Rust backend, Python external plugins). Do not refactor large subsystems; instead fix concrete issues and add missing infrastructure.

**Tech Stack:** TypeScript, React 18, Tailwind CSS, Zustand, Tauri v2, Rust, Python.

---

## File Structure Map

| File                                          | Responsibility                                |
| --------------------------------------------- | --------------------------------------------- |
| `package.json`                                | Frontend scripts and dependencies             |
| `eslint.config.js` (new)                      | ESLint v9 flat config                         |
| `.prettierrc` (new) / `.prettierignore` (new) | Prettier formatting config                    |
| `tsconfig.json`                               | TypeScript compiler options                   |
| `src/types/chat.ts`                           | Chat/provider/model TypeScript types          |
| `src/types/app.ts`                            | App-level config types                        |
| `src/components/chat/ChatInput.tsx`           | Model selection UI                            |
| `src/stores/useChatStore.ts`                  | Chat state, tool-call parsing, AI invocations |
| `src/stores/usePluginStore.ts`                | Plugin state and IPC calls                    |
| `src/components/ui/CommandPalette.tsx`        | Global command palette                        |
| `src/components/files/FileManager.tsx`        | File manager UI                               |
| `src/components/workflows/Workflows.tsx`      | Workflow canvas                               |
| `src/styles.css`                              | Global styles including scrollbar rules       |
| `src-tauri/src/core/ai_bridge.rs`             | AI provider bridge                            |
| `src-tauri/src/models/chat.rs`                | Chat model structs                            |
| `src-tauri/src/plugins/coder_plugin.rs`       | Coder plugin                                  |
| `src-tauri/src/utils/config.rs`               | Config helpers                                |
| `build_errors.log`                            | Committed build error log (remove)            |
| `test_file.rs`, `test_meval.rs`               | Root Rust scratch files (move)                |
| `external_plugins/workflow_manager/main.py`   | Workflow manager plugin                       |
| `external_plugins/math_genius/main.py`        | Math plugin                                   |

---

### Task 1: Tooling Setup (ESLint, Prettier, Type-Check Scripts)

**Files:**

- Create: `eslint.config.js`
- Create: `.prettierrc`
- Create: `.prettierignore`
- Modify: `package.json`

**Steps:**

1. Add ESLint v9 flat config with TypeScript React rules, Tauri globals, and import-related rules disabled where they conflict with the current code.
2. Add Prettier config matching the existing 2-space indent style.
3. Update `package.json` scripts: replace `lint` with `eslint .`, add `format`, add `typecheck`.
4. Add dev dependencies: `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `prettier`.
5. Run `npm install`.
6. Run `npx tsc --noEmit` and `npm run lint` and record remaining issues; fix trivial ones only (do not rewrite entire files).

---

### Task 2: Sync Frontend Provider/Model Types

**Files:**

- Modify: `src/types/chat.ts`
- Modify: `src/types/app.ts`
- Modify: `src/components/chat/ChatInput.tsx`

**Steps:**

1. In `src/types/chat.ts`, add `'kimi'` and `'opencode'` to the `Provider` union.
2. In `src/types/app.ts`, add the same providers to `AiConfig.default_provider` and ensure `ModelConfig` fields match backend expectations.
3. In `ChatInput.tsx`, replace the fake fallback model IDs (`gpt-5.6-sol`, `claude-fable-5`, etc.) with a small list of real, provider-appropriate defaults or an empty list that falls back to a placeholder label.

---

### Task 3: Frontend UX Fixes

**Files:**

- Modify: `src/components/ui/CommandPalette.tsx`
- Modify: `src/components/files/FileManager.tsx`
- Modify: `src/components/workflows/Workflows.tsx`
- Modify: `src/styles.css`

**Steps:**

1. **CommandPalette:** Add full list of app views/actions, arrow-key navigation, `Enter` to activate, `Escape` to close, and basic ARIA attributes.
2. **FileManager:** Wire the search input to filter the displayed file list by name.
3. **Workflows:** Stop `loadWorkflow` from overwriting user edits by adding a dirty-state guard: do not auto-reload while the graph is dirty or a node is selected; keep the 2s polling for sync when idle.
4. **Styles:** Remove the global `display: none` scrollbar rules; instead use a utility class or default browser scrollbars to restore accessibility.

---

### Task 4: Chat Store Robustness

**Files:**

- Modify: `src/stores/useChatStore.ts`
- Create/Modify: `src/lib/errors.ts`

**Steps:**

1. Replace silent `console.error` catches in chat and plugin stores with user-visible toast notifications using `sonner`.
2. Introduce a small `extractError` helper in `src/lib/errors.ts` that normalizes Tauri errors and JS `Error` objects into a readable string.
3. Improve tool-call parsing: support multi-line JSON parameters, handle missing or malformed calls gracefully, and log the raw text when parsing fails.
4. Ensure streaming errors stop the loading indicator and show a toast.

---

### Task 5: Targeted Rust Backend Fixes

**Files:**

- Modify: `src-tauri/src/models/chat.rs`
- Modify: `src-tauri/src/plugins/coder_plugin.rs`
- Modify: `src-tauri/src/utils/config.rs`
- Modify: `src-tauri/src/core/ai_bridge.rs` (provider enum sync only)

**Steps:**

1. In `src-tauri/src/models/chat.rs`, implement the no-op `add_plugin_call` helper correctly (push to the calls vector).
2. In `src-tauri/src/plugins/coder_plugin.rs`, fix the `"n package.json"` typo in project detection.
3. In `src-tauri/src/utils/config.rs`, make the Ollama default URL configurable via `~/.weave/config.json` instead of a hardcoded fallback.
4. In `src-tauri/src/core/ai_bridge.rs`, ensure the `Provider` enum variants exposed to frontend match TypeScript `Provider` (`kimi`, `opencode`).

---

### Task 6: Repository Cleanup

**Files:**

- Delete/Move: `build_errors.log`
- Move: `test_file.rs`, `test_meval.rs`
- Modify: `.gitignore`

**Steps:**

1. Delete `build_errors.log` from the repo and add `*.log` to `.gitignore`.
2. Move `test_file.rs` and `test_meval.rs` into `src-tauri/examples/scratch/` (create the directory) so the root stays clean.
3. Ensure `node_modules`, `dist`, `src-tauri/target`, and `.venv` are already ignored; add them if missing.

---

### Task 7: External Plugin Hardening

**Files:**

- Modify: `external_plugins/workflow_manager/main.py`
- Modify: `external_plugins/math_genius/main.py`
- Create: `external_plugins/workflow_manager/requirements.txt`
- Create: `external_plugins/math_genius/requirements.txt`
- Modify: `.gitignore`

**Steps:**

1. In `workflow_manager/main.py`, replace the hardcoded Linux app-data path with a path taken from an environment variable (`WEAVE_DATA_DIR`) or a passed argument, defaulting to a temp directory only in development.
2. In `math_genius/main.py`, document the `exec` usage and add a deny-list for dangerous builtins (`__import__`, `open`, etc.) to reduce risk.
3. Add `requirements.txt` files for both plugins.
4. Ensure `external_plugins/**/.venv` is in `.gitignore`.

---

### Task 8: Verification

**Steps:**

1. Run `npm run typecheck` and fix any new TypeScript errors caused by the changes.
2. Run `npm run lint` and fix any new lint errors.
3. If Rust toolchain becomes available, run `cargo check` inside `src-tauri`.
4. Summarize all changes for the user.
