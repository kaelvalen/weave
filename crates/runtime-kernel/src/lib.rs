//! Micro-kernel supporting the backend agent loop.
//!
//! Kept deliberately thin: only the modules the Tauri backend actually uses —
//! event bus/store, execution context, observability, runtime events, and
//! errors. The former planning/knowledge/memory/workflow crates and the
//! `capabilities` routing crate were removed in the phase-5 purge; the
//! remaining dead modules here (`kernel`, `sandbox`, `blackboard`,
//! `subsystem`, `task_graph`, `artifact`, `policy_engine`,
//! `resource_manager`) were pruned. Process sandboxing now lives in
//! `shell_plugin.rs` (bubblewrap) — the single sandbox story.

pub mod errors;
pub mod event_bus;
pub mod event_store;
pub mod execution_context;
pub mod observability;
pub mod runtime_event;
