# Weave postmortems

When a real failure ships (or nearly ships) here, it gets a numbered postmortem
in this directory. The value is the **rule that prevents recurrence** — that
rule also lives (with its siblings) in `../defensive-patterns.md`. This is
institutionalized learning, the same practice DeepSeek Harness follows in its
`docs/postmortem/`.

## Convention

Name: `NNNN-short-slug.md`. Each entry records: what happened, the root cause,
how it was found (ideally a live probe or a regression test that would have
caught it), the fix, and the rule extracted. Add the rule to
`defensive-patterns.md` if it is not already there.

## Index

- [0001-mcp-oauth-rfc9728.md](0001-mcp-oauth-rfc9728.md) — the double-`.well-known`
  OAuth resolution bug (live failure against Puter MCP).
