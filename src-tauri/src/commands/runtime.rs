use tauri::State;

use crate::AppState;
use crate::utils::errors::WeaveError;
use runtime_kernel::observability::ObservabilityMetrics;

/// On-demand snapshot of runtime observability metrics for the frontend.
#[tauri::command]
pub fn runtime_get_observability(
    app_state: State<'_, AppState>,
) -> Result<ObservabilityMetrics, WeaveError> {
    Ok(app_state.observability.snapshot())
}
