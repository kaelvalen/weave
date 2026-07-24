use std::collections::HashMap;
use crate::capability::Capability;
use crate::artifact::Artifact;

pub struct CapabilityGraph {
    // Capability -> requires -> Capability -> produces -> Artifact
}

impl CapabilityGraph {
    pub fn new() -> Self {
        Self {}
    }
}
