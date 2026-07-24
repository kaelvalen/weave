use serde_json::{json, Value};
use tokio::sync::broadcast;
use tracing::info;

use crate::models::plugin::PluginExecutor;
use crate::utils::errors::WeaveError;

pub struct CanvasPlugin {
    pub canvas_tx: broadcast::Sender<Value>,
}

impl PluginExecutor for CanvasPlugin {
    fn execute(
        &self,
        capability: &str,
        params: Value,
        _ctx: &runtime_kernel::execution_context::ExecutionContext,
    ) -> Result<Value, WeaveError> {
        match capability {
            "canvas.add_node" => self.add_node(params),
            "canvas.update_node" => self.update_node(params),
            "canvas.delete_node" => self.delete_node(params),
            "canvas.connect_nodes" => self.connect_nodes(params),
            "canvas.clear" => self.clear(),
            "canvas.export" => self.export(),
            "canvas.import" => self.import(),
            _ => Err(WeaveError::CapabilityNotFound(capability.to_string())),
        }
    }
}

impl CanvasPlugin {
    fn add_node(&self, params: Value) -> Result<Value, WeaveError> {
        let node_type = params
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("shapeNode");
        let data = params.get("data").cloned().unwrap_or(json!({}));
        let position = params.get("position").cloned();

        let id = format!(
            "ai_node_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        );

        let payload = json!({
            "action": "add_node",
            "payload": {
                "id": id,
                "type": node_type,
                "data": data,
                "position": position
            }
        });

        if let Err(e) = self.canvas_tx.send(payload.clone()) {
            tracing::warn!("Failed to send canvas action: {}", e);
        } else {
            info!("Emitted canvas add_node event");
        }

        Ok(json!({
            "success": true,
            "message": "Node added to canvas",
            "id": id
        }))
    }

    fn update_node(&self, params: Value) -> Result<Value, WeaveError> {
        let id = params
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'id' parameter".to_string()))?;

        let data = params.get("data").cloned().unwrap_or(json!({}));

        let payload = json!({
            "action": "update_node",
            "payload": {
                "id": id,
                "data": data
            }
        });

        if let Err(e) = self.canvas_tx.send(payload.clone()) {
            tracing::warn!("Failed to send canvas action: {}", e);
        } else {
            info!("Emitted canvas update_node event for {}", id);
        }

        Ok(json!({
            "success": true,
            "message": format!("Node {} updated", id)
        }))
    }

    fn delete_node(&self, params: Value) -> Result<Value, WeaveError> {
        let id = params
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'id' parameter".to_string()))?;

        let payload = json!({
            "action": "delete_node",
            "payload": {
                "id": id
            }
        });

        if let Err(e) = self.canvas_tx.send(payload.clone()) {
            tracing::warn!("Failed to send canvas action: {}", e);
        } else {
            info!("Emitted canvas delete_node event for {}", id);
        }

        Ok(json!({
            "success": true,
            "message": format!("Node {} deleted", id)
        }))
    }

    fn connect_nodes(&self, params: Value) -> Result<Value, WeaveError> {
        let source = params
            .get("source")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'source' parameter".to_string()))?;
        let target = params
            .get("target")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'target' parameter".to_string()))?;
        let label = params.get("label").and_then(|v| v.as_str()).unwrap_or("");

        let id = format!("ai_edge_{}_{}", source, target);
        let payload = json!({
            "action": "connect_nodes",
            "payload": {
                "id": id,
                "source": source,
                "target": target,
                "label": label
            }
        });

        if let Err(e) = self.canvas_tx.send(payload.clone()) {
            tracing::warn!("Failed to send canvas action: {}", e);
        } else {
            info!(
                "Emitted canvas connect_nodes event from {} to {}",
                source, target
            );
        }

        Ok(json!({
            "success": true,
            "message": format!("Connected node {} to {}", source, target),
            "edge_id": id
        }))
    }

    fn clear(&self) -> Result<Value, WeaveError> {
        let payload = json!({
            "action": "clear",
            "payload": {}
        });

        if let Err(e) = self.canvas_tx.send(payload.clone()) {
            tracing::warn!("Failed to send canvas action: {}", e);
        } else {
            info!("Emitted canvas clear event");
        }

        Ok(json!({
            "success": true,
            "message": "Canvas cleared"
        }))
    }

    fn export(&self) -> Result<Value, WeaveError> {
        let payload = json!({
            "action": "export",
            "payload": {}
        });

        if let Err(e) = self.canvas_tx.send(payload.clone()) {
            tracing::warn!("Failed to send canvas action: {}", e);
        } else {
            info!("Emitted canvas export event");
        }

        Ok(json!({
            "success": true,
            "message": "Export dialog opened"
        }))
    }

    fn import(&self) -> Result<Value, WeaveError> {
        let payload = json!({
            "action": "import",
            "payload": {}
        });

        if let Err(e) = self.canvas_tx.send(payload.clone()) {
            tracing::warn!("Failed to send canvas action: {}", e);
        } else {
            info!("Emitted canvas import event");
        }

        Ok(json!({
            "success": true,
            "message": "Import dialog opened"
        }))
    }
}
