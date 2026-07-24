use serde_json::{json, Value};
use std::sync::Arc;
use tracing::info;

use crate::core::event_sourcing::{AuditEventType, EventSourcingStore};
use crate::core::execution_context::ExecutionContext;
use crate::core::memory::memory_engine::MemoryEngine;
use crate::core::observability::Observability;
use crate::core::planner::planner_engine::PlannerEngine;
use crate::core::planner::task_graph::{TaskGraph, TaskStatus};
use crate::core::policy_engine::PolicyDecision;
use crate::core::registries::capability_registry::CapabilityRegistry;
use crate::core::registries::execution_registry::ExecutionRegistry;
use crate::core::registries::permission_registry::PermissionRegistry;
use crate::core::registries::planner_index::PlannerIndex;
use crate::core::registries::vector_index::CapabilityVectorIndex;
use crate::core::resource_manager::ResourceManager;
use crate::core::scheduler::Scheduler;
use crate::utils::errors::WeaveError;

pub struct RuntimeKernel {
    pub planner_engine: Arc<PlannerEngine>,
    pub execution_registry: Arc<ExecutionRegistry>,
    pub capability_registry: Arc<CapabilityRegistry>,
    pub permission_registry: Arc<PermissionRegistry>,
    pub planner_index: Arc<PlannerIndex>,
    pub vector_index: Arc<CapabilityVectorIndex>,
    pub memory_engine: Arc<MemoryEngine>,
    pub event_store: Arc<EventSourcingStore>,
    pub observability: Arc<Observability>,
    pub resource_manager: Arc<ResourceManager>,
    pub scheduler: Arc<Scheduler>,
}

impl RuntimeKernel {
    pub fn new(
        planner_engine: Arc<PlannerEngine>,
        execution_registry: Arc<ExecutionRegistry>,
        capability_registry: Arc<CapabilityRegistry>,
        permission_registry: Arc<PermissionRegistry>,
        planner_index: Arc<PlannerIndex>,
        memory_engine: Arc<MemoryEngine>,
        event_store: Arc<EventSourcingStore>,
        observability: Arc<Observability>,
        resource_manager: Arc<ResourceManager>,
        scheduler: Arc<Scheduler>,
    ) -> Self {
        Self {
            planner_engine,
            execution_registry,
            capability_registry,
            permission_registry,
            planner_index,
            vector_index: Arc::new(CapabilityVectorIndex::new()),
            memory_engine,
            event_store,
            observability,
            resource_manager,
            scheduler,
        }
    }

    /// Primary Orchestration Entry Point: Goal -> Planner -> Policy -> Execution -> CQRS Projections & Memory
    pub async fn execute_goal(
        &self,
        goal: &str,
        plugin_id: &str,
        ctx: &ExecutionContext,
    ) -> Result<Value, WeaveError> {
        info!("RuntimeKernel orchestrating goal execution: '{}'", goal);

        // 1. Audit Task Created
        self.event_store.append(
            AuditEventType::TaskCreated {
                task_id: ctx.session_id.clone(),
                goal: goal.to_string(),
            },
            json!({"goal": goal}),
        );

        // 2. Pure Planner creates candidate TaskGraph
        let mut graph: TaskGraph = self.planner_engine.create_plan(goal)?;
        self.event_store.append(
            AuditEventType::TaskPlanned {
                plan_id: graph.id.clone(),
                node_count: graph.nodes.len(),
            },
            json!({"plan_id": graph.id}),
        );

        // 3. Execution Loop with Topological Batching
        let batches = graph.get_parallel_batches();
        for batch in batches {
            for node_id in batch {
                let (cap_id, params) = {
                    let node = graph.nodes.get(&node_id).unwrap();
                    (node.capability_id.clone(), node.params.clone())
                };

                // Policy Check
                if cap_id == "shell.exec" || cap_id == "shell.execute" {
                    if let Some(cmd) = params.get("command").and_then(|v| v.as_str()) {
                        if matches!(self.permission_registry.check_command(cmd), PolicyDecision::Deny { .. }) {
                            graph.update_status(
                                &node_id,
                                TaskStatus::Failed { error: "Policy denied shell execution".into() },
                                None,
                            );

                            // Trigger Transactional Rollback
                            let _ = graph.rollback_graph(&node_id, ctx).await;
                            return Err(WeaveError::PermissionDenied(format!("Policy denied command: {}", cmd)));
                        }
                    }
                }

                // Audit Execution Started
                self.event_store.append(
                    AuditEventType::ExecutionStarted {
                        task_id: node_id.clone(),
                        capability_id: cap_id.clone(),
                    },
                    json!({"params": params}),
                );

                graph.update_status(&node_id, TaskStatus::Running, None);

                // Execution Registry Dispatch
                match self.execution_registry.execute(plugin_id, &cap_id, params, ctx) {
                    Ok(output) => {
                        graph.update_status(&node_id, TaskStatus::Completed, Some(output.clone()));
                        self.event_store.append(
                            AuditEventType::ExecutionFinished {
                                task_id: node_id.clone(),
                                success: true,
                                duration_ms: 10,
                            },
                            json!({"output": output}),
                        );
                    }
                    Err(e) => {
                        graph.update_status(
                            &node_id,
                            TaskStatus::Failed { error: e.to_string() },
                            None,
                        );

                        self.event_store.append(
                            AuditEventType::ExecutionFinished {
                                task_id: node_id.clone(),
                                success: false,
                                duration_ms: 10,
                            },
                            json!({"error": e.to_string()}),
                        );

                        // Trigger Transactional Rollback
                        let _ = graph.rollback_graph(&node_id, ctx).await;
                        return Err(e);
                    }
                }
            }
        }

        // 4. Memory Consolidation
        let _ = self.memory_engine.consolidate().await;

        Ok(json!({
            "plan_id": graph.id,
            "completed": graph.is_completed(),
            "nodes": graph.nodes,
            "cqrs_read_model": self.event_store.get_read_model()
        }))
    }
}
