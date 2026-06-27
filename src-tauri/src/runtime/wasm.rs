#![cfg(feature = "wasm-runtime")]

use serde_json::Value;
use std::path::PathBuf;

use wasmtime::{Engine, Linker, Memory, Module, Store, TypedFunc};
use wasmtime_wasi::{DirPerms, FilePerms, WasiCtxBuilder};

use crate::models::plugin::Plugin;
use crate::utils::errors::WeaveError;

/// WASM runtime for executing WebAssembly plugins via wasmtime + WASI preview 1.
pub struct WasmRuntime;

impl WasmRuntime {
    pub fn new() -> Result<Self, WeaveError> {
        Ok(Self)
    }

    fn plugin_path(plugin: &Plugin) -> Result<&PathBuf, WeaveError> {
        plugin.path.as_ref().ok_or_else(|| WeaveError::PluginLoadError {
            plugin_id: plugin.id.clone(),
            reason: "WASM plugin has no path defined".to_string(),
        })
    }

    pub fn execute(
        &self,
        plugin: &Plugin,
        capability: &str,
        params: Value,
    ) -> Result<Value, WeaveError> {
        let path = Self::plugin_path(plugin)?;
        let wasm_path = path.join(&plugin.runtime.entry);

        if !wasm_path.exists() {
            return Err(WeaveError::WasmRuntimeError(format!(
                "WASM entry not found at {:?}",
                wasm_path
            )));
        }

        let wasm_bytes = std::fs::read(&wasm_path)
            .map_err(|e| WeaveError::WasmRuntimeError(format!("Failed to read WASM file: {}", e)))?;

        let engine = Engine::default();
        let module = Module::new(&engine, &wasm_bytes).map_err(|e| {
            WeaveError::WasmRuntimeError(format!("Failed to compile WASM module: {}", e))
        })?;

        let wasi_ctx = WasiCtxBuilder::new()
            .inherit_stdio()
            .preopened_dir(path, ".", DirPerms::READ, FilePerms::READ)
            .map_err(|e| WeaveError::WasmRuntimeError(format!("WASI preopen failed: {}", e)))?
            .build_p1();

        let mut store = Store::new(&engine, wasi_ctx);
        let mut linker = Linker::new(&engine);
        wasmtime_wasi::preview1::add_to_linker_sync(&mut linker, |ctx| ctx).map_err(|e| {
            WeaveError::WasmRuntimeError(format!("Failed to add WASI preview1 to linker: {}", e))
        })?;

        let instance = linker.instantiate(&mut store, &module).map_err(|e| {
            WeaveError::WasmRuntimeError(format!("Failed to instantiate WASM module: {}", e))
        })?;

        let memory = instance.get_memory(&mut store, "memory").ok_or_else(|| {
            WeaveError::WasmAbiError {
                detail: "WASM module must export 'memory'".to_string(),
            }
        })?;

        let allocate: TypedFunc<i32, i32> = instance
            .get_typed_func(&mut store, "allocate")
            .map_err(|e| WeaveError::WasmAbiError {
                detail: format!("Failed to get 'allocate' export: {}", e),
            })?;

        let deallocate: TypedFunc<(i32, i32), ()> = instance
            .get_typed_func(&mut store, "deallocate")
            .map_err(|e| WeaveError::WasmAbiError {
                detail: format!("Failed to get 'deallocate' export: {}", e),
            })?;

        let execute_fn: TypedFunc<(i32, i32), i32> = instance
            .get_typed_func(&mut store, "execute")
            .map_err(|e| WeaveError::WasmAbiError {
                detail: format!("Failed to get 'execute' export: {}", e),
            })?;

        let cap_json = serde_json::to_string(&capability)
            .map_err(|e| WeaveError::Serialization(e.to_string()))?;
        let params_json = serde_json::to_string(&params)
            .map_err(|e| WeaveError::Serialization(e.to_string()))?;

        let cap_ptr = Self::write_string_to_memory(
            &mut store,
            &memory,
            &allocate,
            &cap_json,
        )?;
        let params_ptr = Self::write_string_to_memory(
            &mut store,
            &memory,
            &allocate,
            &params_json,
        )?;

        let result_ptr = execute_fn
            .call(&mut store, (cap_ptr, params_ptr))
            .map_err(|e| WeaveError::WasmRuntimeError(format!("WASM execute failed: {}", e)))?;

        let result_str = Self::read_string_from_memory(&store, &memory, result_ptr)?;

        deallocate
            .call(&mut store, (cap_ptr, cap_json.len() as i32))
            .map_err(|e| WeaveError::WasmRuntimeError(format!("deallocate failed: {}", e)))?;
        deallocate
            .call(&mut store, (params_ptr, params_json.len() as i32))
            .map_err(|e| WeaveError::WasmRuntimeError(format!("deallocate failed: {}", e)))?;
        deallocate
            .call(&mut store, (result_ptr, result_str.len() as i32))
            .map_err(|e| WeaveError::WasmRuntimeError(format!("deallocate failed: {}", e)))?;

        let value: Value = serde_json::from_str(&result_str)
            .map_err(|e| WeaveError::Serialization(format!(
                "Failed to parse WASM result as JSON: {}. Result: {}",
                e, result_str
            )))?;

        Ok(value)
    }

    fn write_string_to_memory(
        store: &mut Store<wasmtime_wasi::preview1::WasiP1Ctx>,
        memory: &Memory,
        allocate: &TypedFunc<i32, i32>,
        s: &str,
    ) -> Result<i32, WeaveError> {
        let bytes = s.as_bytes();
        let len = bytes.len() as i32;
        let ptr = allocate.call(&mut *store, len).map_err(|e| {
            WeaveError::WasmAbiError {
                detail: format!("allocate call failed: {}", e),
            }
        })?;
        memory.write(store, ptr as usize, bytes).map_err(|e| {
            WeaveError::WasmAbiError {
                detail: format!("memory write failed: {}", e),
            }
        })?;
        Ok(ptr)
    }

    fn read_string_from_memory(
        store: &Store<wasmtime_wasi::preview1::WasiP1Ctx>,
        memory: &Memory,
        ptr: i32,
    ) -> Result<String, WeaveError> {
        let mut bytes = Vec::new();
        let mut offset = ptr as usize;
        loop {
            let mut buf = [0u8; 1];
            memory.read(store, offset, &mut buf).map_err(|e| {
                WeaveError::WasmAbiError {
                    detail: format!("memory read failed: {}", e),
                }
            })?;
            if buf[0] == 0 {
                break;
            }
            bytes.push(buf[0]);
            offset += 1;
        }
        String::from_utf8(bytes).map_err(|e| {
            WeaveError::WasmAbiError {
                detail: format!("invalid UTF-8 in WASM result: {}", e),
            }
        })
    }
}
