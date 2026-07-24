use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;
use tracing::{info, warn};

use plugin_runtime::plugin_manager::PluginManager;
use crate::models::plugin::Plugin;
use crate::utils::errors::WeaveError;

const GITHUB_API_BASE: &str = "https://api.github.com";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubRepo {
    pub name: String,
    pub full_name: String,
    pub description: Option<String>,
    pub html_url: String,
    pub default_branch: String,
    pub has_releases: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubRelease {
    #[allow(dead_code)]
    tag_name: String,
    assets: Vec<GithubReleaseAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubReleaseAsset {
    name: String,
    browser_download_url: String,
}

/// Client for discovering and installing plugins from GitHub.
pub struct GithubPluginClient;

impl GithubPluginClient {
    pub fn new() -> Self {
        Self
    }

    /// List public repositories for a GitHub organization.
    pub async fn list_org_repos(&self, org: &str) -> Result<Vec<GithubRepo>, WeaveError> {
        let url = format!("{}/orgs/{}/repos?per_page=100", GITHUB_API_BASE, org);
        let client = Self::http_client()?;
        let response = client.get(&url).send().await?;

        if !response.status().is_success() {
            return Err(WeaveError::Http(format!(
                "GitHub API returned {}: {}",
                response.status(),
                response.text().await.unwrap_or_default()
            )));
        }

        let repos: Vec<serde_json::Value> = response.json().await?;
        let mut result = Vec::new();

        for repo in repos {
            let name = repo
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let full_name = repo
                .get("full_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            if name.is_empty() || full_name.is_empty() {
                continue;
            }

            let html_url = repo
                .get("html_url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let default_branch = repo
                .get("default_branch")
                .and_then(|v| v.as_str())
                .unwrap_or("main")
                .to_string();
            let description = repo
                .get("description")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let has_releases = Self::repo_has_releases(&full_name).await.unwrap_or(false);

            result.push(GithubRepo {
                name,
                full_name,
                description,
                html_url,
                default_branch,
                has_releases,
            });
        }

        Ok(result)
    }

    /// Clone a GitHub repository into the plugin directory and discover it.
    pub async fn install_from_repo(
        &self,
        plugin_manager: &PluginManager,
        repo_url: &str,
    ) -> Result<Vec<Plugin>, WeaveError> {
        let (_, repo_name) = parse_github_url(repo_url)?;
        let plugin_dir = crate::utils::config::AppConfig::plugin_dir()?;
        let dest = plugin_dir.join(&repo_name);

        if dest.exists() {
            return Err(WeaveError::PluginError(format!(
                "Plugin directory already exists: {:?}. Remove it first or update instead.",
                dest
            )));
        }

        ensure_git_available()?;

        let output = Command::new("git")
            .args(["clone", "--depth", "1", repo_url, dest.to_string_lossy().as_ref()])
            .output()?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(WeaveError::PluginError(format!(
                "Git clone failed: {}",
                stderr
            )));
        }

        info!("Cloned plugin repo from {} to {:?}", repo_url, dest);
        plugin_manager.discover()
    }

    /// Download a `.wpk` asset from a GitHub release and discover it.
    pub async fn install_from_release(
        &self,
        plugin_manager: &PluginManager,
        repo_url: &str,
        tag: Option<&str>,
        asset_name: Option<&str>,
    ) -> Result<Vec<Plugin>, WeaveError> {
        let (owner, repo) = parse_github_url(repo_url)?;
        let release = self.fetch_release(&owner, &repo, tag).await?;

        let asset = if let Some(name) = asset_name {
            release
                .assets
                .iter()
                .find(|a| a.name == name)
                .ok_or_else(|| {
                    WeaveError::PluginError(format!("Release asset '{}' not found", name))
                })?
        } else {
            release
                .assets
                .iter()
                .find(|a| a.name.ends_with(".wpk"))
                .ok_or_else(|| {
                    WeaveError::PluginError("No .wpk asset found in release".to_string())
                })?
        };

        let plugin_dir = crate::utils::config::AppConfig::plugin_dir()?;
        let dest = plugin_dir.join(&asset.name);

        self.download_file(&asset.browser_download_url, &dest).await?;
        info!(
            "Downloaded release asset from {} to {:?}",
            asset.browser_download_url, dest
        );

        plugin_manager.discover()
    }

    async fn repo_has_releases(full_name: &str) -> Result<bool, WeaveError> {
        let url = format!("{}/repos/{}/releases", GITHUB_API_BASE, full_name);
        let client = Self::http_client()?;
        let response = match client.get(&url).send().await {
            Ok(r) => r,
            Err(e) => {
                warn!("Failed to check releases for {}: {}", full_name, e);
                return Ok(false);
            }
        };

        if !response.status().is_success() {
            return Ok(false);
        }

        let releases: Vec<serde_json::Value> = response.json().await?;
        Ok(!releases.is_empty())
    }

    async fn fetch_release(
        &self,
        owner: &str,
        repo: &str,
        tag: Option<&str>,
    ) -> Result<GithubRelease, WeaveError> {
        let url = match tag {
            Some(t) => format!(
                "{}/repos/{}/{}/releases/tags/{}",
                GITHUB_API_BASE, owner, repo, t
            ),
            None => format!(
                "{}/repos/{}/{}/releases/latest",
                GITHUB_API_BASE, owner, repo
            ),
        };

        let client = Self::http_client()?;
        let response = client.get(&url).send().await?;

        if !response.status().is_success() {
            return Err(WeaveError::Http(format!(
                "GitHub API returned {}: {}",
                response.status(),
                response.text().await.unwrap_or_default()
            )));
        }

        Ok(response.json().await?)
    }

    async fn download_file(&self, url: &str, dest: &PathBuf) -> Result<(), WeaveError> {
        let client = reqwest::Client::builder()
            .timeout(DOWNLOAD_TIMEOUT)
            .user_agent("Weave-Plugin-Marketplace")
            .build()?;

        let response = client.get(url).send().await?;
        if !response.status().is_success() {
            return Err(WeaveError::Http(format!(
                "Download failed with status {}",
                response.status()
            )));
        }

        let bytes = response.bytes().await?;
        std::fs::write(dest, bytes)?;
        Ok(())
    }

    fn http_client() -> Result<reqwest::Client, WeaveError> {
        Ok(reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .user_agent("Weave-Plugin-Marketplace")
            .build()?)
    }
}

impl Default for GithubPluginClient {
    fn default() -> Self {
        Self::new()
    }
}

fn parse_github_url(url: &str) -> Result<(String, String), WeaveError> {
    let trimmed = url
        .trim_end_matches('/')
        .trim_end_matches(".git")
        .replace("https://", "")
        .replace("http://", "")
        .replace("github.com/", "");

    let parts: Vec<&str> = trimmed.split('/').collect();
    if parts.len() < 2 {
        return Err(WeaveError::PluginError(format!(
            "Invalid GitHub URL: {}",
            url
        )));
    }

    let owner = parts[parts.len() - 2].to_string();
    let repo = parts[parts.len() - 1].to_string();

    if owner.is_empty() || repo.is_empty() || owner.contains(':') || repo.contains(':') {
        return Err(WeaveError::PluginError(format!(
            "Invalid GitHub URL: {}",
            url
        )));
    }

    Ok((owner, repo))
}

fn ensure_git_available() -> Result<(), WeaveError> {
    match Command::new("git").arg("--version").output() {
        Ok(output) if output.status.success() => Ok(()),
        _ => Err(WeaveError::PluginError(
            "Git is not installed or not available in PATH".to_string(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_github_url_https() {
        let (owner, repo) =
            parse_github_url("https://github.com/weave-plugins/math-genius").unwrap();
        assert_eq!(owner, "weave-plugins");
        assert_eq!(repo, "math-genius");
    }

    #[test]
    fn test_parse_github_url_with_git_suffix() {
        let (owner, repo) =
            parse_github_url("https://github.com/weave-plugins/math-genius.git").unwrap();
        assert_eq!(owner, "weave-plugins");
        assert_eq!(repo, "math-genius");
    }

    #[test]
    fn test_parse_github_url_invalid() {
        assert!(parse_github_url("not-a-url").is_err());
    }
}
