use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use super::errors::WeaveError;

pub const OLLAMA_DEFAULT_URL: &str = "http://localhost:11434";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub ai: AiConfig,
    pub plugins: PluginConfig,
    pub ui: UiConfig,
    pub version: String,
    /// MCP (2026-07-28) servers the user has added, keyed by server id.
    /// docs/phase8-mcp-spec.md Part 2 §5: extends this same plaintext
    /// AppConfig store rather than a new one — same pattern as the
    /// provider API keys above, same inherited caveat (no OS keychain).
    #[serde(default)]
    pub mcp_servers: HashMap<String, McpServerConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    pub default_provider: Provider,
    pub openai: ProviderConfig,
    pub anthropic: ProviderConfig,
    pub kimi: ProviderConfig,
    pub opencode: ProviderConfig,
    pub local: LocalConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Openai,
    Anthropic,
    Kimi,
    Opencode,
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub api_key: String,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_url: Option<String>,
    pub temperature: f64,
    pub max_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConfig {
    pub enabled: bool,
    pub model_path: String,
    pub model_alias: String,
    pub context_length: u32,
    pub temperature: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_url: Option<String>,
    /// Whether the local endpoint receives native `tools` in requests.
    ///
    /// Static flag, NOT a runtime auto-fallback: it is fixed per local
    /// endpoint/model after an empirical probe — phase1-spine-spec.md §2
    /// decision Q2. The 2026-08-11 probe confirmed streamed native tool calls
    /// for Qwen3.5-9B-Q4_K_M through both llama-server and Ollama 0.32.6;
    /// qwen2.5-coder-7b returned XML text instead, so models/templates without
    /// native support must set this to false. The Ollama/Qwen3.5 leg was
    /// re-verified on 2026-08-13 against Ollama 0.32.7 with a committed
    /// transcript (docs/probes/ollama-native-tools-2026-08-13/).
    #[serde(default = "default_use_native_tools")]
    pub use_native_tools: bool,
}

fn default_use_native_tools() -> bool {
    true
}

/// Per-server MCP config: connection + CIMD/OAuth state
/// (docs/phase8-mcp-spec.md Part 1 Q4 / Part 2 §5). `id`/`url`/`name` are
/// set on add; the discovery/token fields are populated once the server's
/// authorization flow completes (servers that don't require auth leave
/// them `None`). `allowlisted_tools` holds full capability ids
/// (`mcp.<server_id>.<tool_name>`) the user has explicitly opted out of
/// the default approval gate for — see capability_policy.rs.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub enabled: bool,
    /// Set when the server challenged 401 at add time (or never cleared
    /// after a completed authorization); drives the "Authorize" affordance
    /// in the Plugin Marketplace.
    #[serde(default)]
    pub auth_required: bool,
    #[serde(default)]
    pub allowlisted_tools: HashSet<String>,
    #[serde(default)]
    pub issuer: Option<String>,
    #[serde(default)]
    pub authorization_endpoint: Option<String>,
    #[serde(default)]
    pub token_endpoint: Option<String>,
    /// OAuth scopes advertised by the protected resource. The authorization
    /// URL requests these instead of inventing a provider-specific scope.
    #[serde(default)]
    pub oauth_scopes: Vec<String>,
    #[serde(default)]
    pub access_token: Option<String>,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub token_expires_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginConfig {
    pub directory: String,
    pub auto_discover: bool,
    #[serde(default)]
    pub sandbox_default: SandboxLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum SandboxLevel {
    #[default]
    Strict,
    Relaxed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiConfig {
    pub theme: ThemeMode,
    pub sidebar_collapsed: bool,
    pub font_size: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    System,
    Light,
    Dark,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: "0.2.0".to_string(),
            ai: AiConfig {
                default_provider: Provider::Openai,
                openai: ProviderConfig {
                    api_key: String::new(),
                    model: "gpt-4o-mini".to_string(),
                    api_url: None,
                    temperature: 0.7,
                    max_tokens: 16384,
                },
                anthropic: ProviderConfig {
                    api_key: String::new(),
                    model: "claude-sonnet-4-20250514".to_string(),
                    api_url: None,
                    temperature: 0.7,
                    max_tokens: 8192,
                },
                kimi: ProviderConfig {
                    api_key: String::new(),
                    model: "kimi-k2.6".to_string(),
                    api_url: Some("https://api.moonshot.cn/v1".to_string()),
                    temperature: 0.7,
                    max_tokens: 8192,
                },
                opencode: ProviderConfig {
                    api_key: String::new(),
                    model: "opencode-go/qwen3.6-plus".to_string(),
                    api_url: Some("https://opencode.ai/zen/go/v1".to_string()),
                    temperature: 0.7,
                    max_tokens: 8192,
                },
                local: LocalConfig {
                    enabled: false,
                    model_path: String::new(),
                    model_alias: "llama3".to_string(),
                    context_length: 4096,
                    temperature: 0.7,
                    api_url: Some(OLLAMA_DEFAULT_URL.to_string()),
                    use_native_tools: default_use_native_tools(),
                },
            },
            plugins: PluginConfig {
                directory: "~/.weave/plugins".to_string(),
                auto_discover: true,
                sandbox_default: SandboxLevel::Strict,
            },
            ui: UiConfig {
                theme: ThemeMode::System,
                sidebar_collapsed: false,
                font_size: 14,
            },
            mcp_servers: HashMap::new(),
        }
    }
}

