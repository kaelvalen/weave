# Weave MCP (2026-07-28) Integration — Phase 8.1 Inventory + Phase 8.2 Spec

Status: **DRAFT — pending review. Phase 8.3 (build) MUST NOT start until this
document is explicitly approved**, same discipline as `phase1-spine-spec.md`
(§6 review log) and `phase0-inventory.md`.

> **Addendum 2026-08-13 — live-server validation (Phase 8.4) done:**
> a full `server/discover` → `tools/list` → `tools/call` round trip now
> runs through Weave's own client against GitHub's official public MCP
> server (`api.githubcopilot.com/mcp/`, protocol 2026-07-28) and passes.
> Evidence + re-run: `docs/probes/mcp-live-github-2026-08-13/`.
> Real-world findings that changed the client: (1) `_meta`
> `protocolVersion`/`clientCapabilities` are mandatory on every request
> (live server rejects without them, -32602); (2) responses are SSE-framed
> even for single round trips (`event: message`/`data:`) — `post()` now
> parses SSE when `Content-Type: text/event-stream`; (3) server identity is
> under `_meta.io.modelcontextprotocol/serverInfo`, which `server/discover`
> now reads (and it tolerates a missing `protocolVersions` array — GitHub
> omits it). See the addendum in §"Transport shape" if merging.
>
> **Addendum 2026-08-13 — OAuth 2.1/CIMD flow implemented (Part 2 §4–§5):**
> `mcp_add_server` now treats a 401 challenge (`Mcp-Authorization` header or
> `WWW-Authenticate: Bearer resource_metadata="..."`) as a registrable
> state, not an error: it discovers the authorization server via RFC 8414,
> stores the endpoints, and registers the server unauthenticated
> (`auth_required`, no tools). `mcp_oauth_authorize` runs the full flow —
> PKCE (S256) + CIMD client_id + loopback redirect listener bound before
> the browser opens, state round-trip verified, code exchanged at the token
> endpoint, tokens persisted to `~/.weave/config.json`, tools re-listed and
> re-registered with the access token. `mcp_oauth_refresh` covers the
> refresh-token grant. Hermetic tests in `mcp_client.rs` (RFC 7636 shape,
> header parsing, discovery, code/refresh exchanges against a one-shot mock
> AS). Not yet wired: automatic refresh-on-401 inside `tools/call` (the
> synchronous executor has no config/AS handle), and self-hosting of the
> CIMD document (env override `WEAVE_CIMD_CLIENT_ID` for now).
>
> **Addendum 2026-08-13 — RFC 9728 resolution bug found & fixed via live
> failure:** the first real OAuth-requiring connection (Puter MCP) blew up
> exactly as the shipped code's own doc comment had hinted: a
> `resource_metadata` URL is an RFC 9728 **protected-resource metadata
> document**, not the authorization server base. The initial
> implementation fed it straight into RFC 8414 discovery, producing a
> nonsense `.../.well-known/oauth-protected-resource/.well-known/
> oauth-authorization-server` URL. Fixed: `AuthChallenge` now distinguishes
> `Mcp-Authorization` (direct AS URL) from `resource_metadata` (document to
> fetch), `fetch_protected_resource_metadata()` reads
> `authorization_servers` (RFC 9728 bare-server fallback: the metadata URL
> itself), and `resolve_authorization_server()` sits between the challenge
> and `discover_authorization_server()` in `mcp_add_server`. Verified
> against Puter MCP live: challenge → metadata → `authorization_servers[0]`
> → RFC 8414 discovery all resolve
> (`live_oauth_challenge_resolution_against_puter_mcp`, `#[ignore]`d).
>
> **Addendum 2026-08-13 — RFC 8414 §3 path-aware discovery fixed:** the
> second live failure (GitHub) exposed the other discovery trap: §3 puts
> the well-known segment **between host and issuer path**
> (`https://github.com/.well-known/oauth-authorization-server/login/oauth`
> for issuer `https://github.com/login/oauth`), not appended to the path's
> end. GitHub serves only the path-aware form and 404s the naive append;
> Keycloak et al. serve only the append form. `discover_authorization_server`
> now tries `discovery_url_candidates()` in order — path-aware first,
> append on 404 — and is verified live against GitHub's real issuer
> (`live_github_discovery_is_path_aware`, `#[ignore]`d).
>
> **Addendum 2026-08-13 — non-CIMD authorization servers (GitHub) require
> a registered client:** the authorize URL GitHub produced 404'd — GitHub's
> AS does not implement CIMD and rejects URL-style `client_id`s, and its
> consent flow requires an OAuth App whose callback URL matches exactly.
> The client identity and redirect URI are now overridable
> (`WEAVE_CIMD_CLIENT_ID`, `WEAVE_OAUTH_REDIRECT_URI`); the loopback
> listener binds the redirect URI's own port instead of a hardcoded one,
> so a registered GitHub OAuth App (callback `http://127.0.0.1:34987/
> callback`) works end to end. Setup steps: README "GitHub-specific OAuth".

