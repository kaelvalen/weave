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
        second.contains("[Error]") && second.contains("workspace"),
        "workspace confinement must reject /etc/passwd (got: {})",
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
        "git confinement must reject /tmp (got: {})",
        second
    );
}
