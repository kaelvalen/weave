use std::fs;
use std::path::PathBuf;

const LOCAL_OAUTH_KEYS: &[&str] = &[
    "WEAVE_GITHUB_OAUTH_CLIENT_ID",
    "WEAVE_GITHUB_OAUTH_CLIENT_SECRET",
];

fn load_local_oauth_env() {
    let manifest_dir = std::env::var_os("CARGO_MANIFEST_DIR")
        .map(PathBuf::from)
        .expect("CARGO_MANIFEST_DIR is set by Cargo");
    let env_path = manifest_dir.join("../.env.local");
    println!("cargo:rerun-if-changed={}", env_path.display());

    let Ok(contents) = fs::read_to_string(&env_path) else {
        return;
    };
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if !LOCAL_OAUTH_KEYS.contains(&key) {
            continue;
        }
        let value = value.trim().trim_matches(|c| c == '\'' || c == '"');
        println!("cargo:rustc-env={}={}", key, value);
    }
}

fn main() {
    println!("cargo:rerun-if-env-changed=WEAVE_GITHUB_OAUTH_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=WEAVE_GITHUB_OAUTH_CLIENT_SECRET");
    println!("cargo:rerun-if-env-changed=WEAVE_OAUTH_CLIENT_SECRET");
    load_local_oauth_env();
    tauri_build::build()
}
