//! Micro-kernel supporting the backend agent loop.
//!
//! Kept deliberately thin: only the modules the Tauri backend actually uses —
//! event bus/store, execution context, observability, and runtime events. The
//! former planning/knowledge/memory/workflow crates and the `capabilities`
//! routing crate were removed; the dead modules (`kernel`, `sandbox`,
//! `blackboard`, `subsystem`, `task_graph`, `artifact`, `policy_engine`,
//! `resource_manager`, and the unused `errors` module) were pruned too.
//! Process sandboxing lives in `shell_plugin.rs` (bubblewrap) — one story.

pub mod event_bus;
pub mod event_store;
pub mod execution_context;
pub mod observability;
pub mod runtime_event;
