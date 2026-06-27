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
    pub local: LocalConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Openai,
    Anthropic,
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
            version: "0.1.0".to_string(),
            ai: AiConfig {
                default_provider: Provider::Openai,
                openai: ProviderConfig {
                    api_key: String::new(),
                    model: "gpt-4o-mini".to_string(),
                    api_url: None,
                    temperature: 0.7,
                    max_tokens: 4096,
                },
                anthropic: ProviderConfig {
                    api_key: String::new(),
                    model: "claude-sonnet-4-20250514".to_string(),
                    api_url: None,
                    temperature: 0.7,
                    max_tokens: 4096,
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
            let config: AppConfig = serde_json::from_str(&content)
                .map_err(|e| WeaveError::ConfigError(format!("Failed to parse config: {}", e)))?;
            Ok(config)
        } else {
            let config = AppConfig::default();
            config.save()?;
            Ok(config)
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
        if self.ai.openai.api_key.is_empty() && self.ai.anthropic.api_key.is_empty() && !self.ai.local.enabled {
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
