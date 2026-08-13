# Live MCP round-trip — GitHub MCP Server, 2026-08-13

Closes the Phase 8.4 gap ("mock-tested only, never against a real
2026-07-28 server"). Full `server/discover` → `tools/list` → `tools/call`
through Weave's own `weave::mcp_client` against a real, public,
2026-07-28-protocol MCP server.

## Target

- Endpoint: `https://api.githubcopilot.com/mcp/` — GitHub's official public
  MCP server ("GitHub MCP Server"), reachable with a PAT
  (`Authorization: Bearer <token>`).
- Other public candidates probed first and rejected from this network:
  `api.mcp.remote`, `demo.mcp.orama.cloud`, `mcp.observablehq.com`
  (connection refused/egress-blocked), `mcp.vectorize.io` (503),
  `demo-mcp.convex.cloud` (405/404), `mcp.puter.com` (401).

## Result (run via `cargo test --test mcp_integration_test -- --ignored`)

```
discover: server="github-mcp-server" protocol_versions=[]
tools/list: 47 tools advertised
tools/call get_me -> [{"text":"{\"login\":\"kaelvalen\",\"id\":131282394,...}"]
test live_round_trip_against_github_mcp_server ... ok
```

## Real-world findings that required client changes

The 2026-08-13 live run exposed three things the mock-based tests could
not: a server that is at once protocol-correct and stricter than the
stateless-core prose implied.

1. **`_meta` protocol negotiation is mandatory in practice.** The live
   server rejects every request lacking
   `params._meta["io.modelcontextprotocol/protocolVersion"]` and
   `params._meta["io.modelcontextprotocol/clientCapabilities"]`
   (JSON-RPC error -32602). `rpc_request` now injects both on every
   request.
2. **Responses are SSE-framed even for single round trips.**
   `event: message` / `data: {jsonrpc...}` — the mock (plain JSON body)
   could not have caught this. `post()` now detects
   `Content-Type: text/event-stream` and takes the last parseable
   `data:` frame; plain-JSON responses (the mock) still work.
3. **Server identity lives in `_meta.io.modelcontextprotocol/serverInfo`
   (`name`/`title`), not a top-level `name`.** `server/discover` now reads
   both. GitHub does not advertise `protocolVersions`, so the version
   enforcement point tolerates omission (checked only when present).

## Re-run

```sh
GITHUB_TOKEN=$(gh auth token) nix-shell shell.nix --run \
  "cargo test -p weave --test mcp_integration_test -- --ignored --nocapture"
```

## Artifacts

- `tools-list-response.sse` — raw SSE `tools/list` response from the live
  server (47 tools, full input schemas).
- Test source: `src-tauri/tests/mcp_integration_test.rs`
  (`live_round_trip_against_github_mcp_server`).
