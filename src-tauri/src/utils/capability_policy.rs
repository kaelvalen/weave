/// Backend approval policy — the single source of truth for which tool calls
/// require explicit user approval before the agent loop executes them.
///
/// The frontend keeps a read-only mirror in `src/lib/capabilities.ts` purely
/// for UI badges and filters; it MUST NOT make gating decisions.
///
/// Classification (see phase1-spine-spec.md §3):
/// - destructive: mutates files/system state
/// - sensitive: reads local data or makes network requests (the exfiltration
///   surface — a prompt-injected call could otherwise ship file contents or
///   internal endpoints to the cloud model)
pub fn requires_approval(capability: &str) -> bool {
    is_destructive(capability) || is_sensitive(capability)
}

/// Runtime-aware gate used at the actual agent-loop call site
/// (`agent/mod.rs`). Wraps `requires_approval` for everything except
/// MCP-sourced capabilities, which the static `DESTRUCTIVE_CAPS`/
/// `SENSITIVE_CAPS` allowlists structurally cannot cover — those are a
/// compile-time list of hand-classified builtin capability ids, while MCP
/// tools are discovered at runtime from a third-party, opaque server whose
/// internals can change without Weave's knowledge.
///
/// Locked default (docs/phase8-mcp-spec.md Part 2 §2): an MCP-sourced
/// capability is gated (approval required) unless the specific
/// `(server, tool)` pair — i.e. the exact capability id, since ids are
/// already namespaced `mcp.<server_id>.<tool_name>` — is present in that
/// server's `allowlisted_tools`. This mirrors the failure mode Phase 1
/// closed for the frontend parser (an unclassified capability defaulting to
/// *ungated*) and refuses to reopen it at the MCP entry point.
pub fn requires_approval_for_call(
    capability: &str,
    plugin: &crate::models::plugin::Plugin,
    config: &crate::utils::config::AppConfig,
) -> bool {
    if plugin.runtime.runtime_type == crate::models::plugin::RuntimeType::Mcp {
        // plugin.id is "com.weave.mcp.<server_id>" (mcp_client::plugin_id);
        // AppConfig.mcp_servers is keyed by the bare server_id.
        let server_id = plugin
            .id
            .strip_prefix("com.weave.mcp.")
            .unwrap_or(plugin.id.as_str());
        let allowlisted = config
            .mcp_servers
            .get(server_id)
            .map(|server| server.allowlisted_tools.contains(capability))
            .unwrap_or(false);
        return !allowlisted;
    }
    requires_approval(capability)
}

pub fn is_destructive(capability: &str) -> bool {
    DESTRUCTIVE_CAPS.contains(&capability)
}

pub fn is_sensitive(capability: &str) -> bool {
    SENSITIVE_CAPS.contains(&capability)
}

pub const DESTRUCTIVE_CAPS: &[&str] = &[
    "file.write",
    "file.delete",
    "file.mkdir",
    "coder.write_file",
    "coder.apply_diff",
    "coder.apply_patch",
    "coder.revert_file",
    "coder.undo",
    "coder.redo",
    "coder.rename_symbol",
    "coder.format",
    "coder.lint",
    "coder.run_check",
    "coder.run_tests",
    "coder.git_commit",
    "shell.exec",
    "shell.run",
    "git.init",
    "git.add",
    "git.commit",
    "db.execute",
    "note.delete",
    "note.update",
    "note.toggle_pin",
    "memory.store",
    "memory.delete",
    "memory.update_profile",
    "canvas.add_node",
    "canvas.update_node",
    "canvas.delete_node",
    "canvas.connect_nodes",
    "canvas.clear",
    "workflow.create",
    "workflow.delete",
];

