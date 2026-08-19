# PM-0001: MCP OAuth — the double-`.well-known` bug

**Status:** Resolved. **Date:** 2026-08-13. **Component:** `mcp_client.rs`
(MCP OAuth 2.1 / CIMD authorization).

## What happened

The first real OAuth-requiring connection — Puter MCP (`mcp.puter.com`) — blew
up in exactly the way a shipped code comment had half-anticipated. Weave's
initial `mcp_add_server` treated a `WWW-Authenticate: Bearer
resource_metadata="<url>"` challenge by feeding that URL **directly into RFC
8414 discovery**, producing a nonsense lookup:

```
<resource_metadata_url>/.well-known/oauth-authorization-server/.well-known/oauth-authorization-server
```

The server returned a 404, the challenge resolution failed, and the server could
not be registered with OAuth.

## Root cause

A `resource_metadata` URL from a 401 challenge is an **RFC 9728 protected-
resource metadata document**, not the authorization server base URL. RFC 9728
the metadata document carries an `authorization_servers` field; only *that* is
the AS identifier to feed into RFC 8414 discovery. The naive "the challenge URL
is the AS base" assumption was wrong, and the code did not distinguish the two
challenge shapes.

## How it was found

A **live** attempt to authorize Puter MCP hit the 404 immediately. The mock
tests had not exercised the RFC 9728 resolution step end-to-end because there
was no live OAuth-requiring server in the hermetic suite — the classic "mocks
can't catch what you never modeled" gap.

## The fix

`mcp_client` now distinguishes the two challenge transports explicitly:

- `Mcp-Authorization: <url>` → `AuthChallenge::Direct` (the URL **is** the AS
  base).
- `resource_metadata="<url>"` → `AuthChallenge::ResourceMetadata`, which must be
  **fetched** and read via its `authorization_servers` field (with an RFC 9728
  bare-server fallback: the metadata URL itself), and only then resolved through
  `discover_authorization_server()`.

A regression guard (`live_oauth_challenge_resolution_against_puter_mcp`, in
`tests/mcp_integration_test.rs`) runs the full 401 → metadata → RFC 8414 chain
against the live server.

## Rule extracted

> A URL in an authentication challenge is not necessarily the authorization
> server. Distinguish "the AS base" from "a protected-resource metadata document
> that *names* the AS base" before discovery, and verify against a real server.
> Add the rule to `../defensive-patterns.md`.
