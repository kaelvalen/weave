use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use super::errors::WeaveError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub ai: AiConfig,
    pub plugins: PluginConfig,
    pub ui: UiConfig,
    pub version: String,
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
                    model: "opencode-go".to_string(),
                    api_url: Some("https://opencode.ai/zen/v1".to_string()),
                    temperature: 0.7,
                    max_tokens: 8192,
                },
                local: LocalConfig {
                    enabled: false,
                    model_path: String::new(),
                    model_alias: "llama3".to_string(),
                    context_length: 4096,
                    temperature: 0.7,
                    api_url: Some("http://localhost:11434".to_string()),
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
                    let mut value: serde_json::Value = serde_json::from_str(&content)
                        .map_err(|e| WeaveError::ConfigError(format!("Failed to parse config: {}", e)))?;
                    let default = serde_json::to_value(AppConfig::default())
                        .map_err(|e| WeaveError::Serialization(e.to_string()))?;

                    Self::merge_missing(&mut value, &default);

                    let config: AppConfig = serde_json::from_value(value)
                        .map_err(|e| WeaveError::ConfigError(format!("Failed to migrate config: {}", e)))?;
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

    pub fn validate(&self) -> Result<(), WeaveError> {
        if self.ai.openai.api_key.is_empty()
            && self.ai.anthropic.api_key.is_empty()
            && self.ai.kimi.api_key.is_empty()
            && self.ai.opencode.api_key.is_empty()
            && !self.ai.local.enabled
        {
            return Err(WeaveError::ConfigError(
                "At least one AI provider must be configured".to_string()
            ));
        }
        if self.ui.font_size < 8 || self.ui.font_size > 32 {
            return Err(WeaveError::ConfigError(
                "Font size must be between 8 and 32".to_string()
            ));
        }
        Ok(())
    }
}
