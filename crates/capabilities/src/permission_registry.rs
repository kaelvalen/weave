use std::sync::Arc;
use std::path::Path;
use runtime_kernel::policy_engine::{PolicyDecision, PolicyEngine, SecurityPolicy};

pub struct PermissionRegistry {
    policy_engine: Arc<PolicyEngine>,
}

impl PermissionRegistry {
    pub fn new(policy: SecurityPolicy) -> Self {
        Self {
            policy_engine: Arc::new(PolicyEngine::new(policy)),
        }
    }

    pub fn default_registry() -> Self {
        Self::new(SecurityPolicy::default())
    }

    pub fn check_path(&self, path: &Path, is_write: bool) -> PolicyDecision {
        self.policy_engine.check_path_access(path, is_write)
    }

    pub fn check_command(&self, command: &str) -> PolicyDecision {
        self.policy_engine.check_command_execution(command)
    }

    pub fn check_network(&self, domain: &str) -> PolicyDecision {
        self.policy_engine.check_network_domain(domain)
    }
}
