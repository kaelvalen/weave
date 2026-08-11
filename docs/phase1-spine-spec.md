# Weave Spine Spec (Phase 1)

Status: **REVIEWED — amendments folded, decisions locked. Phase 2 not started; awaits explicit kickoff approval.**
Supersedes: `src/stores/useChatStore.ts` tool-call parsing (XML/JSON regex), the current
`ai_bridge.rs` request shape, and the current `PluginBuilder::capability()` schema
format.

---

## 1. Agent loop location

**Backend. New module: `src-tauri/src/agent/mod.rs`** (does not exist yet — created in
Phase 2).

Rationale: the loop currently lives in `useChatStore.ts` (1254 lines) because tool
calls are recovered from free-text model output via regex. Once tool-calling is native
(section 2), the provider API itself returns structured tool-call objects in the
response — there is no longer a reason for the frontend to parse anything. The backend
already owns the provider HTTP connection (`ai_bridge.rs`) and the plugin registry
(`plugin_manager.rs`); the loop belongs next to both.

The frontend's role shrinks to: send user message, receive streamed
text-and-tool-call-events, render them, and relay approval decisions
(`chat_approve_tool_call`) back to the backend. `src/stores/useChatStore.ts` is not
deleted wholesale — its message-list/session/UI-state responsibilities survive; only the
`parseToolCalls`/`inferCapabilityFromJson`-lineage code (already partly removed this
session) and the manual `finalizeMessage` tool-execution orchestration are replaced by
thin event handlers reacting to backend-emitted events. `hydrateMessageMetadata` is
removed with the parser lineage.

---

## 2. Tool-calling mechanism

**Native provider function-calling. No more `<call plugin="...">` text tags.**

Concretely, in `ai_bridge.rs`:

- `OpenAiRequest` gains a `tools: Vec<OpenAiTool>` field
  (`{"type": "function", "function": {"name", "description", "parameters": <JSON Schema>}}`),
  populated from the plugin registry (section 4) on every request. Covers `Openai`,
  `Kimi` and `Opencode` providers (all use the OpenAI message shape).
- `AnthropicRequest` gains a `tools: Vec<AnthropicTool>` field
  (`{"name", "description", "input_schema": <JSON Schema>}`), same source.
- `OpenAiStreamChoice`/`OpenAiDelta` gain `tool_calls: Option<Vec<ToolCallDelta>>`
  (currently only `content: Option<String>` exists — this is the reason tool calls
  cannot currently be detected in the streaming response at all).
- `AnthropicStreamResponse`/`AnthropicDelta` gain handling for `content_block_start`
  events of type `tool_use` and `input_json_delta` accumulation (Anthropic streams tool
  input as incremental JSON fragments under the existing `content_block` field, which
  is currently received but discarded — `#[allow(dead_code)]` on `content_block` in the
  current struct is the marker for this).
- **Local/Ollama provider (correction to draft):** the Local provider uses the
  Ollama-native `/api/chat` request shape (`OllamaRequest`), NOT OpenAI-compat.
  `OllamaRequest` gains a `tools` field; `OllamaResponseMessage` gains a
  `tool_calls: Option<Vec<...>>` field parsed from stream chunks where `done: true`.
  Ollama ≥ 0.4.x supports native tools.
- **Completion detection (new):** `OpenAiStreamChoice` gains `finish_reason: Option<String>`
  (tool-call completion signalled by `"tool_calls"`); the Anthropic stream path gains
  `message_delta` event handling for `stop_reason: "tool_use"`.
- **Delta accumulation (new):** tool-call deltas are accumulated keyed by `index`
  (OpenAI) / `content_block_index` (Anthropic); the `call_id` is taken from the first
  delta of each call.
- The system-prompt-based tool instructions currently injected in
  `plugin_manager.rs` (`"Output ONLY: <call plugin=...>"`) are removed once native
  tool-calling is live. The prompt-injection defense line added this session is
  **preserved, reworded** — fetched content must not be treated as instructions,
  regardless of delivery mechanism. The `"## Available Tools"` listing is slimmed down
  (native tool definitions replace it in-context; keep only a short note that tools are
  available).
