use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PolicyDecision {
    Allow,
    RequiresConfirmation { reason: String },
    Deny { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityPolicy {
    pub allowed_workspace_roots: Vec<std::path::PathBuf>,
    pub read_only_mode: bool,
    pub command_allowlist: Vec<String>,
    pub command_blocklist: Vec<String>,
    pub allowed_network_domains: Vec<String>,
    pub max_task_budget_usd: f64,
}

impl Default for SecurityPolicy {
    fn default() -> Self {
        Self {
            allowed_workspace_roots: vec![],
            read_only_mode: false,
            command_allowlist: vec![
                "git".into(),
                "cargo".into(),
                "python".into(),
                "python3".into(),
                "node".into(),
                "npm".into(),
                "npx".into(),
                "ls".into(),
                "pwd".into(),
                "echo".into(),
                "cat".into(),
                "grep".into(),
                "find".into(),
            ],
            command_blocklist: vec![
                "sudo".into(),
                "rm -rf /".into(),
                "mkfs".into(),
                "dd".into(),
                ":(){ :|:& };:".into(),
            ],
            allowed_network_domains: vec!["*".into()],
            max_task_budget_usd: 5.0,
        }
    }
}

pub struct PolicyEngine {
    policy: SecurityPolicy,
}

impl PolicyEngine {
    pub fn new(policy: SecurityPolicy) -> Self {
        Self { policy }
    }

    pub fn default_engine() -> Self {
        Self::new(SecurityPolicy::default())
    }

    pub fn check_path_access(&self, target_path: &Path, is_write: bool) -> PolicyDecision {
        if self.policy.read_only_mode && is_write {
            return PolicyDecision::Deny {
                reason: "System is operating in Read-Only mode".into(),
            };
        }

        let path_str = target_path.to_string_lossy();
        if path_str.contains("/..") || path_str.contains("../") {
            return PolicyDecision::Deny {
                reason: "Path traversal attempt detected".into(),
            };
        }

        PolicyDecision::Allow
    }

    pub fn check_command_execution(&self, command: &str) -> PolicyDecision {
        let trimmed = command.trim();

        for blocked in &self.policy.command_blocklist {
            if trimmed.contains(blocked) {
                return PolicyDecision::Deny {
                    reason: format!("Command contains prohibited pattern: '{}'", blocked),
                };
            }
        }

        let first_word = trimmed.split_whitespace().next().unwrap_or("");
        if self
            .policy
            .command_allowlist
            .iter()
            .any(|cmd| cmd == first_word)
        {
            PolicyDecision::Allow
        } else {
            PolicyDecision::RequiresConfirmation {
                reason: format!(
                    "Command '{}' is not in the automatic execution allowlist",
                    first_word
                ),
            }
        }
    }

    pub fn check_network_domain(&self, domain: &str) -> PolicyDecision {
        if self
            .policy
            .allowed_network_domains
            .contains(&"*".to_string())
            || self
                .policy
                .allowed_network_domains
                .iter()
                .any(|d| d == domain)
        {
            PolicyDecision::Allow
        } else {
            PolicyDecision::Deny {
                reason: format!("Domain '{}' is not permitted", domain),
            }
        }
    }

    pub fn check_budget_limit(&self, estimated_cost: f64) -> PolicyDecision {
        if estimated_cost > self.policy.max_task_budget_usd {
            PolicyDecision::RequiresConfirmation {
                reason: format!(
                    "Estimated cost (${:.2}) exceeds task budget limit (${:.2})",
                    estimated_cost, self.policy.max_task_budget_usd
                ),
            }
        } else {
            PolicyDecision::Allow
        }
    }

    pub fn check_failure_streak(&self, tool_id: &str, failure_rate: f64) -> PolicyDecision {
        if failure_rate >= 0.8 {
            PolicyDecision::Deny {
                reason: format!(
                    "Capability '{}' blocked due to excessive failure rate ({:.0}%)",
                    tool_id,
                    failure_rate * 100.0
                ),
            }
        } else {
            PolicyDecision::Allow
        }
    }
}
