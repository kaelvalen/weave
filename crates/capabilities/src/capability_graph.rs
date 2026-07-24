use std::collections::HashMap;
use crate::capability::Capability;
use runtime_kernel::artifact::Artifact;

pub struct CapabilityGraph {
    // Capability -> requires -> Capability -> produces -> Artifact
}

impl CapabilityGraph {
    pub fn new() -> Self {
        Self {}
    }
}
