//! Python Runtime
//!
//! Executes Python plugins via an embedded CPython interpreter using PyO3.

use serde_json::Value;
use std::path::PathBuf;
use std::process::Command;

use pyo3::prelude::*;
use pyo3::types::PyDict;

use crate::models::plugin::Plugin;
use crate::utils::errors::WeaveError;

/// Python runtime for executing Python plugins.
pub struct PythonRuntime;

impl PythonRuntime {
    pub fn new() -> Result<Self, WeaveError> {
        Ok(Self)
    }

    fn plugin_path(plugin: &Plugin) -> Result<&PathBuf, WeaveError> {
        plugin.path.as_ref().ok_or_else(|| WeaveError::PluginLoadError {
            plugin_id: plugin.id.clone(),
            reason: "Python plugin has no path defined".to_string(),
        })
    }

    fn venv_path(plugin_path: &PathBuf) -> PathBuf {
        plugin_path.join(".venv")
    }

    fn venv_python_executable(venv_path: &PathBuf) -> PathBuf {
        #[cfg(target_os = "windows")]
        {
            venv_path.join("Scripts").join("python.exe")
        }
        #[cfg(not(target_os = "windows"))]
        {
            venv_path.join("bin").join("python")
        }
    }

    /// Create a venv for the plugin and install requirements.txt if present.
    pub fn load(&self, plugin: &Plugin) -> Result<(), WeaveError> {
        let path = Self::plugin_path(plugin)?;
        let venv_path = Self::venv_path(path);

        if !venv_path.exists() {
            Python::with_gil(|py| -> Result<(), WeaveError> {
                let venv = py.import_bound("venv").map_err(|e| WeaveError::PluginLoadError {
                    plugin_id: plugin.id.clone(),
                    reason: format!("Failed to import venv module: {}", e),
                })?;
                let create = venv.getattr("create").map_err(|e| WeaveError::PluginLoadError {
                    plugin_id: plugin.id.clone(),
                    reason: format!("Failed to get venv.create: {}", e),
                })?;
                let kwargs = PyDict::new_bound(py);
                kwargs
                    .set_item("with_pip", true)
                    .map_err(|e| WeaveError::PluginLoadError {
                        plugin_id: plugin.id.clone(),
                        reason: format!("Failed to set with_pip: {}", e),
                    })?;
                create
                    .call1((venv_path.to_string_lossy().to_string(),))
                    .map_err(|e| WeaveError::PluginLoadError {
                        plugin_id: plugin.id.clone(),
                        reason: format!("Failed to create venv: {}", e),
                    })?;
                Ok(())
            })?;
        }

        let requirements = path.join("requirements.txt");
        if requirements.exists() {
            let python_exe = Self::venv_python_executable(&venv_path);
            
            // Ensure pip is actually installed (venv with_pip=True sometimes silently fails on NixOS/Debian)
            let _ = Command::new(&python_exe)
                .args(["-m", "ensurepip", "--upgrade"])
                .output();

            let output = Command::new(&python_exe)
                .args([
                    "-m",
                    "pip",
                    "install",
                    "-r",
                    requirements.to_string_lossy().as_ref(),
                ])
                .output()
                .map_err(|e| WeaveError::DependencyInstallError {
                    package: None,
                    stderr: format!("Failed to run pip install: {}", e),
                })?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                return Err(WeaveError::DependencyInstallError {
                    package: None,
                    stderr,
                });
            }
        }

