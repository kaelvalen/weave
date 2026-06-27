use std::path::PathBuf;
use weave::models::manifest::Manifest;
use weave::models::plugin::{PluginState, RuntimeType};
use weave::runtime::python::PythonRuntime;

#[test]
fn test_python_plugin_load_and_execute() {
    let manifest_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/plugins/echo_python/manifest.toml");
    let plugin_dir = manifest_path.parent().unwrap().to_path_buf();
    let content = std::fs::read_to_string(&manifest_path).unwrap();
    let manifest = Manifest::from_toml(&content).unwrap();
    let mut plugin = manifest.to_plugin(Some(plugin_dir), false);
    plugin.state = PluginState::Discovered;

    let runtime = PythonRuntime::new().unwrap();
    runtime.load(&plugin).unwrap();

    let params = serde_json::json!({"message": "hello"});
    let result = runtime.execute(&plugin, "echo.echo", params).unwrap();

    assert_eq!(result["capability"], "echo.echo");
    assert_eq!(result["message"], "hello");
}
