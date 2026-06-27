# Weave

> **AI-native, plugin-based, local-first productivity system.**

## Features

- **AI Chat** — Streaming chat with OpenAI, Anthropic, and Local LLM (Ollama) support
- **Plugin System** — `.wpk` manifest-based plugins with WASM runtime
- **Built-in Plugins** — File manager, Calculator (50+ conversions), Notes
- **Intent Recognition** — AI automatically detects needs and suggests plugins
- **Workflow Engine** — Chain plugins together for complex tasks

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Tailwind CSS + shadcn/ui |
| Backend | Tauri v2 + Rust |
| State | Zustand + Immer |

## Quick Start

```bash
git clone https://github.com/kaelvalen/weave.git
cd weave
npm install
cargo tauri dev
```

## License

MIT
