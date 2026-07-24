import os
import re

# Mapping from old import path to new crate::module path
import_map = {
    # registries
    "crate::core::registries::knowledge_graph": "memory::knowledge_graph",
    "crate::core::registries::vector_index": "memory::vector_index",
    "crate::core::registries::planner_index": "memory::planner_index",
    "crate::core::registries::execution_registry": "execution_runtime::execution_registry",
    "crate::core::registries::typed_contract": "capabilities::typed_contract",
    "crate::core::registries::permission_registry": "capabilities::permission_registry",
    "crate::core::registries::capability_registry": "capabilities::capability_registry",
    
    # capability & tools
    "crate::core::capability_registry": "capabilities::capability_registry_core",
    "crate::core::tool_registry": "capabilities::tool_registry",
    
    # runtime-kernel
    "crate::core::event_bus": "runtime_kernel::event_bus",
    "crate::core::event_sourcing": "runtime_kernel::event_sourcing",
    "crate::core::execution_context": "runtime_kernel::execution_context",
    "crate::core::kernel": "runtime_kernel::kernel",
    "crate::core::subsystem": "runtime_kernel::subsystem",
    "crate::core::sandbox": "runtime_kernel::sandbox",
    "crate::core::policy_engine": "runtime_kernel::policy_engine",
    "crate::core::resource_manager": "runtime_kernel::resource_manager",
    "crate::core::observability": "runtime_kernel::observability",
    
    # planner
    "crate::core::planner": "planning",
    
    # memory
    "crate::core::memory": "memory",
    
    # ai
    "crate::core::ai_bridge": "ai_runtime::ai_bridge",
    "crate::core::ai": "ai_runtime",
    "crate::core::agent": "ai_runtime",
    
    # plugin
    "crate::core::github_plugin": "plugin_runtime::github_plugin",
    "crate::core::plugin_manager": "plugin_runtime::plugin_manager",
    "crate::core::plugin_loader": "plugin_runtime::plugin_loader",
    "crate::core::plugins": "plugin_runtime",
    
    # workflow
    "crate::core::workflow": "workflow_runtime",
    "crate::core::scheduler": "workflow_runtime::scheduler",
}

def replace_in_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
        
    original_content = content
    
    # Simple replace
    for old, new in import_map.items():
        content = content.replace(old, new)
        
    if content != original_content:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False

def process_directory(directory):
    count = 0
    for root, _, files in os.walk(directory):
        for file in files:
            if file.endswith('.rs'):
                filepath = os.path.join(root, file)
                if replace_in_file(filepath):
                    count += 1
    return count

print("Updated files in src-tauri:", process_directory("/home/kael/weave/src-tauri/src"))
print("Updated files in crates:", process_directory("/home/kael/weave/crates"))
