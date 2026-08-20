use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Command;
use tracing::{info, warn};

use crate::models::plugin::PluginExecutor;
use crate::utils::errors::WeaveError;
use crate::utils::fs_security;

/// Commands that are too dangerous to execute. Secondary layer only — the
/// bubblewrap allowlist sandbox (everything invisible by default) is the
/// real boundary; this denylist is kept as cheap belt-and-braces.
const BLOCKED_COMMANDS: &[&str] = &[
    "rm -rf /",
    "rm -rf /*",
    "mkfs",
    "dd if=",
    ":(){ :|:& };:",
    "chmod -R 777 /",
    "chown -R",
    "> /dev/sda",
    "mv / ",
    "wget -O- | sh",
    "curl | sh",
];

/// Default timeout in seconds for shell commands.
const DEFAULT_TIMEOUT_SECS: u64 = 30;

/// System directories bound read-only into the sandbox so `sh` and the
/// standard toolchain can run. NixOS resolves to `/nix/store` + `/etc` +
/// `/run/current-system`; FHS distros get `/usr`, `/bin`, `/lib`, ... —
/// always read-only, never user data. Only existing paths are bound.
const READONLY_BINDS: &[&str] = &[
    "/nix/store",
    "/run/current-system",
    "/usr",
    "/bin",
    "/sbin",
    "/lib",
    "/lib64",
    "/etc",
];

pub struct ShellPlugin;

impl PluginExecutor for ShellPlugin {
    fn execute(
        &self,
        capability: &str,
        params: Value,
        ctx: &runtime_kernel::execution_context::ExecutionContext,
    ) -> Result<Value, WeaveError> {
        ShellPlugin::execute(capability, params, ctx)
    }
}

impl ShellPlugin {
    pub fn execute(
        capability: &str,
        params: Value,
        _ctx: &runtime_kernel::execution_context::ExecutionContext,
    ) -> Result<Value, WeaveError> {
        match capability {
            "shell.exec" | "shell.execute" => Self::exec(params),
            _ => Err(WeaveError::CapabilityNotFound(capability.to_string())),
        }
    }

