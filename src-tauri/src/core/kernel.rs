use serde_json::{json, Value};
use std::sync::Arc;
use tracing::info;

use crate::core::agent::agent_subsystem::AgentSubsystem;
use crate::core::event_sourcing::{AuditEventType, EventSourcingStore};
use crate::core::execution_context::ExecutionContext;
use crate::core::memory::memory_engine::MemoryEngine;
use crate::core::observability::Observability;
use crate::core::planner::planner_engine::PlannerEngine;
use crate::core::planner::task_graph::{TaskGraph, TaskStatus};
use crate::core::policy_engine::PolicyDecision;
use crate::core::registries::capability_registry::CapabilityRegistry;
use crate::core::registries::execution_registry::ExecutionRegistry;
use crate::core::registries::knowledge_graph::CapabilityKnowledgeGraph;
use crate::core::registries::permission_registry::PermissionRegistry;
use crate::core::registries::planner_index::PlannerIndex;
use crate::core::registries::vector_index::CapabilityVectorIndex;
use crate::core::resource_manager::ResourceManager;
use crate::core::scheduler::Scheduler;
use crate::core::subsystem::*;
use crate::utils::errors::WeaveError;

pub struct RuntimeKernel {
    pub planner_engine: Arc<PlannerEngine>,
    pub execution_registry: Arc<ExecutionRegistry>,
    pub capability_registry: Arc<CapabilityRegistry>,
    pub permission_registry: Arc<PermissionRegistry>,
    pub planner_index: Arc<PlannerIndex>,
    pub vector_index: Arc<CapabilityVectorIndex>,
    pub knowledge_graph: Arc<CapabilityKnowledgeGraph>,
    pub agent_subsystem: Arc<AgentSubsystem>,
    pub memory_engine: Arc<MemoryEngine>,
    pub event_store: Arc<EventSourcingStore>,
    pub observability: Arc<Observability>,
    pub resource_manager: Arc<ResourceManager>,
    pub scheduler: Arc<Scheduler>,
    pub subsystems: Vec<Arc<dyn KernelSubsystem>>,
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
        let subsystems: Vec<Arc<dyn KernelSubsystem>> = vec![
            Arc::new(PlanningSubsystem::new()),
            Arc::new(ExecutionSubsystem::new()),
            Arc::new(MemorySubsystem::new()),
            Arc::new(StorageSubsystem::new()),
        ];

        Self {
            planner_engine,
            execution_registry,
            capability_registry,
            permission_registry,
            planner_index,
            vector_index: Arc::new(CapabilityVectorIndex::new()),
            knowledge_graph: Arc::new(CapabilityKnowledgeGraph::new()),
            agent_subsystem: Arc::new(AgentSubsystem::new()),
            memory_engine,
            event_store,
            observability,
            resource_manager,
            scheduler,
            subsystems,
        }
    }

    pub async fn initialize_subsystems(&self) -> Result<(), WeaveError> {
        for sub in &self.subsystems {
            info!("Initializing Kernel Subsystem: {}", sub.name());
            sub.init().await?;
        }
        Ok(())
    }

    /// Async Dataflow Orchestration Entry Point: Goal -> Planner -> Policy -> Execution -> SAGA Rollback -> CQRS & Memory
    pub async fn execute_goal(
        &self,
        goal: &str,
        plugin_id: &str,
        ctx: &ExecutionContext,
    ) -> Result<Value, WeaveError> {
        let span_ctx = ctx.child_span();
        info!("RuntimeKernel orchestrating goal (trace_id: {}, span_id: {}): '{}'", span_ctx.trace_id, span_ctx.span_id, goal);

        // 1. Audit Task Created
        self.event_store.append(
            AuditEventType::TaskCreated {
                task_id: span_ctx.session_id.clone(),
                goal: goal.to_string(),
            },
            json!({"goal": goal, "trace_id": span_ctx.trace_id}),
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

        // 3. Async Parallel Dataflow Batch Execution Loop
        let batches = graph.get_parallel_batches();
        for batch in batches {
            for node_id in batch {
                graph.resolve_dataflow_inputs(&node_id);
                graph.update_status(&node_id, TaskStatus::Running, None);

                let (cap_id, mut params, inputs) = {
                    let node = graph.nodes.get(&node_id).unwrap();
                    (node.capability_id.clone(), node.params.clone(), node.inputs.clone())
                };

                // Merge dataflow inputs into execution params
                if let Some(obj) = params.as_object_mut() {
                    for (k, v) in inputs {
                        obj.insert(k, v);
                    }
                }

                // Policy Check
                if cap_id == "shell.exec" || cap_id == "shell.execute" {
                    if let Some(cmd) = params.get("command").and_then(|v| v.as_str()) {
                        if matches!(self.permission_registry.check_command(cmd), PolicyDecision::Deny { .. }) {
                            graph.update_status(
                                &node_id,
                                TaskStatus::Failed { error: "Policy denied shell execution".into() },
                                None,
                            );

                            let _ = graph.saga_rollback(&node_id, &span_ctx).await;
                            return Err(WeaveError::PermissionDenied(format!("Policy denied command: {}", cmd)));
                        }
                    }
                }

                self.event_store.append(
                    AuditEventType::ExecutionStarted {
                        task_id: node_id.clone(),
                        capability_id: cap_id.clone(),
                    },
                    json!({"params": params}),
                );

                let exec_reg = self.execution_registry.clone();
                let plugin = plugin_id.to_string();
                let cap = cap_id.clone();
                let p = params.clone();
                let c = span_ctx.clone();

                let handle = tokio::spawn(async move {
                    exec_reg.execute(&plugin, &cap, p, &c)
                });

                match handle.await {
                    Ok(Ok(output)) => {
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
                    Ok(Err(e)) => {
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

                        let _ = graph.saga_rollback(&node_id, &span_ctx).await;
                        return Err(e);
                    }
                    Err(join_err) => {
                        let err_msg = format!("Task node join error: {}", join_err);
                        graph.update_status(
                            &node_id,
                            TaskStatus::Failed { error: err_msg.clone() },
                            None,
                        );

                        let _ = graph.saga_rollback(&node_id, &span_ctx).await;
                        return Err(WeaveError::ExecutionError(err_msg));
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