Phase 8.0 (Ollama `use_native_tools` probe) close-out: see
`phase1-spine-spec.md` §8. The 2026-08-11 probe result was re-verified on
2026-08-13 against a real local Ollama 0.32.7 with `qwen3.5:9b`; both
`stream:false` and `stream:true` `/api/chat` requests returned native
`message.tool_calls`, transcript committed at
`docs/probes/ollama-native-tools-2026-08-13/`. The gap is closed.

**Sources for the 2026-07-28 spec text** (the primitive-level spec itself,
`modelcontextprotocol.io`, is blocked by this session's network egress
policy — verified via direct fetch, `EGRESS_BLOCKED`). Grounded instead in
the canonical changelog fetched from the spec's own source repository, plus
two official protocol-blog posts:
- `raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/docs/specification/2026-07-28/changelog.mdx`
  (the "Major Changes" / "Deprecated Features" list quoted throughout this
  document is drawn from this file — the closest to primary-source text this
  session could retrieve).
- `blog.modelcontextprotocol.io/posts/2026-07-28/` — spec announcement
  (stateless core, MRTR, header routing, list caching, Tasks extension,
  deprecations, auth hardening).
- `blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/` — MRTR
  wire-format detail (`InputRequiredResult`, `resultType`, `inputRequests`,
  `requestState`) and Tasks-extension rationale.
- CIMD background (client_id-as-URL mechanics): `oauth.net/2/client-id-metadata-document/`,
  `stytch.com/blog/oauth-client-id-metadata-mcp`, `workos.com/blog/client-id-metadata-documents-cimd-oauth-client-registration-mcp`
  (draft-ietf-oauth-client-id-metadata-document-00), surfaced via search
  since the modelcontextprotocol.io authorization page itself was
  unreachable.

Everything below re-derives from these sources, not from the plan
document's summary framing, per this phase's own instruction not to
implement wire formats from the plan text.

---

## Part 1 — Phase 8.1 Integration Inventory

### Q1. Where does an MCP tool call enter the existing pipeline?

**Confirmed:** `agent/mod.rs` → `plugin_manager.rs` (registry lookup) →
`PluginExecutor::execute()`, exactly as the plan assumes
(`src-tauri/src/agent/mod.rs:378` calls `self.execute_call(...)` →
`src-tauri/src/agent/mod.rs:438-455` `execute_call()` calls
`self.plugin_manager.execute_capability(...)` →
`src-tauri/src/plugin_manager.rs:433-484` `execute_capability()` calls
`executor.execute(capability, params, ctx)` on the registered
`Box<dyn PluginExecutor>` for the resolving plugin id).

**The real question the plan flagged — does MCP's transport map onto a
single synchronous `execute()` call — has a concrete, evidence-backed
answer, not a hand-wave:**

