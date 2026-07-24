use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tracing::info;

use crate::core::execution_context::ExecutionContext;
use crate::core::kernel::RuntimeKernel;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AgentStatus {
    Idle,
    Planning,
    Executing,
    Paused,
    Failed { error: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentGoal {
    pub id: String,
    pub goal_text: String,
    pub priority: u32,
    pub context: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub role: String,
    pub status: AgentStatus,
    pub goal_queue: VecDeque<AgentGoal>,
}

impl Agent {
    pub async fn run_loop(&mut self, kernel: Arc<RuntimeKernel>, plugin_id: &str, ctx: ExecutionContext) {
        info!("Starting autonomous event loop for Agent '{}' ({})", self.name, self.id);

        while let Some(goal) = self.goal_queue.pop_front() {
            self.status = AgentStatus::Planning;
            info!("Agent '{}' processing goal: '{}'", self.name, goal.goal_text);

            self.status = AgentStatus::Executing;
            match kernel.execute_goal(&goal.goal_text, plugin_id, &ctx).await {
                Ok(output) => {
                    info!("Agent '{}' successfully completed goal: {:?}", self.name, output);
                }
                Err(e) => {
                    self.status = AgentStatus::Failed { error: e.to_string() };
                    info!("Agent '{}' failed goal execution: {}", self.name, e);
                    break;
                }
            }
        }

        self.status = AgentStatus::Idle;
    }
}

pub struct AgentSubsystem {
    agents: Arc<RwLock<HashMap<String, Agent>>>,
}

impl AgentSubsystem {
    pub fn new() -> Self {
        Self {
            agents: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn register_agent(&self, id: &str, name: &str, role: &str) -> Agent {
        let agent = Agent {
            id: id.to_string(),
            name: name.to_string(),
            role: role.to_string(),
            status: AgentStatus::Idle,
            goal_queue: VecDeque::new(),
        };

        self.agents.write().insert(id.to_string(), agent.clone());
        agent
    }

    pub fn push_goal(&self, agent_id: &str, goal_text: &str, priority: u32) -> bool {
        let mut agents = self.agents.write();
        if let Some(agent) = agents.get_mut(agent_id) {
            agent.goal_queue.push_back(AgentGoal {
                id: uuid::Uuid::new_v4().to_string(),
                goal_text: goal_text.to_string(),
                priority,
                context: serde_json::json!({}),
            });
            true
        } else {
            false
        }
    }

    pub fn pop_goal(&self, agent_id: &str) -> Option<AgentGoal> {
        let mut agents = self.agents.write();
        if let Some(agent) = agents.get_mut(agent_id) {
            agent.goal_queue.pop_front()
        } else {
            None
        }
    }

    pub fn list_agents(&self) -> Vec<Agent> {
        self.agents.read().values().cloned().collect()
    }
}
