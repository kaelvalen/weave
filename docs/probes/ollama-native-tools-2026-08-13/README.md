# Ollama native tool-calling probe — 2026-08-13

Reproduces the 2026-08-11 probe claim (commit `4037b22`, README "Native Tool
Calling", `LocalConfig::use_native_tools` doc comment) against a real local
Ollama instance. This is the first independently reproducible transcript
committed to the repository; the original claim was prose-only
(see `docs/phase1-spine-spec.md` §7, addendum 2026-08-12).

## Environment

- Host: user's own machine (NixOS, no GPU offload needed for 9B-Q4)
- Ollama 0.32.7 (`nix profile install nixpkgs#ollama`), served via
  `ollama serve` on the default `http://localhost:11434`
- Model: `qwen3.5:9b` (Qwen3.5-9B, Q4_K_M quantization)

## Method

1. `ollama pull qwen3.5:9b`
2. POST `/api/chat` with a `tools` array containing a single
   `get_weather(city)` function and a user message asking for the weather
   in Istanbul.
3. Ran twice: `"stream": false` (response-nonstream.json) and
   `"stream": true` (response-stream.ndjson, raw SSE lines).

## Result

Both variants returned native tool calls:

- `message.tool_calls[0].function.name == "get_weather"`
- arguments parsed as structured JSON: `{"city": "Istanbul"}`
- `done_reason: "stop"`, no XML or markdown-fenced fallback text

This confirms `use_native_tools: true` is the correct default for
`qwen3.5:9b` under Ollama `/api/chat`. Re-run:

```sh
ollama serve &
ollama pull qwen3.5:9b
curl -s http://localhost:11434/api/chat -d @request.json
```

## Artifacts

- `request.json` — exact request payload
- `response-nonstream.json` — `stream:false` response (contains
  `message.tool_calls`)
- `response-stream.ndjson` — `stream:true` SSE lines, one JSON object per line
  (`tool_calls` arrives as a delta chunk in the final message object)
