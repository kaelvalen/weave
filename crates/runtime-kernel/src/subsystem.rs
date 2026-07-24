use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::errors::KernelError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SubsystemStatus {
    Uninitialized,
    Running,
    Degraded { reason: String },
    Stopped,
}

#[async_trait]
pub trait KernelSubsystem: Send + Sync {
    fn name(&self) -> &'static str;
    async fn init(&self) -> Result<(), KernelError>;
    async fn start(&self) -> Result<(), KernelError>;
    async fn shutdown(&self) -> Result<(), KernelError>;
    fn status(&self) -> SubsystemStatus;
}

pub struct PlanningSubsystem {
    status: parking_lot::RwLock<SubsystemStatus>,
}

impl PlanningSubsystem {
    pub fn new() -> Self {
        Self { status: parking_lot::RwLock::new(SubsystemStatus::Uninitialized) }
    }
}

#[async_trait]
impl KernelSubsystem for PlanningSubsystem {
    fn name(&self) -> &'static str { "PlanningSubsystem" }
    async fn init(&self) -> Result<(), KernelError> {
        *self.status.write() = SubsystemStatus::Running;
        Ok(())
    }
    async fn start(&self) -> Result<(), KernelError> { Ok(()) }
    async fn shutdown(&self) -> Result<(), KernelError> {
        *self.status.write() = SubsystemStatus::Stopped;
        Ok(())
    }
    fn status(&self) -> SubsystemStatus { self.status.read().clone() }
}

pub struct ExecutionSubsystem {
    status: parking_lot::RwLock<SubsystemStatus>,
}

impl ExecutionSubsystem {
    pub fn new() -> Self {
        Self { status: parking_lot::RwLock::new(SubsystemStatus::Uninitialized) }
    }
}

#[async_trait]
impl KernelSubsystem for ExecutionSubsystem {
    fn name(&self) -> &'static str { "ExecutionSubsystem" }
    async fn init(&self) -> Result<(), KernelError> {
        *self.status.write() = SubsystemStatus::Running;
        Ok(())
    }
    async fn start(&self) -> Result<(), KernelError> { Ok(()) }
    async fn shutdown(&self) -> Result<(), KernelError> {
        *self.status.write() = SubsystemStatus::Stopped;
        Ok(())
    }
    fn status(&self) -> SubsystemStatus { self.status.read().clone() }
}

pub struct MemorySubsystem {
    status: parking_lot::RwLock<SubsystemStatus>,
}

impl MemorySubsystem {
    pub fn new() -> Self {
        Self { status: parking_lot::RwLock::new(SubsystemStatus::Uninitialized) }
    }
}

#[async_trait]
impl KernelSubsystem for MemorySubsystem {
    fn name(&self) -> &'static str { "MemorySubsystem" }
    async fn init(&self) -> Result<(), KernelError> {
        *self.status.write() = SubsystemStatus::Running;
        Ok(())
    }
    async fn start(&self) -> Result<(), KernelError> { Ok(()) }
    async fn shutdown(&self) -> Result<(), KernelError> {
        *self.status.write() = SubsystemStatus::Stopped;
        Ok(())
    }
    fn status(&self) -> SubsystemStatus { self.status.read().clone() }
}

pub struct StorageSubsystem {
    status: parking_lot::RwLock<SubsystemStatus>,
}

impl StorageSubsystem {
    pub fn new() -> Self {
        Self { status: parking_lot::RwLock::new(SubsystemStatus::Uninitialized) }
    }
}

#[async_trait]
impl KernelSubsystem for StorageSubsystem {
    fn name(&self) -> &'static str { "StorageSubsystem" }
    async fn init(&self) -> Result<(), KernelError> {
        *self.status.write() = SubsystemStatus::Running;
        Ok(())
    }
    async fn start(&self) -> Result<(), KernelError> { Ok(()) }
    async fn shutdown(&self) -> Result<(), KernelError> {
        *self.status.write() = SubsystemStatus::Stopped;
        Ok(())
    }
    fn status(&self) -> SubsystemStatus { self.status.read().clone() }
}