pub const SENSITIVE_CAPS: &[&str] = &[
    "file.read",
    "file.list",
    "file.search",
    "coder.read_file",
    "coder.list_dir",
    "coder.symbols",
    "coder.search",
    "coder.find_references",
    "coder.history",
    "coder.git_status",
    "coder.git_diff",
    "coder.patch_preview",
    "git.status",
    "git.log",
    "git.diff",
    "git.branch",
    "db.query",
    "db.tables",
    "web.fetch",
    "http.request",
    "note.list",
    "note.get",
    "note.search",
    "memory.recall",
    "memory.list",
    "memory.get_profile",
    "workflow.list",
    "workflow.get",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn destructive_and_sensitive_are_gated() {
        assert!(requires_approval("file.write"));
        assert!(requires_approval("file.read"));
        assert!(requires_approval("web.fetch"));
        assert!(requires_approval("shell.exec"));
    }

    #[test]
    fn benign_caps_are_not_gated() {
        assert!(!requires_approval("calc.eval"));
        assert!(!requires_approval("sys.time"));
        assert!(!requires_approval("note.create"));
    }

    #[test]
    fn unknown_caps_are_not_gated() {
        assert!(!requires_approval("totally.made_up"));
    }

    fn mcp_plugin_fixture(server_id: &str) -> crate::models::plugin::Plugin {
        use crate::models::plugin::{
            Capabilities, Plugin, PluginCategory, PluginState, PluginUiConfig, RuntimeConfig,
            RuntimeType, SandboxLevel, UiType,
        };
        Plugin {
            id: crate::mcp_client::plugin_id(server_id),
            name: server_id.to_string(),
            version: "0.0.0".to_string(),
            author: "MCP".to_string(),
            description: String::new(),
            capabilities: Capabilities::default(),
            runtime: RuntimeConfig {
                runtime_type: RuntimeType::Mcp,
                entry: String::new(),
                sandbox: SandboxLevel::Strict,
            },
            ui: PluginUiConfig {
                ui_type: UiType::None,
                entry: String::new(),
            },
            state: PluginState::Active,
            path: None,
            is_builtin: false,
            category: PluginCategory::System,
        }
    }

    /// Phase 8.5 minimum coverage: an MCP-sourced capability with no
    /// explicit allowlist entry must gate, by default, with no exceptions.
    #[test]
    fn mcp_capability_with_no_allowlist_entry_is_gated() {
        let plugin = mcp_plugin_fixture("weather");
        let config = crate::utils::config::AppConfig::default();
        assert!(requires_approval_for_call("mcp.weather.get_forecast", &plugin, &config));
    }

    #[test]
    fn mcp_capability_gated_even_if_it_would_look_benign_by_name() {
        // Unlike builtin caps, MCP tool names carry no hand-audited
        // classification at all — a name that reads as harmless must still
        // gate, because the server's actual behavior is opaque.
        let plugin = mcp_plugin_fixture("weather");
        let config = crate::utils::config::AppConfig::default();
        assert!(requires_approval_for_call("mcp.weather.get_time", &plugin, &config));
    }

    #[test]
    fn mcp_capability_explicitly_allowlisted_is_not_gated() {
        let plugin = mcp_plugin_fixture("weather");
        let mut config = crate::utils::config::AppConfig::default();
        let mut server = crate::utils::config::McpServerConfig::default();
        server.id = "weather".to_string();
        server
            .allowlisted_tools
            .insert("mcp.weather.get_forecast".to_string());
        config.mcp_servers.insert("weather".to_string(), server);

        assert!(!requires_approval_for_call(
            "mcp.weather.get_forecast",
            &plugin,
            &config
        ));
        // Allowlisting one tool must not blanket-allow the rest of the server.
        assert!(requires_approval_for_call(
            "mcp.weather.delete_everything",
            &plugin,
            &config
        ));
    }

    #[test]
    fn mcp_allowlist_is_scoped_per_server() {
        let plugin = mcp_plugin_fixture("weather");
        let mut config = crate::utils::config::AppConfig::default();
        let mut other_server = crate::utils::config::McpServerConfig::default();
        other_server.id = "other".to_string();
        other_server
            .allowlisted_tools
            .insert("mcp.weather.get_forecast".to_string());
        // Allowlist entry lives under the wrong server id — must not apply.
        config.mcp_servers.insert("other".to_string(), other_server);

        assert!(requires_approval_for_call(
            "mcp.weather.get_forecast",
            &plugin,
            &config
        ));
    }

    #[test]
    fn non_mcp_plugin_still_uses_static_classification() {
        use crate::models::plugin::{
            Capabilities, Plugin, PluginCategory, PluginState, PluginUiConfig, RuntimeConfig,
            RuntimeType, SandboxLevel, UiType,
        };
        let plugin = Plugin {
            id: "com.weave.builtin.file".to_string(),
            name: "File Manager".to_string(),
            version: "0.0.0".to_string(),
            author: "Weave".to_string(),
            description: String::new(),
            capabilities: Capabilities::default(),
            runtime: RuntimeConfig {
                runtime_type: RuntimeType::Builtin,
                entry: String::new(),
                sandbox: SandboxLevel::Strict,
            },
            ui: PluginUiConfig {
                ui_type: UiType::None,
                entry: String::new(),
            },
            state: PluginState::Active,
            path: None,
            is_builtin: true,
            category: PluginCategory::System,
        };
        let config = crate::utils::config::AppConfig::default();
        assert!(requires_approval_for_call("file.read", &plugin, &config));
        assert!(!requires_approval_for_call("calc.eval", &plugin, &config));
    }

    /// CI check: the frontend mirror (src/lib/capabilities.ts) must stay in
    /// exact lockstep with this backend source of truth. A drift in either
    /// direction fails the build — the mirror is display-only, but a
    /// frontend entry the backend does not gate (or a gate the UI does not
    /// show) is the same class of bug the original security fix closed.
    #[test]
    fn frontend_mirror_matches_backend_policy() {
        let manifest_dir =
            std::env::var("CARGO_MANIFEST_DIR").expect("cargo test sets CARGO_MANIFEST_DIR");
        let mirror_path = std::path::Path::new(&manifest_dir)
            .join("..")
            .join("src")
            .join("lib")
            .join("capabilities.ts");
        let content = std::fs::read_to_string(&mirror_path)
            .unwrap_or_else(|e| panic!("cannot read frontend mirror {}: {}", mirror_path.display(), e));

        fn extract_set(content: &str, name: &str) -> Vec<String> {
            let start = content
                .find(&format!("{}: ReadonlySet<string> = new Set([", name))
                .unwrap_or_else(|| panic!("cannot find {} in mirror", name));
            let rest = &content[start..];
            let end = rest.find("]);").unwrap_or_else(|| panic!("cannot find end of {}", name));
            let mut caps: Vec<String> = rest[..end]
                .split('\'')
                .filter(|t| t.contains('.'))
                .map(|t| t.to_string())
                .collect();
            caps.sort();
            caps
        }

        let mut expected_destructive: Vec<String> =
            DESTRUCTIVE_CAPS.iter().map(|s| s.to_string()).collect();
        expected_destructive.sort();
        let mut expected_sensitive: Vec<String> =
            SENSITIVE_CAPS.iter().map(|s| s.to_string()).collect();
        expected_sensitive.sort();

        assert_eq!(
            extract_set(&content, "DESTRUCTIVE_CAPS"),
            expected_destructive,
            "frontend DESTRUCTIVE_CAPS mirror drifted from capability_policy.rs"
        );
        assert_eq!(
            extract_set(&content, "SENSITIVE_CAPS"),
            expected_sensitive,
            "frontend SENSITIVE_CAPS mirror drifted from capability_policy.rs"
        );
    }
}
