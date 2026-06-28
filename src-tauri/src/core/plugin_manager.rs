use parking_lot::RwLock;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{info, warn};

use crate::models::manifest::Manifest;
use crate::models::plugin::*;
use crate::plugins::calc_plugin::CalcPlugin;
use crate::plugins::file_plugin::FilePlugin;
use crate::plugins::note_plugin::NotePlugin;
use crate::plugins::sys_plugin::SysPlugin;
use crate::plugins::shell_plugin::ShellPlugin;
use crate::plugins::web_plugin::WebPlugin;
use crate::plugins::sqlite_plugin::SqlitePlugin;
use crate::plugins::git_plugin::GitPlugin;
use crate::plugins::http_plugin::HttpPlugin;
use crate::plugins::memory_plugin::MemoryPlugin;
use crate::plugins::coder_plugin::CoderPlugin;
use crate::plugins::canvas_plugin::CanvasPlugin;
use crate::utils::errors::WeaveError;

pub struct PluginManager {
    plugins: Arc<RwLock<HashMap<String, Plugin>>>,
    executors: Arc<RwLock<HashMap<String, Box<dyn PluginExecutor>>>>,
    builtin: Vec<Plugin>,
    plugin_dir: PathBuf,
}

impl PluginManager {
    pub fn new(plugin_dir: PathBuf, canvas_tx: tokio::sync::broadcast::Sender<serde_json::Value>) -> Self {
        let builtin = Self::create_builtin_plugins();
        let mut plugins = HashMap::new();
        let mut executors: HashMap<String, Box<dyn PluginExecutor>> = HashMap::new();

        for plugin in &builtin {
            let mut p = plugin.clone();
            p.state = PluginState::Active;
            let id = p.id.clone();
            let name = p.name.clone();
            plugins.insert(id.clone(), p);
            info!("Registered built-in plugin: {} ({})", name, id);
        }

        // Register executors
        executors.insert("com.weave.builtin.file".into(), Box::new(FilePlugin));
        executors.insert("com.weave.builtin.calc".into(), Box::new(CalcPlugin));
        executors.insert("com.weave.builtin.note".into(), Box::new(NotePlugin));
        executors.insert("com.weave.builtin.sys".into(), Box::new(SysPlugin));
        executors.insert("com.weave.builtin.shell".into(), Box::new(ShellPlugin));
        executors.insert("com.weave.builtin.web".into(), Box::new(WebPlugin));
        executors.insert("com.weave.builtin.db".into(), Box::new(SqlitePlugin));
        executors.insert("com.weave.builtin.git".into(), Box::new(GitPlugin));
        executors.insert("com.weave.builtin.http".into(), Box::new(HttpPlugin));
        executors.insert("com.weave.builtin.memory".into(), Box::new(MemoryPlugin));
        executors.insert("com.weave.builtin.coder".into(), Box::new(CoderPlugin));
        executors.insert("com.weave.builtin.canvas".into(), Box::new(CanvasPlugin { canvas_tx }));

        Self {
            plugins: Arc::new(RwLock::new(plugins)),
            executors: Arc::new(RwLock::new(executors)),
            builtin,
            plugin_dir,
        }
    }

