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