impl AppConfig {
    pub fn load() -> Result<Self, WeaveError> {
        let config_path = Self::config_path()?;
        if config_path.exists() {
            let content = std::fs::read_to_string(&config_path)?;

            // Try normal deserialization first
            match serde_json::from_str::<AppConfig>(&content) {
                Ok(config) => Ok(config),
                Err(_) => {
                    // Migrate older config: parse as generic JSON and merge missing fields with defaults
                    let mut value: serde_json::Value =
                        serde_json::from_str(&content).map_err(|e| {
                            WeaveError::ConfigError(format!("Failed to parse config: {}", e))
                        })?;
                    let default = serde_json::to_value(AppConfig::default())
                        .map_err(|e| WeaveError::Serialization(e.to_string()))?;

                    Self::merge_missing(&mut value, &default);

                    let config: AppConfig = serde_json::from_value(value).map_err(|e| {
                        WeaveError::ConfigError(format!("Failed to migrate config: {}", e))
                    })?;
                    config.save()?;
                    Ok(config)
                }
            }
        } else {
            let config = AppConfig::default();
            config.save()?;
            Ok(config)
        }
    }

    fn merge_missing(target: &mut serde_json::Value, source: &serde_json::Value) {
        if let (Some(target_map), Some(source_map)) = (target.as_object_mut(), source.as_object()) {
            for (key, source_value) in source_map {
                match target_map.get_mut(key) {
                    Some(target_value) => Self::merge_missing(target_value, source_value),
                    None => {
                        target_map.insert(key.clone(), source_value.clone());
                    }
                }
            }
        }
    }

    pub fn save(&self) -> Result<(), WeaveError> {
        let config_path = Self::config_path()?;
        if let Some(parent) = config_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let content = serde_json::to_string_pretty(self)
            .map_err(|e| WeaveError::Serialization(e.to_string()))?;
        std::fs::write(config_path, content)?;
        Ok(())
    }

    pub fn config_path() -> Result<PathBuf, WeaveError> {
        let home = dirs::home_dir()
            .ok_or_else(|| WeaveError::ConfigError("Cannot find home directory".to_string()))?;
        Ok(home.join(".weave").join("config.json"))
    }

    pub fn app_data_dir() -> Result<PathBuf, WeaveError> {
        let home = dirs::home_dir()
            .ok_or_else(|| WeaveError::ConfigError("Cannot find home directory".to_string()))?;
        let dir = home.join(".weave");
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }

    pub fn plugin_dir() -> Result<PathBuf, WeaveError> {
        let home = dirs::home_dir()
            .ok_or_else(|| WeaveError::ConfigError("Cannot find home directory".to_string()))?;
        let dir = home.join(".weave").join("plugins");
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }

    pub fn notes_dir() -> Result<PathBuf, WeaveError> {
        let home = dirs::home_dir()
            .ok_or_else(|| WeaveError::ConfigError("Cannot find home directory".to_string()))?;
        let dir = home.join(".weave").join("notes");
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }

    pub fn workflows_dir() -> Result<PathBuf, WeaveError> {
        let home = dirs::home_dir()
            .ok_or_else(|| WeaveError::ConfigError("Cannot find home directory".to_string()))?;
        let dir = home.join(".weave").join("workflows");
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }

    pub fn validate(&self) -> Result<(), WeaveError> {
        if self.ai.openai.api_key.is_empty()
            && self.ai.anthropic.api_key.is_empty()
            && self.ai.kimi.api_key.is_empty()
            && self.ai.opencode.api_key.is_empty()
            && !self.ai.local.enabled
        {
            return Err(WeaveError::ConfigError(
                "At least one AI provider must be configured".to_string(),
            ));
        }
        if self.ui.font_size < 8 || self.ui.font_size > 32 {
            return Err(WeaveError::ConfigError(
                "Font size must be between 8 and 32".to_string(),
            ));
        }
        Ok(())
    }
}