    fn create_builtin_plugins() -> Vec<Plugin> {
        vec![
            PluginBuilder::builtin("com.weave.builtin.file", "File Manager")
                .description("File system operations — read, write, list, search, delete files and directories")
                .category(PluginCategory::System)
                .read_access(&["file://*"])
                .write_access(&["file://*"])
                .capability("file.read", r#"{"path":"..."}"#, "Read file contents at the given path")
                .capability("file.write", r#"{"path":"...","content":"..."}"#, "Write content to a file (creates parent dirs)")
                .capability("file.list", r#"{"directory":"."}"#, "List directory entries with type and size")
                .capability("file.search", r#"{"directory":".","pattern":"..."}"#, "Recursively search for files by name pattern")
                .capability("file.delete", r#"{"path":"..."}"#, "Delete a file or directory")
                .capability("file.mkdir", r#"{"path":"..."}"#, "Create a directory (including parents)")
                .build(),

            PluginBuilder::builtin("com.weave.builtin.calc", "Calculator")
                .description("Mathematical expression evaluator, unit converter, and statistics calculator")
                .category(PluginCategory::Productivity)
                .capability("calc.eval", r#"{"expression":"2+2*3"}"#, "Evaluate a math expression (supports +,-,*,/,^,sqrt,sin,cos,tan,log,pi,e)")
                .capability("calc.convert", r#"{"value":100,"from":"km","to":"miles"}"#, "Convert between units (length, weight, volume, temperature)")
                .capability("calc.stats", r#"{"numbers":[1,2,3,4,5]}"#, "Calculate statistics: mean, median, min, max, std_dev, sum")
                .build(),

            PluginBuilder::builtin("com.weave.builtin.note", "Notes")
                .description("Note taking and management with search and tagging")
                .category(PluginCategory::Productivity)
                .capability("note.create", r#"{"title":"...","content":"...","tags":[]}"#, "Create a new note")
                .capability("note.list", r#"{}"#, "List all notes sorted by last updated")
                .capability("note.get", r#"{"id":"..."}"#, "Get full content of a note by ID")
                .capability("note.update", r#"{"id":"...","title":"...","content":"..."}"#, "Update an existing note")
                .capability("note.delete", r#"{"id":"..."}"#, "Delete a note by ID")
                .capability("note.search", r#"{"query":"..."}"#, "Search notes by title, content, or tags")
                .build(),

            PluginBuilder::builtin("com.weave.builtin.sys", "System & OS")
                .description("System information, time, uptime, hostname, and disk usage")
                .category(PluginCategory::System)
                .capability("sys.info", r#"{}"#, "Get OS, architecture, hostname, and username")
                .capability("sys.time", r#"{}"#, "Get current UTC time and local offset")
                .capability("sys.uptime", r#"{}"#, "Get system uptime")
                .capability("sys.hostname", r#"{}"#, "Get the machine hostname")
                .capability("sys.disk", r#"{}"#, "Get disk usage information")
                .build(),

            PluginBuilder::builtin("com.weave.builtin.shell", "Terminal & Shell")
                .description("Execute shell commands with timeout and safety blocklist")
                .category(PluginCategory::System)
                .capability("shell.exec", r#"{"command":"...","cwd":null,"timeout":30}"#, "Run a shell command (sh -c). Has 30s default timeout and blocks dangerous commands")
                .build(),

            PluginBuilder::builtin("com.weave.builtin.web", "Web Fetcher")
                .description("Fetch web pages and extract text content")
                .category(PluginCategory::System)
                .read_access(&["http://*", "https://*"])
                .capability("web.fetch", r#"{"url":"..."}"#, "Fetch a URL and return content (HTML is auto-stripped to text)")
                .build(),

            PluginBuilder::builtin("com.weave.builtin.db", "Database (SQLite)")
                .description("Execute SQL queries on local SQLite databases")
                .category(PluginCategory::System)
                .read_access(&["file://*.db"])
                .write_access(&["file://*.db"])
                .capability("db.query", r#"{"query":"SELECT ...","db_path":"weave.db"}"#, "Run a SELECT query and return JSON results")
                .capability("db.execute", r#"{"statement":"CREATE TABLE ...","db_path":"weave.db"}"#, "Execute a write statement (INSERT/UPDATE/DELETE/CREATE)")
                .capability("db.tables", r#"{"db_path":"weave.db"}"#, "List all tables and views in the database")
                .build(),

            PluginBuilder::builtin("com.weave.builtin.git", "Git")
                .description("Git repository management — status, add, commit, log, diff, branch")
                .category(PluginCategory::Development)
                .read_access(&["file://*"])
                .write_access(&["file://*"])
                .capability("git.status", r#"{"directory":"."}"#, "Show working tree status (short format) and current branch")
                .capability("git.add", r#"{"directory":".","path":"."}"#, "Stage files for commit")
                .capability("git.commit", r#"{"directory":".","message":"..."}"#, "Commit staged changes")
                .capability("git.log", r#"{"directory":".","limit":5}"#, "Show recent commit log (oneline)")
                .capability("git.diff", r#"{"directory":".","staged":false,"file":null}"#, "Show diff of working tree or staged changes")
                .capability("git.branch", r#"{"directory":"."}"#, "List all branches and show current branch")
                .build(),

            PluginBuilder::builtin("com.weave.builtin.http", "HTTP Client")
                .description("Advanced HTTP requests (GET, POST, PUT, DELETE, PATCH) for API testing")
                .category(PluginCategory::Development)
                .read_access(&["http://*", "https://*"])
                .write_access(&["http://*", "https://*"])
                .capability("http.request", r#"{"url":"...","method":"GET","headers":{},"body":null,"timeout":30}"#, "Send an HTTP request and return status, headers, and body")
                .build(),

            PluginBuilder::builtin("com.weave.builtin.memory", "AI Memory")
                .description("Persistent key-value memory for the AI assistant")
                .category(PluginCategory::Ai)
                .read_access(&["memory://*"])
                .write_access(&["memory://*"])
                .capability("memory.store", r#"{"key":"...","value":{...}}"#, "Store a value under a key (any JSON value)")
                .capability("memory.recall", r#"{"key":"..."}"#, "Recall a value by key (omit key to get all)")
                .capability("memory.delete", r#"{"key":"..."}"#, "Delete a stored key")
                .capability("memory.list", r#"{}"#, "List all stored memory keys")
                .build(),

            PluginBuilder::builtin("com.weave.builtin.coder", "Coder AI")
                .description("Advanced agentic coding capabilities for autonomous software development")
                .category(PluginCategory::Ai)
                .read_access(&["file://*"])
                .write_access(&["file://*"])
                .capability("coder.read_file", r#"{"path":"..."}"#, "Read source file with line numbers")
                .capability("coder.write_file", r#"{"path":"...","content":"...","create_dirs":true}"#, "Write a file (backs up previous to .weave.bak)")
                .capability("coder.apply_diff", r#"{"path":"...","old_str":"...","new_str":"..."}"#, "Replace EXACT unique string old_str with new_str")
                .capability("coder.revert_file", r#"{"path":"..."}"#, "Revert a file to its .weave.bak backup (undo change)")
                .capability("coder.run_check", r#"{"directory":"."}"#, "Auto-detect project type and run compiler/type checker")
                .capability("coder.run_tests", r#"{"directory":".","filter":null}"#, "Auto-detect project type and run tests")
                .capability("coder.list_dir", r#"{"path":".","depth":2,"show_hidden":false}"#, "Print directory tree structure")
                .build(),

            PluginBuilder::builtin("com.weave.builtin.canvas", "Canvas AI")
                .description("Interact with the visual infinite canvas to create and manage diagrams, notes, and UI layouts")
                .category(PluginCategory::Ai)
                .capability("canvas.add_node", r##"{"type":"shapeNode","data":{"shapeType":"rectangle","backgroundColor":"#3b82f6"},"position":{"x":100,"y":100}}"##, "Add a node to the canvas. Types: shapeNode, textNode, noteNode, codeNode")
                .capability("canvas.update_node", r#"{"id":"ai_node_123","data":{"text":"Hello"}}"#, "Update the data of an existing node")
                .capability("canvas.clear", r#"{}"#, "Clear all nodes from the canvas")
                .build(),
        ]
    }

    pub fn discover(&self) -> Result<Vec<Plugin>, WeaveError> {
        let mut all_plugins = self.builtin.clone();

        if !self.plugin_dir.exists() {
            std::fs::create_dir_all(&self.plugin_dir)?;
            return Ok(all_plugins);
        }

        let entries = std::fs::read_dir(&self.plugin_dir)?;

        for entry in entries {
            let entry = entry?;
            let path = entry.path();

            if path.extension().and_then(|s| s.to_str()) == Some("wpk") {
                match self.load_wpk_plugin(&path) {
                    Ok(plugin) => {
                        if !all_plugins.iter().any(|p| p.id == plugin.id) {
                            all_plugins.push(plugin);
                        }
                    }
                    Err(e) => { warn!("Failed to load .wpk plugin at {:?}: {}", path, e); }
                }
            } else if path.is_dir() {
                let manifest_path = path.join("manifest.toml");
                if manifest_path.exists() {
                    match self.load_directory_plugin(&path) {
                        Ok(plugin) => {
                            if !all_plugins.iter().any(|p| p.id == plugin.id) {
                                all_plugins.push(plugin);
                            }
                        }
                        Err(e) => { warn!("Failed to load plugin at {:?}: {}", path, e); }
                    }
                }
            }
        }

        let mut plugins = self.plugins.write();
        for plugin in &all_plugins {
            if !plugins.contains_key(&plugin.id) {
                plugins.insert(plugin.id.clone(), plugin.clone());
            }
        }

        info!("Discovered {} plugins total", all_plugins.len());
        Ok(all_plugins)
    }

    fn extracted_dir(&self, plugin_id: &str) -> PathBuf {
        self.plugin_dir.join(".extracted").join(plugin_id)
    }

    fn load_wpk_plugin(&self, path: &PathBuf) -> Result<Plugin, WeaveError> {
        let file = std::fs::File::open(path)?;
        let mut archive = zip::ZipArchive::new(file)?;
        let mut manifest_content = String::new();
        {
            let mut manifest_file = archive.by_name("manifest.toml")
                .map_err(|_| WeaveError::InvalidManifest("manifest.toml not found in .wpk".to_string()))?;
            use std::io::Read;
            manifest_file.read_to_string(&mut manifest_content)?;
        }
        let manifest = Manifest::from_toml(&manifest_content)?;

        let extract_dir = self.extracted_dir(&manifest.plugin.id);
        if extract_dir.exists() {
            std::fs::remove_dir_all(&extract_dir)?;
        }
        std::fs::create_dir_all(&extract_dir)?;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i)?;
            let outpath = match file.enclosed_name() {
                Some(p) => extract_dir.join(p),
                None => continue,
            };

            if file.name().ends_with('/') {
                std::fs::create_dir_all(&outpath)?;
            } else {
                if let Some(parent) = outpath.parent() {
                    if !parent.exists() {
                        std::fs::create_dir_all(parent)?;
                    }
                }
                let mut outfile = std::fs::File::create(&outpath)?;
                std::io::copy(&mut file, &mut outfile)?;
            }
        }

        let mut plugin = manifest.to_plugin(Some(extract_dir), false);
        plugin.state = PluginState::Discovered;
        Ok(plugin)
    }

    fn load_directory_plugin(&self, path: &PathBuf) -> Result<Plugin, WeaveError> {
        let manifest_path = path.join("manifest.toml");
        let content = std::fs::read_to_string(&manifest_path)?;
        let manifest = Manifest::from_toml(&content)?;
        let mut plugin = manifest.to_plugin(Some(path.clone()), false);
        plugin.state = PluginState::Discovered;
        Ok(plugin)
    }

    pub fn load(&self, plugin_id: &str) -> Result<Plugin, WeaveError> {
        let mut plugins = self.plugins.write();
        let plugin = plugins.get_mut(plugin_id)
            .ok_or_else(|| WeaveError::PluginNotFound(plugin_id.to_string()))?;
        if plugin.is_loaded() {
            return Err(WeaveError::PluginAlreadyLoaded(plugin_id.to_string()));
        }

        match plugin.runtime.runtime_type {
            crate::models::plugin::RuntimeType::Python => {
                let rt = crate::runtime::python::PythonRuntime::new()?;
                if let Err(e) = rt.load(plugin) {
                    let msg = format!("{}", e);
                    plugin.state = PluginState::Error(msg.clone());
                    return Err(WeaveError::PluginLoadError {
                        plugin_id: plugin.id.clone(),
                        reason: msg,
                    });
                }
            }
            crate::models::plugin::RuntimeType::Wasm => {
                // WASM modules are compiled per execution; no load-time setup required.
            }
            _ => {}
        }

        plugin.state = PluginState::Loaded;
        info!("Loaded plugin: {} ({})", plugin.name, plugin.id);
        Ok(plugin.clone())
    }

    pub fn activate(&self, plugin_id: &str) -> Result<Plugin, WeaveError> {
        let mut plugins = self.plugins.write();
        let plugin = plugins.get_mut(plugin_id)
            .ok_or_else(|| WeaveError::PluginNotFound(plugin_id.to_string()))?;
        plugin.state = PluginState::Active;
        info!("Activated plugin: {} ({})", plugin.name, plugin.id);
        Ok(plugin.clone())
    }

    pub fn unload(&self, plugin_id: &str) -> Result<(), WeaveError> {
        let mut plugins = self.plugins.write();
        let plugin = plugins.get_mut(plugin_id)
            .ok_or_else(|| WeaveError::PluginNotFound(plugin_id.to_string()))?;
        if plugin.is_builtin {
            return Err(WeaveError::PluginError("Cannot unload built-in plugins".to_string()));
        }
        plugin.state = PluginState::Unloaded;
        info!("Unloaded plugin: {} ({})", plugin.name, plugin.id);
        Ok(())
    }

    pub fn get_all(&self) -> Vec<Plugin> {
        self.plugins.read().values().cloned().collect()
    }

    pub fn get_loaded(&self) -> Vec<Plugin> {
        self.plugins.read().values()
            .filter(|p| p.is_loaded() || p.is_active())
            .cloned()
            .collect()
    }

    pub fn get_plugin(&self, plugin_id: &str) -> Option<Plugin> {
        self.plugins.read().get(plugin_id).cloned()
    }

    pub fn execute_capability(
        &self,
        plugin_id: &str,
        capability: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, WeaveError> {
        let plugin = self.get_plugin(plugin_id)
            .ok_or_else(|| WeaveError::PluginNotFound(plugin_id.to_string()))?;

        if !plugin.has_capability(capability) {
            return Err(WeaveError::CapabilityNotFound(
                format!("{} does not provide '{}'", plugin_id, capability)
            ));
        }

        info!("Executing capability: {}::{}", plugin_id, capability);

        // Route to PythonRuntime if it's a python plugin
        if plugin.runtime.runtime_type == crate::models::plugin::RuntimeType::Python {
            let python_runtime = crate::runtime::python::PythonRuntime::new()?;
            return python_runtime.execute(&plugin, capability, params);
        }

        // Route to WasmRuntime if it's a wasm plugin
        if plugin.runtime.runtime_type == crate::models::plugin::RuntimeType::Wasm {
            #[cfg(feature = "wasm-runtime")]
            {
                let wasm_runtime = crate::runtime::wasm::WasmRuntime::new()?;
                return wasm_runtime.execute(&plugin, capability, params);
            }
            #[cfg(not(feature = "wasm-runtime"))]
            {
                return Err(WeaveError::PluginError("WASM runtime feature is not enabled".to_string()));
            }
        }

        // Use executor registry instead of hardcoded match
        let executors = self.executors.read();
        if let Some(executor) = executors.get(plugin_id) {
            return executor.execute(capability, params);
        }

        Err(WeaveError::PluginError(
            format!("No executor registered for plugin: {}", plugin_id)
        ))
    }

    pub fn find_plugins_for_capability(&self, capability: &str) -> Vec<Plugin> {
        self.plugins.read().values()
            .filter(|p| p.has_capability(capability))
            .cloned()
            .collect()
    }

    pub fn get_system_prompt(&self) -> String {
        let mut prompt = String::new();
        prompt.push_str("You are Weave, an advanced autonomous Agentic Coding Assistant.\n\n");
        prompt.push_str("## Core Directives\n");
        prompt.push_str("1. **Agentic Loop**: You do not just answer questions; you take autonomous action. You make tool calls, receive results, evaluate if the task is done, and if not, you take the next step. You only stop and talk to the user when the task is complete, or you are completely stuck.\n");
        prompt.push_str("2. **Context Gathering**: Always start by understanding the environment. Use `coder.list_dir` or `coder.read_file` to analyze the project structure and existing code BEFORE writing code.\n");
        prompt.push_str("3. **Multi-step Planning**: Break down complex requests. Think step-by-step. Implement one part, run tests/checks, then move to the next.\n");
        prompt.push_str("4. **Error Recovery**: If a tool call fails (e.g., tests fail, command errors), DO NOT GIVE UP. Analyze the error output, fix the code, and try again.\n");
        prompt.push_str("5. **Refactoring**: Use `coder.apply_diff` for surgical edits. Only use `coder.write_file` for new files or massive rewrites.\n\n");
        prompt.push_str("## Tool Usage Rules\n");
        prompt.push_str("- Output ONLY: <call plugin=\"tool_name\">{\"param\":\"value\"}</call> when using a tool.\n");
        prompt.push_str("- You will receive the tool result in the next turn.\n");
        prompt.push_str("- You may execute ONE tool at a time.\n");
        prompt.push_str("- Do NOT output markdown code blocks containing the `<call>` tag. Output the `<call>` tag completely unformatted.\n\n");
        prompt.push_str("## Available Tools\n\n");

        for plugin in self.get_loaded() {
            for cap in &plugin.capabilities.provide {
                let schema = plugin.capabilities.schemas.get(cap).map(|s| s.as_str()).unwrap_or("{}");
                let desc = plugin.capabilities.descriptions.get(cap).map(|s| s.as_str()).unwrap_or("");
                if desc.is_empty() {
                    prompt.push_str(&format!("- **{}**: Schema: `{}`\n", cap, schema));
                } else {
                    prompt.push_str(&format!("- **{}**: {} — Schema: `{}`\n", cap, desc, schema));
                }
            }
        }

        prompt.push_str("\n## Example Flow\n");
        prompt.push_str("User: Fix the bug in auth.ts\n");
        prompt.push_str("You: <call plugin=\"coder.read_file\">{\"path\":\"src/auth.ts\"}</call>\n");
        prompt.push_str("[System returns file content]\n");
        prompt.push_str("You: <call plugin=\"coder.apply_diff\">{\"path\":\"src/auth.ts\", \"old_str\":\"if (user == null)\", \"new_str\":\"if (!user || user.locked)\"}</call>\n");
        prompt.push_str("[System returns success]\n");
        prompt.push_str("You: <call plugin=\"coder.run_check\">{\"directory\":\".\"}</call>\n");
        prompt.push_str("[System returns success]\n");
        prompt.push_str("You: I have fixed the bug and verified the build successfully.\n");
        prompt
    }
}
