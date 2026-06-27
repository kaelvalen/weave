# Weave

> **AI-native, plugin-based, local-first productivity system.**

Weave is a universal workspace where AI orchestrates plugins to help you read files, calculate, take notes, and much more — all in a single, extensible platform.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Rust](https://img.shields.io/badge/rust-1.70+-orange.svg)
![Tauri](https://img.shields.io/badge/tauri-v2-purple.svg)
![React](https://img.shields.io/badge/react-18-blue.svg)

## Philosophy

> *"An empty canvas, infinite capabilities."*

Weave starts as a clean workspace. As you express what you want to do, AI discovers and coordinates the right plugins to get it done. Over time, it learns your patterns and automates your workflows.

## Features

### Core
- **AI Chat** — Conversational interface with streaming support
- **Plugin System** — `.wpk` based plugin format with manifest declarations
- **Built-in Plugins** — File manager, Calculator, Notes (always available)
- **Multi-Provider AI** — OpenAI, Anthropic, and Local LLM (Ollama) support
- **Intent Recognition** — AI automatically detects what you want and suggests plugins
- **Workflow Engine** — Chain multiple plugins together for complex tasks

### Built-in Plugins
| Plugin | Capabilities |
|--------|-------------|
| **File** | `file.read`, `file.write`, `file.list`, `file.search` |
| **Calc** | `calc.eval`, `calc.convert` (supports 50+ unit conversions) |
| **Note** | `note.create`, `note.list`, `note.get`, `note.update`, `note.delete` |

### Architecture
```
Tauri GUI (React + TypeScript + Tailwind)
    |
    | IPC (secure messaging)
    v
Rust Core (Tauri Commands)
    |-- Plugin Manager (discovery, lifecycle, sandbox)
    |-- AI Bridge (OpenAI / Anthropic / Local LLM)
    |-- Intent Engine (pattern-based recognition)
    |-- Workflow Engine (plugin chaining)
    v
Plugin Runtime (WASM / Python / JS)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Tailwind CSS + shadcn/ui |
| Backend | Tauri v2 + Rust |
| AI | OpenAI API / Anthropic API / Ollama (local) |
| State | Zustand |
| Icons | Lucide React |

## Getting Started

### Prerequisites
- [Rust](https://rustup.rs/) (1.70+)
- [Node.js](https://nodejs.org/) (18+)
- Tauri CLI: `cargo install tauri-cli`

### Installation

```bash
# Clone the repository
git clone https://github.com/kaelvalen/weave.git
cd weave

# Install frontend dependencies
npm install

# Run in development mode
cargo tauri dev

# Build for production
cargo tauri build
```

### Configuration

On first run, Weave creates a config file at `~/.weave/config.json`. You can configure:

- **AI Providers** — Add your OpenAI or Anthropic API keys
- **Local LLM** — Point to your Ollama instance (default: `http://localhost:11434`)
- **Plugins** — Set custom plugin directory

### Adding Plugins

Place `.wpk` files or plugin directories with `manifest.toml` in `~/.weave/plugins/`:

```
~/.weave/plugins/
  my-plugin/
    manifest.toml
    engine/
      main.wasm
```

Example `manifest.toml`:
```toml
[plugin]
id = "com.example.my-plugin"
name = "My Plugin"
version = "1.0.0"
author = "Your Name"
description = "What this plugin does"

[capabilities]
provide = ["my.capability"]

[runtime]
type = "wasm"
entry = "engine/main.wasm"
```

## Plugin Development

Weave plugins declare their capabilities in a TOML manifest. The engine matches user intents with plugin capabilities to automatically invoke the right tool.

### Capability System
Plugins declare what they **provide**. The AI and intent engine determine what's **needed**.

```toml
[capabilities]
provide = ["file.read", "file.write", "chart.bar"]
```

### Runtime Types
- `builtin` — Compiled into Weave (Rust)
- `wasm` — WebAssembly sandbox (any language that compiles to WASM)
- `python` — Python runtime (PyO3 bridge)
- `nodejs` — JavaScript/TypeScript runtime

## Roadmap

- [x] v0.1 MVP — Chat, Plugin Discovery, Built-in Plugins
- [ ] v0.2 — Plugin Marketplace, WASM runtime
- [ ] v0.3 — Python plugin support, Workflow saving
- [ ] v0.4 — Multi-window, Theming engine
- [ ] v0.5 — Team collaboration features

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

Built with passion by the Weave Team.
