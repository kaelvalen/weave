use super::process::ExecSpec;
use crate::utils::errors::WeaveError;
use std::path::Path;

pub fn detect_check_command(path: &Path) -> Result<ExecSpec, WeaveError> {
    if path.join("Cargo.toml").exists() {
        Ok(ExecSpec {
            binary: "cargo".to_string(),
            args: vec!["check".to_string()],
        })
    } else if path.join("package.json").exists() {
        let pkg = std::fs::read_to_string(path.join("package.json")).unwrap_or_default();
        if pkg.contains("\"type-check\"") {
            Ok(ExecSpec {
                binary: "npm".to_string(),
                args: vec!["run".to_string(), "type-check".to_string()],
            })
        } else if pkg.contains("\"build\"") {
            Ok(ExecSpec {
                binary: "npm".to_string(),
                args: vec!["run".to_string(), "build".to_string()],
            })
        } else {
            Ok(ExecSpec {
                binary: "npx".to_string(),
                args: vec!["tsc".to_string(), "--noEmit".to_string()],
            })
        }
    } else if path.join("pyproject.toml").exists() || path.join("requirements.txt").exists() {
        // Compile python files
        Ok(ExecSpec {
            binary: "python".to_string(),
            args: vec!["-m".to_string(), "compileall".to_string(), ".".to_string()],
        })
    } else if path.join("go.mod").exists() {
        Ok(ExecSpec {
            binary: "go".to_string(),
            args: vec!["build".to_string(), "./...".to_string()],
        })
    } else {
        Err(WeaveError::PluginError("Cannot detect project type. No Cargo.toml, package.json, pyproject.toml, or go.mod found.".to_string()))
    }
}

pub fn detect_test_command(
    path: &Path,
    filter: Option<&str>,
) -> Result<(ExecSpec, &'static str), WeaveError> {
    if path.join("Cargo.toml").exists() {
        let mut args = vec!["test".to_string()];
        if let Some(f) = filter {
            if !f.trim().is_empty() {
                args.push(f.to_string());
            }
        }
        Ok((
            ExecSpec {
                binary: "cargo".to_string(),
                args,
            },
            "cargo",
        ))
    } else if path.join("package.json").exists() {
        let pkg = std::fs::read_to_string(path.join("package.json")).unwrap_or_default();
        let mut args = vec!["test".to_string()];
        if let Some(f) = filter {
            if !f.trim().is_empty() {
                args.push("--".to_string());
                args.push(f.to_string());
            }
        }
        let framework = if pkg.contains("\"jest\"") {
            "jest"
        } else if pkg.contains("\"vitest\"") {
            "vitest"
        } else {
            "npm"
        };
        Ok((
            ExecSpec {
                binary: "npm".to_string(),
                args,
            },
            framework,
        ))
    } else if path.join("pyproject.toml").exists() || path.join("requirements.txt").exists() {
        let mut args = vec!["-m".to_string(), "pytest".to_string()];
        if let Some(f) = filter {
            if !f.trim().is_empty() {
                args.push("-k".to_string());
                args.push(f.to_string());
            }
        }
        args.push("-v".to_string());
        Ok((
            ExecSpec {
                binary: "python".to_string(),
                args,
            },
            "pytest",
        ))
    } else if path.join("go.mod").exists() {
        let mut args = vec!["test".to_string(), "./...".to_string()];
        if let Some(f) = filter {
            if !f.trim().is_empty() {
                args.push("-run".to_string());
                args.push(f.to_string());
            }
        }
        Ok((
            ExecSpec {
                binary: "go".to_string(),
                args,
            },
            "gotest",
        ))
    } else {
        Err(WeaveError::PluginError(
            "Cannot detect project type for tests.".to_string(),
        ))
    }
}
