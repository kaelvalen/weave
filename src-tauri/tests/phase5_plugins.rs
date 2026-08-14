//! Phase-5 per-plugin migration tests (Phase 3).
//!
//! Each KEEP-tagged plugin gets a spine round-trip test: the mock provider
//! requests the capability via native tool-calling, the agent loop executes
//! it through the plugin registry, and the second request body must carry the
//! paired tool result (completion rule) — proving the plugin's migrated path
//! end-to-end.

mod common;

use common::{
    round_trip, saw_approval, second_request_body, ApprovalDecision, Harness,
};
use std::sync::Mutex;

// ---------------------------------------------------------------------------
// calc_plugin — no external side effects, no approval gate
// ---------------------------------------------------------------------------

#[tokio::test]
async fn calc_eval_round_trips_through_spine() {
    let rt = round_trip("calc.eval", r#"{"expression":"2+2*3"}"#, ApprovalDecision::Approved)
        .await;

    // Not sensitive/destructive: the gate must NOT fire.
    assert!(!saw_approval(&rt.events, "calc.eval"));
    // The plugin executed and its result reached the provider as a paired
    // tool result.
    let second = second_request_body(&rt);
    assert!(second.contains("\"tool_call_id\":\"call_p\""));
    assert!(
        second.contains("8"),
        "calc.eval result (8) must appear in the paired tool result"
    );
    assert!(rt.final_text.contains("Done."));
}

#[tokio::test]
async fn calc_convert_and_stats_round_trip() {
    for (cap, args, needle) in [
        ("calc.convert", r#"{"value":100,"from":"km","to":"miles"}"#, "62.1"),
        ("calc.stats", r#"{"numbers":[1,2,3]}"#, "2"),
    ] {
        let rt = round_trip(cap, args, ApprovalDecision::Approved).await;
        assert!(!saw_approval(&rt.events, cap), "{} must not require approval", cap);
        assert!(
            second_request_body(&rt).contains(needle),
            "{} result should contain {}",
            cap,
            needle
        );
    }
}

// ---------------------------------------------------------------------------
// file_plugin — hardened in Phase 1 (fs_security), migrated schemas here.
// read/list/search are sensitive → approval gate must fire.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn file_read_round_trips_with_gate() {
    let rt = round_trip("file.read", r#"{"path":"src/main.rs"}"#, ApprovalDecision::Approved)
        .await;
    assert!(saw_approval(&rt.events, "file.read"), "file.read is sensitive");
    assert!(
        second_request_body(&rt).contains("fn main"),
        "file.read must return the real file content"
    );
}

#[tokio::test]
async fn file_write_round_trips_with_gate_and_confinement() {
    let rt = round_trip(
        "file.write",
        r#"{"path":"target/phase5_write.txt","content":"phase5 marker"}"#,
        ApprovalDecision::Approved,
    )
    .await;
    assert!(saw_approval(&rt.events, "file.write"), "file.write is destructive");
    let second = second_request_body(&rt);
    // The tool result is a JSON string inside the request body, so its quotes
    // are escaped (\"bytes_written\":13).
    assert!(
        second.contains("bytes_written") && second.contains("13"),
        "write must report bytes: {}",
        second
    );
    assert!(
        std::fs::read_to_string("target/phase5_write.txt").unwrap().contains("phase5 marker"),
        "file must actually exist in the workspace"
    );
}

#[tokio::test]
async fn file_list_round_trips_with_gate() {
    let rt = round_trip("file.list", r#"{"directory":"."}"#, ApprovalDecision::Approved).await;
    assert!(saw_approval(&rt.events, "file.list"), "file.list is sensitive");
    assert!(
        second_request_body(&rt).contains("Cargo.toml"),
        "listing the workspace root must include Cargo.toml"
    );
}

#[tokio::test]
async fn file_path_outside_workspace_is_denied_and_still_paired() {
    let rt = round_trip(
        "file.read",
        r#"{"path":"/etc/passwd"}"#,
        ApprovalDecision::Approved,
    )
    .await;
    let second = second_request_body(&rt);
    assert!(
        second.contains("[Error]") && second.contains("denied"),
        "workspace confinement must reject /etc/passwd even when approved (got: {})",
        second
    );
}

// ---------------------------------------------------------------------------
// git_plugin — hardened in Phase 1 (fs_security), migrated schemas here.
// reads are sensitive → approval gate must fire.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn git_status_and_log_round_trip_with_gate() {
    for (cap, args, needle) in [
        ("git.status", r#"{"directory":"."}"#, "is_repo"),
        // "limit" only appears in git.log's result payload ({"log":..,"limit":5,..}).
        ("git.log", r#"{"directory":"."}"#, "limit"),
    ] {
        let rt = round_trip(cap, args, ApprovalDecision::Approved).await;
        assert!(saw_approval(&rt.events, cap), "{} is sensitive", cap);
        assert!(
            second_request_body(&rt).contains(needle),
            "{} result should contain {}",
            cap,
            needle
        );
    }
}

#[tokio::test]
async fn git_directory_outside_workspace_is_denied_and_still_paired() {
    let rt = round_trip(
        "git.status",
        r#"{"directory":"/tmp"}"#,
        ApprovalDecision::Approved,
    )
    .await;
    let second = second_request_body(&rt);
    assert!(
        second.contains("[Error]") && second.contains("workspace"),
        "git confinement must reject /tmp even when approved (got: {})",
        second
    );
}

// ---------------------------------------------------------------------------
// sqlite_plugin — hardened in Phase 1 (fs_security), migrated schemas here.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn db_query_round_trips_with_gate() {
    let rt = round_trip(
        "db.query",
        r#"{"query":"SELECT 1","db_path":"target/phase5_test.db"}"#,
        ApprovalDecision::Approved,
    )
    .await;
    assert!(saw_approval(&rt.events, "db.query"), "db.query is sensitive");
    let second = second_request_body(&rt);
    assert!(second.contains("1"), "SELECT 1 must return 1 in the paired result");
}

#[tokio::test]
async fn db_execute_and_tables_round_trip() {
    let rt = round_trip(
        "db.execute",
        r#"{"statement":"CREATE TABLE IF NOT EXISTS t5 (id INTEGER)","db_path":"target/phase5_test.db"}"#,
        ApprovalDecision::Approved,
    )
    .await;
    assert!(saw_approval(&rt.events, "db.execute"), "db.execute is destructive");
    assert!(
        second_request_body(&rt).contains("executed successfully"),
        "db.execute must report success"
    );

    let rt = round_trip(
        "db.tables",
        r#"{"db_path":"target/phase5_test.db"}"#,
        ApprovalDecision::Approved,
    )
    .await;
    assert!(saw_approval(&rt.events, "db.tables"), "db.tables is sensitive");
    assert!(
        second_request_body(&rt).contains("t5"),
        "db.tables must list the created table"
    );
}

// ---------------------------------------------------------------------------
// http_plugin / web_plugin — hardened in Phase 1 (ssrf.rs), migrated schemas
// here. The SSRF guard rejects loopback targets; that rejection must flow
// through the spine as a paired error result (never a dangling call_id).
// ---------------------------------------------------------------------------

#[tokio::test]
async fn web_fetch_loopback_is_blocked_and_paired() {
    let rt = round_trip(
        "web.fetch",
        r#"{"url":"http://127.0.0.1:9/secret"}"#,
        ApprovalDecision::Approved,
    )
    .await;
    assert!(saw_approval(&rt.events, "web.fetch"), "web.fetch is sensitive");
    let second = second_request_body(&rt);
    assert!(
        second.contains("[Error]") && second.contains("private or reserved"),
        "SSRF guard must reject loopback fetch (got: {})",
        second
    );
}

#[tokio::test]
async fn http_request_loopback_is_blocked_and_paired() {
    let rt = round_trip(
        "http.request",
        r#"{"url":"http://127.0.0.1:9/api","method":"GET"}"#,
        ApprovalDecision::Approved,
    )
    .await;
    assert!(saw_approval(&rt.events, "http.request"), "http.request is sensitive");
    let second = second_request_body(&rt);
    assert!(
        second.contains("[Error]") && second.contains("private or reserved"),
        "SSRF guard must reject loopback request (got: {})",
        second
    );
}

// ---------------------------------------------------------------------------
// shell_plugin — destructive; the approval gate MUST fire before execution
// under the spine, and the command only runs after approval.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn shell_exec_gate_fires_before_enabling() {
    let rt = round_trip(
        "shell.exec",
        r#"{"command":"echo weave-shell-ok"}"#,
        ApprovalDecision::Approved,
    )
    .await;
    assert!(
        saw_approval(&rt.events, "shell.exec"),
        "shell.exec is destructive — the gate must fire before enabling"
    );
    let second = second_request_body(&rt);
    assert!(
        second.contains("weave-shell-ok"),
        "approved shell command must execute and its output must be paired"
    );
}

#[tokio::test]
async fn shell_exec_rejected_never_runs() {
    let rt = round_trip(
        "shell.exec",
        r#"{"command":"touch target/phase5_should_not_exist.txt"}"#,
        ApprovalDecision::Rejected,
    )
    .await;
    assert!(saw_approval(&rt.events, "shell.exec"));
    assert!(
        second_request_body(&rt).contains("User denied this action."),
        "rejection must still pair a result"
    );
    assert!(
        !std::path::Path::new("target/phase5_should_not_exist.txt").exists(),
        "rejected command must never execute"
    );
}

// ---------------------------------------------------------------------------
// note / memory / workflow — persist under ~/.weave; tests isolate HOME into
// a temp dir. None are sensitive/destructive, so no approval is expected.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn storage_plugins_round_trip_with_isolated_home() {
    let home = std::env::temp_dir().join(format!("weave_phase5_home_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&home).unwrap();
    std::env::set_var("HOME", &home);

    for (cap, args, needle, gated) in [
        ("note.create", r#"{"title":"phase5 note","content":"hello"}"#, "success", false),
        // memory.store and workflow.create mutate persistent state →
        // destructive, gated.
        ("memory.store", r#"{"key":"phase5_key","content":"phase5 value"}"#, "created", true),
        ("workflow.create", r#"{"name":"phase5 workflow"}"#, "success", true),
    ] {
        let rt = round_trip(cap, args, ApprovalDecision::Approved).await;
        assert_eq!(saw_approval(&rt.events, cap), gated, "{} gating mismatch", cap);
        assert!(
            second_request_body(&rt).contains(needle),
            "{} result should contain {}",
            cap,
            needle
        );
    }

    // The isolated home must actually hold the persisted data.
    assert!(
        std::fs::read_dir(home.join(".weave").join("notes")).map(|mut d| d.next().is_some()).unwrap_or(false),
        "note must be persisted under the isolated HOME"
    );
    assert!(
        std::fs::read_to_string(home.join(".weave").join("memory.json"))
            .map(|c| c.contains("phase5_key"))
            .unwrap_or(false),
        "memory must be persisted under the isolated HOME"
    );

    let _ = std::fs::remove_dir_all(&home);
}

// ---------------------------------------------------------------------------
// canvas_plugin / sys_plugin — no storage, no approval.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn canvas_and_sys_round_trip_with_gate() {
    // canvas.add_node mutates the shared board → destructive, gated.
    let rt = round_trip(
        "canvas.add_node",
        r#"{"type":"shapeNode","data":{"label":"n1"}}"#,
        ApprovalDecision::Approved,
    )
    .await;
    assert!(saw_approval(&rt.events, "canvas.add_node"), "canvas.add_node is destructive");
    assert!(second_request_body(&rt).contains("success"));

    for (cap, args, needle) in [
        ("sys.time", r#"{}"#, "iso_8601"),
        ("sys.info", r#"{}"#, "hostname"),
    ] {
        let rt = round_trip(cap, args, ApprovalDecision::Approved).await;
        assert!(!saw_approval(&rt.events, cap), "{} must not require approval", cap);
        assert!(
            second_request_body(&rt).contains(needle),
            "{} result should contain {}",
            cap,
            needle
        );
    }
}

// ---------------------------------------------------------------------------
// coder_plugin — most complex plugin, migrated last. Reads are sensitive.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn coder_read_file_and_list_dir_round_trip_with_gate() {
    for (cap, args, needle) in [
        ("coder.read_file", r#"{"path":"src/main.rs"}"#, "fn main"),
        ("coder.list_dir", r#"{"path":"."}"#, "src-tauri"),
    ] {
        let rt = round_trip(cap, args, ApprovalDecision::Approved).await;
        assert!(saw_approval(&rt.events, cap), "{} is sensitive", cap);
        assert!(
            second_request_body(&rt).contains(needle),
            "{} result should contain {}",
            cap,
            needle
        );
    }
}

#[tokio::test]
async fn coder_symbols_and_search_round_trip() {
    let rt = round_trip(
        "coder.symbols",
        r#"{"path":"src-tauri/src/main.rs"}"#,
        ApprovalDecision::Approved,
    )
    .await;
    assert!(saw_approval(&rt.events, "coder.symbols"), "coder.symbols is sensitive");
    assert!(
        second_request_body(&rt).contains("main"),
        "symbols of main.rs must mention main"
    );
}
