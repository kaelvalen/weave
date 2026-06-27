use serde_json::json;
use std::path::{Path, PathBuf};

const BLOCKED_READ_PATHS: &[&str] = &["/etc/shadow", "/etc/gshadow", "/etc/sudoers"];

fn resolve_path(path: &str) -> Result<PathBuf, String> {
    if path.starts_with("~/") {
        let home = dirs::home_dir().unwrap();
        Ok(home.join(&path[2..]))
    } else if Path::new(path).is_absolute() {
        Ok(PathBuf::from(path))
    } else {
        Ok(std::env::current_dir().unwrap().join(path))
    }
}

fn main() {
    let path = "/home/kael/weave/package.json";
    let resolved = resolve_path(path).unwrap();
    println!("Resolved: {}", resolved.display());
    println!("Exists: {}", resolved.exists());
    println!("Is file: {}", resolved.is_file());
}
