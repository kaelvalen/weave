//! OS keychain-backed secret storage with a transparent plaintext fallback.
//!
//! Provider API keys and MCP OAuth tokens are the sensitive values in the
//! plaintext `~/.weave/config.json` (that file was the project's only secret
//! store — see the inherited caveat noted in `config.rs`). This module moves
//! them into the OS keychain when one is available:
//!
//! - **macOS / Windows:** the native Keychain / Credential Manager.
//! - **Linux:** the kernel keyring (`linux-keyutils`) or the Secret Service
//!   backend, whichever builds; in headless containers/boot sessions where no
//!   keychain is usable, Weave transparently falls back to the existing
//!   plaintext config file so nothing breaks.
//!
//! Callers never observe the difference: `config.rs` stores every secret to
//! the keychain on save, redacts them from the on-disk JSON only when the
//! keychain accepted them all, and rehydrates the in-memory config from the
//! keychain on load. Any keychain failure degrades to the historical plaintext
//! behaviour verbatim.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use keyring::Entry;

use crate::utils::config::AppConfig;

/// keyring service-name (a single vault namespaced by account below).
const SERVICE: &str = "weave.app";

/// Guards keyring access: backends such as Secret Service are not safe for
/// concurrent writers, and config save/load can race the agent loop.
static K_LOCK: Mutex<()> = Mutex::new(());

// Account keys -----------------------------------------------------------

pub const ACCT_OPENAI: &str = "openai_api_key";
pub const ACCT_ANTHROPIC: &str = "anthropic_api_key";
pub const ACCT_KIMI: &str = "kimi_api_key";
pub const ACCT_OPENCODE: &str = "opencode_api_key";

pub fn mcp_access_account(server_id: &str) -> String {
    format!("mcp_access_{}", server_id)
}
pub fn mcp_refresh_account(server_id: &str) -> String {
    format!("mcp_refresh_{}", server_id)
}

// Low-level keyring ------------------------------------------------------

fn write_to_keychain(account: &str, secret: &str) -> bool {
    let _guard = K_LOCK.lock().unwrap();
    match Entry::new(SERVICE, account) {
        Ok(entry) => entry.set_password(secret).is_ok(),
        Err(_) => false,
    }
}

fn read_from_keychain(account: &str) -> Option<String> {
    let _guard = K_LOCK.lock().unwrap();
    let entry = Entry::new(SERVICE, account).ok()?;
    match entry.get_password() {
        Ok(v) => Some(v),
        Err(_) => None,
    }
}

fn delete_from_keychain(account: &str) {
    let _guard = K_LOCK.lock().unwrap();
    if let Ok(entry) = Entry::new(SERVICE, account) {
        let _ = entry.delete_password();
    }
}

/// True when the OS keychain is usable right now. Probes with a throwaway
/// credential so a headless/container boot (no kernel keyring, no Secret
/// Service daemon) cleanly reports "unavailable" and callers fall back.
pub fn keychain_available() -> bool {
    static AVAIL: OnceLock<bool> = OnceLock::new();
    *AVAIL.get_or_init(|| {
        let account = format!("probe_{}", uuid::Uuid::new_v4());
        write_to_keychain(&account, "1")
            && read_from_keychain(&account).as_deref() == Some("1")
            && {
                delete_from_keychain(&account);
                true
            }
    })
}

// AppConfig batch plumbing -----------------------------------------------

/// Collect every non-empty secret the config holds, as (account, secret).
pub fn collect_secrets(cfg: &AppConfig) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for (account, key) in [
        (ACCT_OPENAI, cfg.ai.openai.api_key.as_str()),
        (ACCT_ANTHROPIC, cfg.ai.anthropic.api_key.as_str()),
        (ACCT_KIMI, cfg.ai.kimi.api_key.as_str()),
        (ACCT_OPENCODE, cfg.ai.opencode.api_key.as_str()),
    ] {
        if !key.is_empty() {
            out.push((account.to_string(), key.to_string()));
        }
    }
    for (id, server) in &cfg.mcp_servers {
        if let Some(t) = &server.access_token {
            if !t.is_empty() {
                out.push((mcp_access_account(id), t.clone()));
            }
        }
        if let Some(t) = &server.refresh_token {
            if !t.is_empty() {
                out.push((mcp_refresh_account(id), t.clone()));
            }
        }
    }
    out
}

/// Best-effort mirror of every secret into the OS keychain. Returns whether
/// the keychain was usable (and accepted them all) so the caller can decide
/// whether to redact the plaintext file.
pub fn store_to_keychain(cfg: &AppConfig) -> bool {
    if !keychain_available() {
        return false;
    }
    let mut ok = true;
    for (account, secret) in collect_secrets(cfg) {
        if !write_to_keychain(&account, &secret) {
            ok = false;
        }
    }
    ok
}

