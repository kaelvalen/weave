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
use crate::utils::errors::WeaveError;

pub struct PluginManager {
    plugins: Arc<RwLock<HashMap<String, Plugin>>>,
    executors: Arc<RwLock<HashMap<String, Box<dyn PluginExecutor>>>>,
    builtin: Vec<Plugin>,
    plugin_dir: PathBuf,
}

impl PluginManager {
    pub fn new(plugin_dir: PathBuf) -> Self {
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
        let mut plugin = manifest.to_plugin(Some(path.clone()), false);
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
        prompt.push_str("You are Weave, a helpful AI assistant with access to powerful tools.\n\n");
        prompt.push_str("## Tool Usage Rules\n");
        prompt.push_str("- If you need to use a tool, output ONLY: <call plugin=\"tool_name\">{\"param\":\"value\"}</call>\n");
        prompt.push_str("- Wait for the tool result before continuing.\n");
        prompt.push_str("- If no tool is needed, respond normally.\n");
        prompt.push_str("- For text with newlines in JSON parameters, use \\n.\n\n");
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

        prompt.push_str("\n## Example\n");
        prompt.push_str("To get current time: <call plugin=\"sys.time\">{}</call>\n");
        prompt.push_str("To read a file: <call plugin=\"file.read\">{\"path\":\"/home/user/test.txt\"}</call>\n");
        prompt
    }
}