        Ok(())
    }

    /// Execute a Python plugin capability.
    pub fn execute(
        &self,
        plugin: &Plugin,
        capability: &str,
        params: Value,
    ) -> Result<Value, WeaveError> {
        let path = Self::plugin_path(plugin)?;

        let entry = if plugin.runtime.entry.is_empty() {
            "main.py"
        } else {
            &plugin.runtime.entry
        };
        let entry_path = path.join(entry);

        if !entry_path.exists() {
            return Err(WeaveError::PluginError(format!(
                "Python entry point not found at {:?}",
                entry_path
            )));
        }

        let venv_path = Self::venv_path(path);
        let site_packages = Self::site_packages_path(&venv_path);

        let params_str = serde_json::to_string(&params)
            .map_err(|e| WeaveError::Serialization(e.to_string()))?;

        let code = std::fs::read_to_string(&entry_path)
            .map_err(|e| WeaveError::Io(e.to_string()))?;

        Python::with_gil(|py| -> Result<Value, WeaveError> {
            let sys = py.import_bound("sys").map_err(|e| WeaveError::PythonRuntimeError {
                message: format!("Failed to import sys: {}", e),
                stderr: None,
            })?;
            let sys_path = sys.getattr("path").map_err(|e| WeaveError::PythonRuntimeError {
                message: format!("Failed to get sys.path: {}", e),
                stderr: None,
            })?;
            sys_path
                .call_method1("insert", (0, path.to_string_lossy().to_string()))
                .map_err(|e| WeaveError::PythonRuntimeError {
                    message: format!("Failed to insert plugin path: {}", e),
                    stderr: None,
                })?;
            sys_path
                .call_method1("append", (site_packages.to_string_lossy().to_string(),))
                .map_err(|e| WeaveError::PythonRuntimeError {
                    message: format!("Failed to append site-packages: {}", e),
                    stderr: None,
                })?;

            let globals = PyDict::new_bound(py);
            globals
                .set_item("__weave_capability__", capability)
                .map_err(|e| WeaveError::PythonRuntimeError {
                    message: format!("Failed to set capability global: {}", e),
                    stderr: None,
                })?;
            globals
                .set_item("__weave_params__", params_str)
                .map_err(|e| WeaveError::PythonRuntimeError {
                    message: format!("Failed to set params global: {}", e),
                    stderr: None,
                })?;

            if let Err(e) = py.run_bound(&code, Some(&globals), None) {
                // Wait, `traceback` method expects `&Python` ? The `py` is `Python<'_>`, so `e.traceback(py)` 
                // in PyO3 0.22 might be `e.traceback(py)`. Let's just use `e.to_string()`.
                return Err(WeaveError::PythonRuntimeError {
                    message: format!("Python execution failed: {}", e),
                    stderr: Some(e.to_string()),
                });
            }

            let result = globals.get_item("result").map_err(|e| WeaveError::PythonRuntimeError {
                message: format!("Failed to get 'result' variable: {}", e),
                stderr: None,
            })?;

            if result.is_none() {
                return Err(WeaveError::PythonRuntimeError {
                    message: "Python plugin did not set a 'result' variable".to_string(),
                    stderr: None,
                });
            }
            
            let result_bound = result.unwrap();

            let json = py.import_bound("json").map_err(|e| WeaveError::PythonRuntimeError {
                message: format!("Failed to import json: {}", e),
                stderr: None,
            })?;
            let dumps = json.getattr("dumps").map_err(|e| WeaveError::PythonRuntimeError {
                message: format!("Failed to get json.dumps: {}", e),
                stderr: None,
            })?;
            let result_py_str = dumps.call1((result_bound,)).map_err(|e| WeaveError::PythonRuntimeError {
                message: format!("Failed to call json.dumps: {}", e),
                stderr: None,
            })?;
            
            let result_str = result_py_str.str().map_err(|e| WeaveError::PythonRuntimeError {
                message: format!("Failed to convert result to string: {}", e),
                stderr: None,
            })?;

            let value: Value = serde_json::from_str(&result_str.to_string())
                .map_err(|e| WeaveError::Serialization(format!(
                    "Failed to parse result as JSON: {}. Result: {}",
                    e, result_str
                )))?;

            Ok(value)
        })
    }

    fn site_packages_path(venv_path: &PathBuf) -> PathBuf {
        #[cfg(target_os = "windows")]
        {
            venv_path.join("Lib").join("site-packages")
        }
        #[cfg(not(target_os = "windows"))]
        {
            let lib_dir = venv_path.join("lib");
            if let Ok(entries) = std::fs::read_dir(&lib_dir) {
                for entry in entries.flatten() {
                    let name = entry.file_name();
                    let name_str = name.to_string_lossy();
                    if name_str.starts_with("python") && entry.path().join("site-packages").exists() {
                        return entry.path().join("site-packages");
                    }
                }
            }
            lib_dir.join("python3").join("site-packages")
        }
    }
}