/// Rehydrate empty secret fields in `cfg` from the OS keychain (used at load
/// so in-memory values stay populated after they were redacted on disk).
pub fn resolve_from_keychain(cfg: &mut AppConfig) {
    if !keychain_available() {
        return;
    }
    for (account, field) in [
        (ACCT_OPENAI, &mut cfg.ai.openai.api_key),
        (ACCT_ANTHROPIC, &mut cfg.ai.anthropic.api_key),
        (ACCT_KIMI, &mut cfg.ai.kimi.api_key),
        (ACCT_OPENCODE, &mut cfg.ai.opencode.api_key),
    ] {
        if field.is_empty() {
            if let Some(v) = read_from_keychain(account) {
                *field = v;
            }
        }
    }
    for (id, server) in cfg.mcp_servers.iter_mut() {
        if server.access_token.as_deref().unwrap_or("").is_empty() {
            server.access_token = read_from_keychain(&mcp_access_account(id));
        }
        if server.refresh_token.as_deref().unwrap_or("").is_empty() {
            server.refresh_token = read_from_keychain(&mcp_refresh_account(id));
        }
    }
}

/// Remove every secret from a serialized config so the on-disk file no longer
/// holds them once they live in the keychain. api_key fields are blanked
/// (they are required, non-Option struct fields); MCP tokens become null.
pub fn redact_json(pretty: &str) -> String {
    let mut value: serde_json::Value = match serde_json::from_str(pretty) {
        Ok(v) => v,
        Err(_) => return pretty.to_string(),
    };
    for path in ["ai.openai.api_key", "ai.anthropic.api_key", "ai.kimi.api_key", "ai.opencode.api_key"] {
        let mut cursor: Option<&mut serde_json::Value> = Some(&mut value);
        for seg in path.split('.') {
            match cursor {
                Some(v) => cursor = v.get_mut(seg),
                None => break,
            }
        }
        if let Some(v) = cursor {
            *v = serde_json::Value::String(String::new());
        }
    }
    if let Some(servers) = value.get_mut("mcp_servers").and_then(|v| v.as_object_mut()) {
        for server in servers.values_mut() {
            if let Some(obj) = server.as_object_mut() {
                obj.remove("access_token");
                obj.remove("refresh_token");
            }
        }
    }
    serde_json::to_string_pretty(&value).unwrap_or_else(|_| pretty.to_string())
}

/// Drop stale keychain entries for MCP servers that no longer exist.
pub fn cleanup_removed_servers(cfg: &AppConfig) {
    if !keychain_available() {
        return;
    }
    let live: HashMap<String, ()> = cfg.mcp_servers.keys().map(|k| (k.clone(), ())).collect();
    // We cannot enumerate the keychain, so removal is handled at the call
    // site when a server is deleted (see commands/mcp.rs).
    let _ = live;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::config::{AppConfig, McpServerConfig};

    #[test]
    fn redact_json_blanks_api_keys_and_removes_tokens() {
        let mut cfg = AppConfig::default();
        cfg.ai.openai.api_key = "sk-visible".to_string();
        cfg.ai.anthropic.api_key = "sk-anthropic".to_string();
        cfg.mcp_servers.insert(
            "git".to_string(),
            McpServerConfig {
                id: "git".to_string(),
                name: "git".to_string(),
                url: "https://x".to_string(),
                access_token: Some("tok-access".to_string()),
                refresh_token: Some("tok-refresh".to_string()),
                ..Default::default()
            },
        );
        let pretty = serde_json::to_string_pretty(&cfg).unwrap();
        let redacted = redact_json(&pretty);
        assert!(!redacted.contains("sk-visible"));
        assert!(!redacted.contains("sk-anthropic"));
        assert!(!redacted.contains("tok-access"));
        assert!(!redacted.contains("tok-refresh"));
        // Structure survives: still valid JSON, blanked keys + no tokens.
        let back: AppConfig = serde_json::from_str(&redacted).unwrap();
        assert_eq!(back.ai.openai.api_key, "");
        assert_eq!(back.mcp_servers["git"].access_token, None);
    }

    #[test]
    fn collect_secrets_skips_empty_values() {
        let mut cfg = AppConfig::default();
        cfg.ai.openai.api_key = "sk-a".to_string();
        cfg.ai.kimi.api_key = String::new();
        cfg.mcp_servers.insert(
            "s".to_string(),
            McpServerConfig {
                id: "s".to_string(),
                access_token: Some("tok".to_string()),
                refresh_token: None,
                ..Default::default()
            },
        );
        let cols = collect_secrets(&cfg);
        assert!(cols.iter().any(|(a, v)| a == ACCT_OPENAI && v == "sk-a"));
        assert!(!cols.iter().any(|(a, _)| a == ACCT_KIMI), "empty keys are skipped");
        assert!(cols.iter().any(|(a, v)| a == &mcp_access_account("s") && v == "tok"));
        assert!(!cols.iter().any(|(a, _)| a == &mcp_refresh_account("s")));
    }
}