1. `PluginExecutor::execute` (`src-tauri/src/models/plugin.rs:7-14`) is a
   **synchronous, non-async trait method**: `fn execute(&self, capability:
   &str, params: Value, ctx: &ExecutionContext) -> Result<Value,
   WeaveError>`. So is every call site up the chain
   (`execute_call`/`execute_capability` — plain `fn`, no `.await`), even
   though `agent/mod.rs`'s outer round loop is itself `async` (it `.await`s
   the provider stream and the approval-decision channel). `execute_call`
   is invoked directly, uninverted, from inside that async function
   (`agent/mod.rs:378`).
2. MCP's `tools/call` is fundamentally a network operation (Streamable
   HTTP POST per the 2026-07-28 transport). A synchronous trait method
   cannot `.await` an HTTP client call without either blocking the calling
   tokio worker thread or nesting a runtime inside a runtime (the classic
   `Handle::current().block_on()` deadlock/panic).
3. **This codebase already solved exactly this problem, twice.**
   `src-tauri/src/plugins/web_plugin.rs:43-100` (`WebPlugin::fetch`,
   backing `web.fetch`) and `src-tauri/src/plugins/http_plugin.rs:59`
   (`http.request`) both implement a synchronous `PluginExecutor::execute`
   whose body does async network I/O (`reqwest`, with the existing SSRF
   guard) by spawning a **dedicated OS thread** that builds its own
   `tokio::runtime::Builder::new_current_thread()` and `.block_on()`s the
   async work inside that new thread, then `.join()`s the thread from the
   synchronous caller. This avoids the runtime-nesting hazard entirely
   (it's a fresh, unrelated runtime on a fresh, unrelated thread) and is
   already proven correct and shipped for exactly the "sync trait method
   wraps async network I/O" shape MCP needs.
4. **Conclusion:** a single-round-trip MCP `tools/call` (the common case —
   confirmed by the RC blog post: "a standard tool call completes in one
   HTTP round trip when no additional input is required") maps cleanly onto
   `PluginExecutor::execute()` using the `web_plugin.rs`/`http_plugin.rs`
   thread-plus-`block_on` pattern verbatim. **No trait change, no
   architectural rework needed for this case.**
5. **The genuine gap, correctly flagged by the plan and confirmed against
   the real spec:** Multi Round-Trip Requests. Per the RC blog (quoting the
   spec): when a server needs input mid-call it returns
   `{"resultType": "input_required", "inputRequests": {...},
   "requestState": "<opaque base64>"}`, and the client must re-issue the
   call carrying `inputResponses` + the echoed `requestState` — a second
   (or Nth) HTTP round trip, potentially requiring a return trip to the
   *user* (an "elicitation" input request is explicitly the example given:
   `"message": "Delete 3 files?"`). A single synchronous `execute()` call
   **cannot** service this by itself — it would need to suspend
   mid-execution, surface a prompt back through the agent loop/approval
   channel (structurally similar to, but distinct from, the existing
   `capability_policy` approval gate — that gate is yes/no on a fully-formed
   call; MRTR elicitation is the *server* asking for more *data*), and
   resume. This does not fit the thread+`block_on` trick, because there is
   no way to hand control back to the outer async agent loop mid-`execute`
   without the trait itself becoming async or the MRTR round trip being
   handled entirely outside `PluginExecutor::execute` (e.g., driven from
   `agent/mod.rs` directly, with `execute()` only ever called once state is
   fully resolved).
6. **Recommendation (carried into Part 2 §1):** Phase 8.3 implements only
   the single-round-trip case through `PluginExecutor::execute` using the
   proven pattern above. MRTR's `input_required` interim-result handling is
   explicitly out of scope for the first build pass and named as a stated
   limitation (mirroring how this plan already scopes out legacy MCP
   sessions) — not silently dropped.

### Q2. `RuntimeType::Mcp` as a clean 5th variant

**Confirmed clean**, with the exact set of sites enumerated:

- Enum: `src-tauri/src/models/plugin.rs:60-65` — `Builtin`, `Wasm`,
  `Python`, `Nodejs`. Adding `Mcp` here.
- `src-tauri/src/plugin_manager.rs:368` (`load()`) — `match
  plugin.runtime.runtime_type { Python => ..., Wasm => ..., _ => {} }`.
  Already **non-exhaustive by design** (`_` catch-all) — `Nodejs` is
  *already* declared in the enum and already falls through this exact arm
  today with zero special-cased load behavior, which is direct precedent
  that adding `Mcp` here requires only adding a new match arm if MCP needs
  load-time setup (it likely does: fetching/caching `tools/list` — see Q3),
  and compiles safely even if left unhandled.
- `src-tauri/src/plugin_manager.rs:454,460` (`execute_capability()`) — two
  sequential `if plugin.runtime.runtime_type == ...Python` /
  `...Wasm` checks (not a `match`), each routing to that runtime's
  `execute()` before falling through to the generic `executors.get(plugin_id)`
  path. Adding a third `if runtime_type == RuntimeType::Mcp` block, routing
  to the new `mcp_client.rs`, is additive and does not touch the other two.
- `src-tauri/src/models/manifest.rs:112` (`valid_types` array, used by
  `.wpk`/directory-manifest TOML validation) and `:124-128` (`to_plugin()`
  string→enum match, `_ => RuntimeType::Builtin` catch-all). **Not
  applicable to MCP** — MCP servers are not manifest-file-loaded plugins
  (no `.wpk`, no `manifest.toml`); they are discovered live over the wire
  and registered programmatically (see Q5), the same way `create_builtin_plugins()`
  builds `Plugin` structs in Rust code today rather than parsing a
  manifest. No change needed here; noted only so a future reader doesn't
  wonder why it was skipped.
- Frontend: `src/types/plugin.ts:1` — `RuntimeType` is a plain string union,
  and its only consumer, `src/components/plugins/PluginCard.tsx:256`, does
  `{plugin.runtime.type}` — **raw text interpolation, not a switch/`Record`
  keyed lookup**. Grepped the whole `PluginCard.tsx` for any
  `Record<RuntimeType, ...>`-shaped icon/label map: none exists. Adding
  `'mcp'` to the union and to `RuntimeType` server-side requires **zero**
  frontend match-site changes; the badge will render "mcp" automatically.

**No site assumes an exhaustive match over exactly 4 variants.** The
existing `Nodejs` variant is itself unimplemented beyond enum-level
declaration + manifest parsing, which is the working precedent for adding
`Mcp` incrementally.

### Q3. Schema fit

**Confirmed, no transformation needed for the common case.** `Capabilities.schemas`
is `HashMap<String, serde_json::Value>` (`src-tauri/src/models/plugin.rs:41-44`,
already real-JSON-Schema-typed since the Phase 1/2 spine migration — see
`phase1-spine-spec.md` §4). An MCP `tools/list` response's `inputSchema`
field (already real JSON Schema per the MCP spec, before *and* after
2026-07-28 — this was never the free-text-example problem Phase 3's
`schema_from_example` solved) drops in as-is: `plugin.capabilities.schemas.insert(tool.name,
tool.input_schema)` with no `schema_from_example()` inference pass. The
per-provider tool-envelope conversion already exists and is
capability-schema-source-agnostic — `tools_for_provider()`
(`src-tauri/src/plugin_manager.rs:540-576`) reads from
`plugin.capabilities.schemas`/`.descriptions`/`.provide` uniformly for
every loaded plugin regardless of runtime type, so MCP-sourced capabilities
get OpenAI/Anthropic/Ollama tool envelopes for free once registered into
the same `Plugin` struct. One real wrinkle, not a blocker: MCP tool names
are server-defined strings with no guaranteed format; `provider_tool_name()`
(`plugin_manager.rs:509-521`, SHA-256-suffixed, ASCII-sanitized,
48-char-truncated) already handles arbitrary capability-id strings safely —
this is exactly the mechanism added in commit `4037b22` for provider
name-charset restrictions, and it needs no changes to also cover MCP tool
names.

### Q4. Auth surface fit

`AppConfig` (`src-tauri/src/utils/config.rs:8-14`) is a single struct
serialized with `serde_json::to_string_pretty` to a **plaintext** file,
`~/.weave/config.json` (`config.rs:207-216`, `config_path()` at
`:218-222`) — no OS keychain, no encryption at rest. Existing provider
credentials (`ProviderConfig.api_key: String`, `config.rs:38`) are stored
this way today for OpenAI/Anthropic/Kimi/Opencode, edited via
`SettingsPanel.tsx` (plain controlled `<Input>` bound to
`config.ai.<provider>.api_key`, e.g. `SettingsPanel.tsx:138-142`).

**2026-07-28's CIMD model needs different data than a static API key, but
the same storage mechanism can hold it:**
- **Client identity**: under CIMD (`draft-ietf-oauth-client-id-metadata-document`,
  the spec's now-recommended replacement for Dynamic Client Registration —
  changelog "Deprecated Features" #4), the OAuth `client_id` **is** an
  HTTPS URL pointing to a self-hosted static JSON metadata document (name,
  redirect URIs, grant types), fetched and validated by the authorization
  server at registration time. This is normally **one document per client
  application**, not one per MCP server — Weave would host a single CIMD
  document (e.g. under a Weave-controlled or GitHub Pages URL) and reuse
  the same `client_id` URL across every MCP server it connects to,
  analogous to how other OAuth-ecosystem clients ship one metadata document platform-wide.
  This is new *infrastructure* (someone must host that static JSON
  somewhere reachable over HTTPS) but not new *per-user local storage*.
- **Per-server state that *does* need local storage**: for each configured
  MCP server — discovered authorization-server metadata (issuer,
  authorization/token endpoints, from OAuth/OIDC discovery), the issued
  access token, the refresh token, and token expiry. Structurally this is
  "one more record per external endpoint," the same shape as
  `AiConfig`'s per-provider `ProviderConfig` today, just keyed by
  server URL/id instead of by a fixed provider enum — i.e. a new
  `mcp_servers: HashMap<String, McpServerConfig>` (or `Vec<McpServerConfig>`)
  field on `AppConfig`, saved through the existing `AppConfig::save()`
  path.
- **Fits the existing pattern in kind, but inherits its existing weakness**:
  refresh tokens are more sensitive than a static provider API key (a leaked
  refresh token can be used to mint new access tokens indefinitely until
  revoked), and they are being added to a config file this codebase already
  stores in plaintext with no OS-keychain integration. This is a
  **pre-existing gap this phase does not need to fix** (the provider API
  keys have the same exposure today), but it should be named plainly in the
  spec lock (Part 2 §5) rather than silently inherited, since MCP is the
  first time a *rotating, more-sensitive* secret type would use this path.

### Q5. Discovery/config UX surface

**Reuse `Plugin Marketplace`, confirmed as the right default, with a
concrete anchor point.** `src/components/plugins/PluginMarket.tsx` already
has a working, shipped pattern for "add a new capability source" as a
button next to the existing plugin grid:
`PluginMarket.tsx:122-141` renders a "GitHub" toggle button (switches to
`GithubPluginPanel`) and an "Install .wpk" button (opens a native file
dialog via `installFromFile`) side by side in the marketplace header. A
third button, "Add MCP Server" (opening a small form for server URL +
CIMD/OAuth kickoff, or a `GithubPluginPanel`-shaped panel), is additive to
an already-multi-source header — it does not introduce a new nav item, a
new `Workspace.tsx` view, or a new mental model; it is the same
gesture users already have twice over. `PluginCard.tsx:256`'s raw
`{plugin.runtime.type}` badge display means MCP-sourced plugins show up
in the existing "Discovered" section (`PluginMarket.tsx:258-282`) exactly
like directory-discovered/GitHub-installed plugins do, with no
`PluginCard` changes required beyond what Q2 already covers.

---

## Part 2 — Phase 8.2 Spec Lock

### §1. Integration model

**Locked: MCP is a runtime type inside the existing plugin registry**
(`RuntimeType::Mcp`), not a parallel subsystem — confirmed, not just
recommended, by Part 1 Q1–Q3: the dispatch chain, schema representation,
and tool-envelope conversion are all already runtime-type-agnostic and
need no bypass. **Scope for Phase 8.3: single-round-trip `tools/call`
only**, executed via `PluginExecutor::execute()` using the
`web_plugin.rs`/`http_plugin.rs` thread + `tokio::runtime::Builder::new_current_thread().block_on()`
pattern. MRTR's `input_required` interim-result / elicitation flow is
**explicitly deferred**, not silently unsupported — an MCP server that
returns `resultType: "input_required"` on a `tools/call` in the Phase 8.3
build should surface as a clean tool-execution error (e.g. "this MCP tool
requires interactive input, which Weave does not yet support") rather than
hanging or silently dropping the call. Revisit in a later phase once a
concrete need (a real server that requires elicitation) shows up — same
discipline as the "no legacy MCP session support" scoping below.

### §2. Approval gate default for MCP-sourced capabilities

**Locked as recommended: MCP-sourced capabilities default to
`SENSITIVE_CAPS`-equivalent (approval-gated) unless the user explicitly
allowlists a specific server/tool.** Mechanically, this **cannot** be
implemented by adding MCP capability strings to the existing
`DESTRUCTIVE_CAPS`/`SENSITIVE_CAPS` static `&[&str]` arrays
(`src-tauri/src/utils/capability_policy.rs:24-90`) — those are compile-time
allowlists of known, hand-classified builtin capability ids; MCP capability
ids are discovered at runtime and unbounded. Confirmed via
`capability_policy.rs`'s own test (`unknown_caps_are_not_gated`,
`:111-114`): any capability string not in one of the two arrays is
**ungated by default today**. Left as-is, an MCP tool would silently
execute ungated the first time it's called — exactly the class of gap
Phase 1 closed for the frontend parser, reopened at a new entry point.

The fix has a clean seam: `capability_policy::requires_approval(capability:
&str)` is called from `agent/mod.rs:351`, at a point where `plugin_id` has
already been resolved (`agent/mod.rs:321`, `resolve_capability`) and is in
scope. The gate needs to become runtime-aware — either (a) `requires_approval`
takes the resolved `Plugin` (or its `RuntimeType` + an explicit-allowlist
lookup) instead of a bare capability string, defaulting to `true` whenever
`runtime_type == RuntimeType::Mcp` and the specific `(server, tool)` pair is
not present in a new user-maintained allowlist (stored alongside the
per-server `AppConfig` entries from Q4), or (b) MCP registration
synthesizes entries into a *runtime* sensitive-set the static arrays don't
cover, checked in addition to the two constant arrays. (a) is preferred —
it keeps `DESTRUCTIVE_CAPS`/`SENSITIVE_CAPS` as the hand-audited builtin
list they already are and adds a structurally separate, explicitly
allowlist-shaped check for the opaque/third-party case, rather than
blending "the engagement personally read this code" classification with
"the user opted a specific external tool in."

### §3. Transport/session model

**Confirmed against the real spec (not the plan's summary): the stateless
2026-07-28 core is a good fit for the existing per-turn loop, with one
required addition.** The changelog's "Major Changes" #1–#2 (session
removal, `initialize`/`initialized` handshake removal, `Mcp-Session-Id`
gone, protocol version + capabilities carried per-request in `_meta`) mean
there is no long-lived connection state for Weave to keep across turns —
each `tools/call` (and `tools/list`) is a self-contained HTTP request,
matching `agent/mod.rs`'s existing per-round-trip shape
(`agent/mod.rs:200`, `for _round in 0..MAX_ROUNDS`) far better than the
2025-11-25 session model would have. Required addition, per the changelog's
header-routing framing (blog RC post: `Mcp-Method`/`Mcp-Name` headers,
`MCP-Protocol-Version` header) and #3 (`server/discover`): `mcp_client.rs`
issues a `server/discover` call at first contact with a configured server
to confirm the negotiated protocol version and capabilities before the
first real `tools/list`, and sets `Mcp-Method`/`Mcp-Name`/`MCP-Protocol-Version`
headers on every request rather than relying on a body-encoded method
name the way JSON-RPC-over-stdio implementations traditionally have.
`tools/list` caching (changelog: list endpoints carry cache
hints — blog RC: `ttlMs`/`cacheScope`) is honored by `mcp_client.rs`
caching the parsed tool list in memory keyed by server + honoring the
returned TTL, re-fetching on expiry — this is what makes repeated
`tools_for_provider()` calls (once per agent-loop round, `agent/mod.rs:208`)
cheap for MCP-backed plugins the way they already are for builtins (an
in-memory `Vec<Plugin>`, no I/O).

### §4. Version target

**Locked: 2026-07-28 only.** Older MCP revisions (2025-11-25 and earlier —
session-based, `Mcp-Session-Id`, `initialize` handshake, core-native Tasks)
are **out of scope** and will not connect: `mcp_client.rs`'s `server/discover`
step (§3) is the enforcement point — a server that doesn't support
2026-07-28 (or returns `UnsupportedProtocolVersionError` per the
changelog's #2) is treated as unsupported and surfaced as a clear
configuration error in the "Add MCP Server" UX (Part 1 Q5), not a silent
failure or a fallback attempt at an older transport. This is a documented
limitation (README, Phase 8.6), not a silently-discovered one.

### §5. Auth storage location

**Locked: extends `AppConfig`/`~/.weave/config.json`**, the existing
pattern (Part 1 Q4) — a new `mcp_servers: HashMap<String, McpServerConfig>`
field (server URL/id → `{ discovery metadata (issuer, endpoints), access
token, refresh token, expiry, allowlisted tool names }`), saved through the
existing `AppConfig::save()`/`config_path()` machinery, no new store. The
single CIMD client-identity document (Part 1 Q4) is static, non-secret,
platform-wide config (not per-user, not per-server) — it does not belong
in `~/.weave/config.json` at all; it is either a build-time constant
(a URL to a document Weave's maintainers host) or, if self-hosting isn't
set up yet, a documented manual prerequisite for enabling MCP servers that
require OAuth (some MCP servers may not require auth at all and work with
no client identity). **Named plainly per Part 1 Q4's finding:** refresh
tokens land in the same plaintext, non-keychain-backed file the provider
API keys already use — an accepted pre-existing gap, not a new one, but
stated here so it isn't rediscovered later as a surprise.

### §6. Discovery/config UX surface

**Locked: Plugin Marketplace**, per Part 1 Q5 — a third "Add MCP Server"
entry point alongside the existing "GitHub" and "Install .wpk" buttons in
`PluginMarket.tsx`'s header, no new nav item or view.

---

## Acceptance criteria — checklist

- [x] Every Phase 8.1 question answered with file:line evidence, no TBD
      (Q1 additionally required re-deriving the sync/async dispatch
      question from the real trait signature and an existing codebase
      precedent, not just confirming the plan's assumption)
- [x] Spec text grounded in the actual 2026-07-28 changelog + two official
      protocol-blog posts, retrieved this session (not the plan's summary
      framing) — sources listed above; primitive-level spec pages on
      `modelcontextprotocol.io` itself were unreachable (egress-blocked)
      and that limitation is stated rather than papered over
      with the plan's own summary as if it were verified
- [x] Integration model, approval-gate default, transport/session model,
      version scope, auth storage location, and discovery UX all locked
      with a stated reason
- [x] Phase 8.0 prerequisite addressed honestly (not claimed resolved —
      see `phase1-spine-spec.md` §7)
- [ ] **Explicit human review/approval of this document** — outstanding.
      Phase 8.3 must not start until this is checked.