- **Local provider strategy (locked, correction to draft):** `use_native_tools` is a
  **static config flag** (added to `LocalConfig`), NOT a runtime auto-fallback. A
  single empirical probe at Phase 2 start (a request containing a `tools` field to the
  user's local endpoint; check whether `tool_calls` comes back) fixes the flag's
  default. No runtime "did the provider silently ignore tools" detection is attempted —
  it is undecidable from a single response (the model may legitimately choose not to
  call a tool). Providers without native support use the system-prompt-instruction
  approach as a **documented degraded mode**, never silently.

---

## 3. Tool-result loop state machine

Backend owns turn state end-to-end. Sequence:

1. Frontend calls `chat_send_message` (existing Tauri command, `commands/chat.rs`).
2. Backend sends the request with `tools` populated; streams text deltas AND tool-call
   deltas back to the frontend as they arrive (new Tauri event `chat-tool-call-detected`,
   alongside the existing `chat-stream-chunk`). Each tool-call event carries
   `call_id`, `plugin_id`, `capability`, `params`, and the corresponding entry of
   `MessageMetadata.plugin_calls` so the UI can render ToolCallCard and session restore
   stays intact.
3. When the provider's response signals tool calls are complete (`finish_reason:
   "tool_calls"` for OpenAI, `stop_reason: "tool_use"` for Anthropic), the backend — not
   the frontend — resolves each tool call against the plugin registry
   (`plugin_manager.rs::get_loaded()` / capability lookup, replacing
   `usePluginStore.getPluginIdForCapability` which currently does this client-side).
4. Approval gate (section below) evaluates each resolved call.
   - Non-sensitive, non-destructive calls execute immediately.
   - Sensitive/destructive calls emit a `pending_approval` event to the frontend and
     **halt the turn only for the unresolved subset** (amendment: safe calls in the
     same turn run first; the turn stops once only approval-pending calls remain). The
     backend does not proceed until it receives an explicit approval command per
     pending call (new Tauri command `chat_approve_tool_call { call_id, approved }`,
     replacing the current `executeToolCall` frontend action). When all pending calls
     in the turn are resolved (approved or rejected), execution of the approved ones
     resumes.
5. Once all calls in the turn are resolved (executed or explicitly rejected), the
   backend appends tool results to the message history in the provider's native
   tool-result format (`role: "tool"` for OpenAI, `tool_result` content block for
   Anthropic) — not as a synthetic hidden user message re-injected into `sendMessage`,
   which is the current mechanism (`quietUserMsg` in `useChatStore.ts`) and works only
   because there is no native format to use yet.
6. Backend automatically continues the conversation with the provider using the updated
   history, looping back to step 2, until a turn produces no further tool calls.

**Approval gate placement:** evaluated in the backend, immediately after step 3, using
the same `SENSITIVE_CAPS`/`DESTRUCTIVE_CAPS` classification currently in
`src/lib/capabilities.ts`. That classification data moves to
`src-tauri/src/utils/capability_policy.rs` (new file) as the single source of truth.
The gate applies to calls originating from the agent loop only; user-initiated
`plugin_execute` IPC (FileManager, NotesManager, CommandPalette, ...) stays ungated —
the user is the actor, no prompt-injection surface. The frontend keeps a
**read-only mirror** of the classification in `src/lib/capabilities.ts` purely for UI
badges and the "requires approval" filter in `CapabilitiesView.tsx` (decision Q3);
it must not make the actual gating decision — the gating decision already had one
documented near-miss this session (the pre-fix state where the frontend was the sole
enforcement point); moving it backend-side removes an entire class of "UI forgot to
check" bugs.

---

## 4. Plugin contract

**`PluginExecutor` trait (`src-tauri/src/models/plugin.rs`) stays structurally the
same** — `execute(capability, params, ctx) -> Result<Value, WeaveError>` is
provider-agnostic and does not need to change.

**What must change: capability schema representation.**
`PluginBuilder::capability(name, schema, desc)` currently takes `schema: &str` as a
*free-text example* (e.g. `r#"{"path":"...","content":"..."}"#`), stored in
`Capabilities.schemas: HashMap<String, String>` and used only to build human-readable
system-prompt text. Native function-calling requires a real JSON Schema object
(`type`, `properties` with per-field types, `required`) that both OpenAI and Anthropic
tool definitions consume directly.

Required change:
- `Capabilities.schemas` becomes `HashMap<String, serde_json::Value>` (an actual JSON
  Schema document per capability), not `HashMap<String, String>`.
- Every existing `.capability(...)` call site (13 builtin plugins,
  `plugin_manager.rs::create_builtin_plugins()`) is updated to pass a real schema
  instead of an example string. This touches every plugin migrated in Phase 3 — budget
  it as part of each plugin's migration commit, not a separate sweep.
- `plugin_manager.rs` gains a function converting the full loaded-plugin capability set
  into the provider-specific `tools` array shape (one converter per provider, since
  OpenAI and Anthropic tool-schema envelopes differ slightly; Ollama takes the OpenAI
  envelope shape).

---

## 5. Migration path for KEEP-tagged legacy crates

`runtime-kernel` and `capabilities` (the crate) are the only two Phase-0 KEEP-tagged
Rust crates outside `src-tauri` itself.

- **`capabilities` crate**: already integrates via `coder_plugin.rs:23`
  (`route_capability`). No change required for the spine — it is a routing helper
  internal to `coder_plugin`, orthogonal to the tool-calling transport mechanism. Leave
  as-is; re-evaluate only if `coder_plugin`'s Phase 3 migration surfaces a conflict.
- **`runtime-kernel`**: provides `ExecutionContext` (passed as `ctx` into every
  `PluginExecutor::execute` call) and `Observability` (used by `ai_bridge.rs` for
  telemetry). Both are consumed as-is by the new spine — `ExecutionContext` remains the
  third argument to `execute()`, `Observability` continues recording per-request
  telemetry from `ai_bridge.rs`'s replacement code. No structural change needed; this
  crate is infrastructure, not agent-loop logic, and the spine change does not touch it.

No DISCARD-tagged crate's responsibilities are being resurrected into the new spine. If
a capability once implied by a discarded crate (e.g. multi-step planning from the dead
`planning` crate) turns out to be genuinely wanted, it is scoped and built fresh against
this spec in a later phase — not restored from the deleted code.

---

## 6. Review log (2026-08-11 — decisions locked, Phase 2 not started)

Draft verified line-by-line against the codebase (`b820442`): all structural claims
confirmed (missing `tools` fields, `OpenAiDelta` content-only, `#[allow(dead_code)]`
marker on `AnthropicStreamResponse.content_block`, always-empty `plugin_calls`
metadata in `commands/chat.rs:42`, `quietUserMsg` re-injection mechanism).

Amendments folded into the draft:

| # | Amendment | Where |
|---|---|---|
| 1 | Local provider is Ollama-native, not OpenAI-compat: `OllamaRequest.tools` + `OllamaResponseMessage.tool_calls` | §2 |
| 2 | Completion detection fields: `finish_reason` (OpenAI), `message_delta`/`stop_reason: "tool_use"` (Anthropic) | §2 |
| 3 | Delta accumulation keyed by `index` / `content_block_index`; `call_id` from first delta | §2 |
| 4 | Mixed-turn behavior: safe calls run first, turn halts only for pending approvals, resumes when all resolve | §3 step 4 |
| 5 | Backend populates `MessageMetadata.plugin_calls`; `chat-tool-call-detected` events carry it; `hydrateMessageMetadata` removed | §3 step 2 |

Locked decisions:

| Question | Decision |
|---|---|
| Q1 event/command names | `chat-tool-call-detected`, `chat_approve_tool_call` — confirmed as-is |
| Q2 Local provider strategy | `use_native_tools` = static config flag (`LocalConfig`); default fixed once by an empirical probe at Phase 2 start; **no runtime auto-detection** (undecidable: "provider ignored tools" vs "model chose not to call"); non-supporting providers use documented degraded prompt-based mode |
| Q3 frontend classification copy | `capability_policy.rs` is the single source of truth; `src/lib/capabilities.ts` becomes read-only/display-only for badges + filter |

Phase 2 entry criteria: this spec approved at review status; `use_native_tools`
empirical probe executed against the user's local setup; kickoff approval given.
