import os

crates = {
    "runtime-kernel": {
        "deps": ["serde = { version = \"1\", features = [\"derive\"] }", "tokio = { version = \"1\", features = [\"full\"] }", "async-trait = \"0.1\"", "thiserror = \"1\"", "serde_json = \"1\"", "parking_lot = \"0.12\"", "uuid = { version = \"1\", features = [\"v4\", \"serde\"] }", "tokio-util = \"0.7\""]
    },
    "execution-runtime": {
        "deps": ["runtime-kernel = { path = \"../runtime-kernel\" }", "serde = { version = \"1\", features = [\"derive\"] }", "tokio = { version = \"1\", features = [\"full\"] }", "async-trait = \"0.1\"", "thiserror = \"1\"", "serde_json = \"1\"", "parking_lot = \"0.12\"", "uuid = { version = \"1\", features = [\"v4\", \"serde\"] }", "tokio-util = \"0.7\""]
    },
    "planning": {
        "deps": ["runtime-kernel = { path = \"../runtime-kernel\" }", "memory = { path = \"../memory\" }", "serde = { version = \"1\", features = [\"derive\"] }", "tokio = { version = \"1\", features = [\"full\"] }", "async-trait = \"0.1\"", "thiserror = \"1\"", "serde_json = \"1\"", "parking_lot = \"0.12\"", "uuid = { version = \"1\", features = [\"v4\", \"serde\"] }", "tokio-util = \"0.7\""]
    },
    "memory": {
        "deps": ["runtime-kernel = { path = \"../runtime-kernel\" }", "capabilities = { path = \"../capabilities\" }", "serde = { version = \"1\", features = [\"derive\"] }", "tokio = { version = \"1\", features = [\"full\"] }", "async-trait = \"0.1\"", "thiserror = \"1\"", "serde_json = \"1\"", "parking_lot = \"0.12\"", "uuid = { version = \"1\", features = [\"v4\", \"serde\"] }", "tokio-util = \"0.7\""]
    },
    "capabilities": {
        "deps": ["runtime-kernel = { path = \"../runtime-kernel\" }", "serde = { version = \"1\", features = [\"derive\"] }", "tokio = { version = \"1\", features = [\"full\"] }", "async-trait = \"0.1\"", "thiserror = \"1\"", "serde_json = \"1\"", "parking_lot = \"0.12\"", "uuid = { version = \"1\", features = [\"v4\", \"serde\"] }", "tokio-util = \"0.7\""]
    },
    "plugin-runtime": {
        "deps": ["runtime-kernel = { path = \"../runtime-kernel\" }", "capabilities = { path = \"../capabilities\" }", "serde = { version = \"1\", features = [\"derive\"] }", "tokio = { version = \"1\", features = [\"full\"] }", "async-trait = \"0.1\"", "thiserror = \"1\"", "serde_json = \"1\"", "parking_lot = \"0.12\"", "uuid = { version = \"1\", features = [\"v4\", \"serde\"] }", "tokio-util = \"0.7\"", "reqwest = { version = \"0.12\", features = [\"json\", \"stream\", \"rustls-tls\"] }"]
    },
    "ai-runtime": {
        "deps": ["runtime-kernel = { path = \"../runtime-kernel\" }", "plugin-runtime = { path = \"../plugin-runtime\" }", "serde = { version = \"1\", features = [\"derive\"] }", "tokio = { version = \"1\", features = [\"full\"] }", "async-trait = \"0.1\"", "thiserror = \"1\"", "serde_json = \"1\"", "parking_lot = \"0.12\"", "uuid = { version = \"1\", features = [\"v4\", \"serde\"] }", "tokio-util = \"0.7\"", "reqwest = { version = \"0.12\", features = [\"json\", \"stream\", \"rustls-tls\"] }"]
    },
    "workflow-runtime": {
        "deps": ["runtime-kernel = { path = \"../runtime-kernel\" }", "execution-runtime = { path = \"../execution-runtime\" }", "serde = { version = \"1\", features = [\"derive\"] }", "tokio = { version = \"1\", features = [\"full\"] }", "async-trait = \"0.1\"", "thiserror = \"1\"", "serde_json = \"1\"", "parking_lot = \"0.12\"", "uuid = { version = \"1\", features = [\"v4\", \"serde\"] }", "tokio-util = \"0.7\""]
    }
}

base_path = "/home/kael/weave/crates"

for crate_name, config in crates.items():
    crate_path = os.path.join(base_path, crate_name)
    if not os.path.exists(crate_path):
        continue
    
    cargo_toml_path = os.path.join(crate_path, "Cargo.toml")
    cargo_toml_content = f"""[package]
name = "{crate_name}"
version = "0.1.0"
edition = "2021"

[dependencies]
{chr(10).join(config['deps'])}
"""
    with open(cargo_toml_path, "w") as f:
        f.write(cargo_toml_content)
        
    lib_rs_path = os.path.join(crate_path, "src", "lib.rs")
    
    # Try to find all .rs files in src/ to make sure we export them
    modules = []
    src_dir = os.path.join(crate_path, "src")
    for item in os.listdir(src_dir):
        if item.endswith(".rs") and item != "lib.rs":
            modules.append(item[:-3])
        elif os.path.isdir(os.path.join(src_dir, item)):
            # It's a directory, we need to generate mod.rs inside it and then export it
            # But wait, we just flattened most directories. Only planner, memory, plugins, ai, agent, workflow had subdirs. Wait, I moved contents of those directories into the `src/`! So they are flattened in the new structure! Let's just export them.
            modules.append(item)
            
    lib_rs_content = "\n".join([f"pub mod {mod};" for mod in modules])
    
    with open(lib_rs_path, "w") as f:
        f.write(lib_rs_content)

print("Cargo.tomls and lib.rs generated successfully.")