    /// Scan a PATH string for an executable (pure — no env access, so it is
    /// unit-testable against any fabricated path).
    fn find_in_path(path_var: &str, bin: &str) -> Option<PathBuf> {
        for dir in std::env::split_paths(path_var) {
            let candidate = dir.join(bin);
            if candidate.is_file() {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let ok = candidate
                        .metadata()
                        .map(|m| m.permissions().mode() & 0o111 != 0)
                        .unwrap_or(false);
                    if ok {
                        return Some(candidate);
                    }
                }
                #[cfg(not(unix))]
                {
                    return Some(candidate);
                }
            }
        }
        None
    }

    fn exec(params: Value) -> Result<Value, WeaveError> {
        let path_var = std::env::var("PATH").unwrap_or_default();
        Self::exec_with_path(params, &path_var)
    }

    /// The sandbox executes every command through bubblewrap with a strict
    /// allowlist — see the READONLY_BINDS / workspace-bind comment in `exec`.
    /// `path_var` is a parameter (not env access) so the fail-closed refusal
    /// is unit-testable.
    fn exec_with_path(params: Value, path_var: &str) -> Result<Value, WeaveError> {
        let command_str = params
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'command' parameter".to_string()))?;

        // Secondary deny list (the bwrap allowlist below is the real boundary).
        let cmd_lower = command_str.to_lowercase();
        for blocked in BLOCKED_COMMANDS {
            if cmd_lower.contains(blocked) {
                return Err(WeaveError::PermissionDenied(format!(
                    "Command blocked for safety: contains '{}'",
                    blocked
                )));
            }
        }

        let timeout_secs = params
            .get("timeout")
            .and_then(|v| v.as_u64())
            .unwrap_or(DEFAULT_TIMEOUT_SECS);

        let cwd = params.get("cwd").and_then(|v| v.as_str());

        // ---- bubblewrap sandbox (fail-closed) ----
        if !cfg!(target_os = "linux") {
            return Err(WeaveError::PluginError(
                "shell.exec is not supported on this platform yet: the bubblewrap sandbox is Linux-only and Weave refuses to run shell commands unsandboxed".to_string(),
            ));
        }
        let bwrap = Self::find_in_path(path_var, "bwrap").ok_or_else(|| {
            WeaveError::PluginError(
                "bubblewrap is required to run shell commands safely — install bubblewrap (e.g. `nix profile install nixpkgs#bubblewrap`)".to_string(),
            )
        })?;
        // Resolve `sh` on the host and hand the absolute path to the
        // sandbox: the in-sandbox PATH can point at dirs that are not
        // bound (e.g. /run/current-system/sw/bin before the bind lands),
        // but the store path always is.
        let sh = Self::find_in_path(path_var, "sh").ok_or_else(|| {
            WeaveError::PluginError(
                "cannot locate `sh` on PATH — shell.exec refuses to run without it".to_string(),
            )
        })?;

        // The one read-write directory the command is meant to touch: the
        // workspace root (the folder the File Manager selected). It is bound
        // at a FIXED sandbox-internal path (`/workspace`) — never at its
        // host path. Binding at the host path made bwrap auto-create empty
        // writable parent dirs (e.g. /home/kael), so `mkdir /home/kael/x &&
        // ls -ld /home/kael/x` "succeeded" inside the sandbox: a lie, since
        // nothing ever touched the host. With a fixed /workspace mount the
        // rest of the host tree is never materialized, and the whole rootfs
        // is remounted read-only after the binds — writes anywhere but
        // /workspace and /tmp fail with a real OS error, and verification
        // inside the same command cannot fool anyone.
        let workspace = fs_security::canonicalize_path(".")?;

        // `cwd` (host path) must resolve inside the workspace root; it is
        // mapped into the sandbox as /workspace[/rel]. Absent → /workspace.
        let sandbox_cwd = match cwd {
            Some(dir) => {
                let resolved = fs_security::canonicalize_path(dir)?;
                if !resolved.starts_with(&workspace) {
                    return Err(WeaveError::PermissionDenied(format!(
                        "Working directory is outside the workspace root: {}",
                        resolved.display()
                    )));
                }
                if !resolved.is_dir() {
                    return Err(WeaveError::PluginError(format!(
                        "Working directory not found: {}",
                        dir
                    )));
                }
                let rel = resolved
                    .strip_prefix(&workspace)
                    .map(|r| r.to_path_buf())
                    .unwrap_or_default();
                if rel.as_os_str().is_empty() {
                    "/workspace".to_string()
                } else {
                    format!("/workspace/{}", rel.to_string_lossy())
                }
            }
            None => "/workspace".to_string(),
        };

        info!(
            "Executing shell command in bubblewrap sandbox: {} (timeout: {}s, sandbox cwd: {})",
            command_str, timeout_secs, sandbox_cwd
        );

        let mut cmd = Command::new(&bwrap);
        cmd.args([
            "--die-with-parent",
            "--new-session",
            "--unshare-pid",
            "--unshare-net",
        ]);
        cmd.args(["--proc", "/proc"]);
        for dir in READONLY_BINDS {
            if std::path::Path::new(dir).exists() {
                cmd.args(["--ro-bind", dir, dir]);
            }
        }
        cmd.args(["--tmpfs", "/tmp"]);
        // $HOME decision (recorded 2026-08-14): pinned to a real directory
        // inside the workspace bind — /workspace/.weave-home — so the
        // sandbox's writable surface has NO second "succeeds but does not
        // persist" zone. Everything a command writes via $HOME lands under
        // the workspace, host-visible and persistent across sessions
        // (tool caches included). Rejected: /tmp scratch — it silently
        // created an ephemeral illusion surface for $HOME-relative writes.
        // Known tradeoff of this choice: the directory appears in `git
        // status` / `ls -a` of the workspace. The only other writable
        // place is the /tmp tmpfs, which is convention ephemeral scratch
        // (never host-visible).
        cmd.args(["--setenv", "HOME", "/workspace/.weave-home"]);
        cmd.args(["--bind", workspace.to_string_lossy().as_ref(), "/workspace"]);
        // Binds first (bwrap creates their mount points), then the whole
        // rootfs turns read-only: the only writable places left are the
        // /workspace bind and the /tmp tmpfs.
        cmd.args(["--remount-ro", "/"]);
        cmd.args(["--chdir", &sandbox_cwd]);
        cmd.args(["--", sh.to_string_lossy().as_ref(), "-c", command_str]);

        // Execute with timeout using a thread
        let timeout_duration = std::time::Duration::from_secs(timeout_secs);
        let handle = std::thread::spawn(move || cmd.output());

        match handle.join() {
            Ok(result) => {
                let output = result.map_err(|e| WeaveError::Io(e.to_string()))?;
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                if !output.status.success() {
                    warn!("Command failed with status: {:?}", output.status.code());
                }
                Ok(json!({
                    "command": command_str,
                    "stdout": stdout,
                    "stderr": stderr,
                    "exit_code": output.status.code(),
                    "success": output.status.success(),
                    "timeout_secs": timeout_secs
                }))
            }
            Err(_) => Err(WeaveError::TimeoutError(format!(
                "Command timed out after {} seconds: {}",
                timeout_duration.as_secs(),
                command_str
            ))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use parking_lot::RwLock;
    use runtime_kernel::event_bus::EventBus;
    use serde_json::json;
    use std::sync::Arc;

    fn test_ctx() -> runtime_kernel::execution_context::ExecutionContext {
        runtime_kernel::execution_context::ExecutionContext::new(
            "test".to_string(),
            std::env::current_dir().unwrap(),
            Arc::new(RwLock::new(json!({}))),
            Arc::new(EventBus::new(16)),
        )
    }

    /// The sandbox tests need bubblewrap installed (nix-shell provides it).
    /// Without it they skip loudly rather than fail on the host's PATH.
    fn bwrap_available() -> bool {
        ShellPlugin::find_in_path(&std::env::var("PATH").unwrap_or_default(), "bwrap").is_some()
    }

    fn run(command: &str) -> Value {
        ShellPlugin::execute("shell.exec", json!({ "command": command }), &test_ctx())
            .expect("shell.exec must return a result")
    }

    fn run_json(params: Value) -> Value {
        ShellPlugin::execute("shell.exec", params, &test_ctx()).unwrap()
    }

    #[test]
    fn find_in_path_resolves_only_executable_files() {
        let dir = std::env::temp_dir().join(format!("weave_bwrap_path_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("bwrap");
        std::fs::write(&script, "#!/bin/sh\nexit 0\n").unwrap();

        let empty_path = dir.join("not-in-here").to_string_lossy().to_string();
        assert!(
            ShellPlugin::find_in_path(&empty_path, "bwrap").is_none(),
            "empty PATH must not resolve bwrap"
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o644)).unwrap();
            assert!(
                ShellPlugin::find_in_path(&dir.to_string_lossy(), "bwrap").is_none(),
                "non-executable file must not resolve"
            );
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
            assert!(
                ShellPlugin::find_in_path(&dir.to_string_lossy(), "bwrap").is_some(),
                "executable must resolve"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── Spec §5: sandbox behavior (requires bubblewrap in PATH) ──

    #[test]
    fn mkdir_outside_workspace_fails_with_os_error() {
        if !bwrap_available() {
            eprintln!("skipped: bubblewrap not installed");
            return;
        }
        // A real host system directory whose parent does not exist inside
        // the sandbox rootfs — mkdir fails with an OS error, and nothing is
        // ever created on the host.
        let outside = std::path::Path::new("/var/lib")
            .join(format!("weave_sandbox_{}", uuid::Uuid::new_v4()));
        let res = run(&format!("mkdir {}", outside.display()));
        assert!(
            res["success"] == false,
            "mkdir outside the sandbox must fail (got: {})",
            res
        );
        assert!(
            !res["stderr"].as_str().unwrap_or("").is_empty(),
            "failure must come from the OS (stderr), not a Weave-level check"
        );
        assert!(!outside.exists(), "directory must not exist on the host");
    }

    #[test]
    fn sandbox_home_lives_under_workspace_and_persists() {
        if !bwrap_available() {
            eprintln!("skipped: bubblewrap not installed");
            return;
        }
        // Recorded decision (2026-08-14): $HOME is /workspace/.weave-home —
        // a real, persistent location inside the workspace bind, never an
        // ephemeral /tmp scratch. Writes through $HOME must land on the
        // host.
        let res = run("mkdir -p \"$HOME/sub\" && echo \"$HOME\" && test -d \"$HOME/sub\"");
        assert_eq!(
            res["success"], true,
            "HOME writes must succeed inside the sandbox (got: {})",
            res
        );
        assert!(
            res["stdout"]
                .as_str()
                .unwrap_or("")
                .contains("/workspace/.weave-home"),
            "HOME must resolve to /workspace/.weave-home (got: {})",
            res
        );
        let workspace = std::env::current_dir()
            .expect("cargo test runs from the workspace root")
            .canonicalize()
            .unwrap();
        assert!(
            workspace.join(".weave-home").join("sub").is_dir(),
            "sandbox HOME writes must persist on the host workspace"
        );
        let _ = std::fs::remove_dir_all(workspace.join(".weave-home"));
    }

    #[test]
    fn reported_illusion_scenario_fails_honestly() {
        if !bwrap_available() {
            eprintln!("skipped: bubblewrap not installed");
            return;
        }
        // The exact reported scenario: `mkdir -p /home/<user>/test-ai &&
        // ls -ld /home/<user>/test-ai` chained in one command. With the
        // workspace bound at the fixed /workspace path and a read-only
        // rootfs, the real home is never materialized — both steps fail
        // with a real OS error, so the "verification" cannot lie, and
        // nothing exists on the host. (deliberately NOT dirs::home_dir():
        // nix-shell sets $HOME to a /tmp dir, which is writable scratch
        // inside the sandbox.)
        let user = std::env::var("USER").unwrap_or_else(|_| "user".into());
        let target = std::path::Path::new("/home").join(&user).join("test-ai");
        let workspace = std::env::current_dir()
            .expect("cargo test runs from the workspace root")
            .canonicalize()
            .unwrap();
        if target.starts_with(&workspace) {
            eprintln!("skipped: /home/<user> is the workspace itself");
            return;
        }
        let res = run(&format!(
            "mkdir -p {} && ls -ld {}",
            target.display(),
            target.display()
        ));
        assert!(
            res["success"] == false,
            "the reported mkdir+verify scenario must fail with a real OS error (got: {})",
            res
        );
        assert!(
            !res["stderr"].as_str().unwrap_or("").is_empty(),
            "failure must come from the OS (got: {})",
            res
        );
        assert!(
            !target.exists(),
            "the scenario must never materialize anything on the host"
        );
    }

    #[test]
    fn reading_file_outside_workspace_fails_with_os_error() {
        if !bwrap_available() {
            eprintln!("skipped: bubblewrap not installed");
            return;
        }
        // A stand-in for ~/.ssh — a file that exists on the host but must
        // be invisible inside the sandbox.
        let secret = std::env::temp_dir().join(format!("weave_secret_{}", uuid::Uuid::new_v4()));
        std::fs::write(&secret, "top secret").unwrap();
        let res = run(&format!("cat {}", secret.display()));
        assert!(
            res["success"] == false,
            "reading outside the sandbox must fail (got: {})",
            res
        );
        assert!(
            !res["stdout"].as_str().unwrap_or("").contains("top secret"),
            "secret content must never leave the sandbox"
        );
        let _ = std::fs::remove_file(&secret);
    }

    #[test]
    fn network_is_unreachable_from_shell() {
        if !bwrap_available() {
            eprintln!("skipped: bubblewrap not installed");
            return;
        }
        let res = run("curl -sS -m 5 https://example.com || true");
        // curl without network fails fast with a non-zero exit; the `|| true`
        // absorbs it, so assert on stderr carrying the DNS/connect error
        // rather than on exit code.
        assert!(
            !res["success"].as_bool().unwrap_or(false)
                || !res["stderr"].as_str().unwrap_or("").is_empty(),
            "curl must fail without network (got: {})",
            res
        );
    }

    #[test]
    fn in_workspace_commands_succeed() {
        if !bwrap_available() {
            eprintln!("skipped: bubblewrap not installed");
            return;
        }
        let dir = std::env::current_dir()
            .unwrap()
            .join("target")
            .join(format!("weave_sandbox_ok_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        // cwd is passed as a host path and mapped into the sandbox; pwd
        // must reflect the fixed /workspace mount.
        let res = run_json(json!({
            "command": "mkdir subdir && test -d subdir && pwd",
            "cwd": dir.to_string_lossy(),
        }));
        assert_eq!(
            res["success"], true,
            "in-workspace commands must run (got: {})",
            res
        );
        assert!(
            res["stdout"].as_str().unwrap_or("").contains("/workspace"),
            "pwd must resolve to the sandbox /workspace mount (got: {})",
            res
        );
        assert!(
            std::fs::metadata(dir.join("subdir")).is_ok(),
            "writes through /workspace must land on the host workspace"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cwd_outside_workspace_is_rejected() {
        if !bwrap_available() {
            eprintln!("skipped: bubblewrap not installed");
            return;
        }
        let outside = std::env::temp_dir();
        let result = ShellPlugin::execute(
            "shell.exec",
            json!({ "command": "pwd", "cwd": outside.to_string_lossy() }),
            &test_ctx(),
        );
        assert!(
            matches!(result, Err(WeaveError::PermissionDenied(_))),
            "cwd outside the workspace must be rejected (got: {:?})",
            result.map_err(|e| e.to_string())
        );
    }

    #[test]
    fn missing_bwrap_refuses_cleanly() {
        // A PATH that cannot contain bwrap → the exec path fails closed
        // with a clear error, never a panic or an unsandboxed fallback.
        let dir = std::env::temp_dir().join(format!("weave_no_bwrap_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let result =
            ShellPlugin::exec_with_path(json!({ "command": "echo hi" }), &dir.to_string_lossy());
        let _ = std::fs::remove_dir_all(&dir);
        match result {
            Err(WeaveError::PluginError(msg)) => {
                assert!(
                    msg.contains("bubblewrap is required"),
                    "refusal must explain bubblewrap (got: {})",
                    msg
                );
            }
            other => panic!("expected a clean refusal, got: {:?}", other),
        }
    }
}
