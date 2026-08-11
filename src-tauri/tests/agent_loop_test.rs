//! Phase 5 core scenarios for the Phase 2 agent loop: a mock OpenAI-compatible
//! SSE provider round-trips a native tool call through the real ai_bridge →
//! agent loop → approval gate → plugin execution → completion-rule machinery.
//! Verified end-to-end, not by inspection.
//!
//! Scenarios: approved/rejected/errored sensitive call + plain-text turn.
//! Per-plugin migration tests live in tests/phase5_plugins.rs.

mod common;

use common::{
    plain_text_script, round_trip, saw_approval, second_request_body, ApprovalDecision, Harness,
};
use weave::agent::AgentEvent;

// ---------------------------------------------------------------------------
// Scenario 1: approved sensitive call — tool result paired, loop continues
// ---------------------------------------------------------------------------

#[tokio::test]
async fn approved_sensitive_call_round_trips_with_paired_result() {
    let rt = round_trip(
        "file.read",
        r#"{"path":"src/main.rs"}"#,
        ApprovalDecision::Approved,
    )
    .await;

    // 1. The approval gate fired for the sensitive capability.
    assert!(
        saw_approval(&rt.events, "file.read"),
        "approval gate must fire for sensitive capability file.read"
    );

    // 2. The first request carried native tools with the file.read schema.
    assert!(rt.bodies[0].contains("\"tools\""), "request 1 must include tools");
    assert!(rt.bodies[0].contains("\"file.read\""), "tools must advertise file.read");

    // 3. Completion rule: the second request pairs a tool result with call_p.
    let second = second_request_body(&rt);
    assert!(second.contains("\"role\":\"tool\""), "second request must contain a tool-role message");
    assert!(second.contains("\"tool_call_id\":\"call_p\""), "tool result must be paired");

    // 4. The plugin actually executed (file.read read a real file) and the
    //    loop continued to the final turn.
    assert!(
        rt.final_text.contains("Done."),
        "loop must continue after tool execution, got: {}",
        rt.final_text
    );
}

// ---------------------------------------------------------------------------
// Scenario 2: rejected sensitive call — still produces a paired result
// ---------------------------------------------------------------------------

#[tokio::test]
async fn rejected_sensitive_call_still_pairs_result() {
    let rt = round_trip(
        "file.read",
        r#"{"path":"src/main.rs"}"#,
        ApprovalDecision::Rejected,
    )
    .await;

    let second = second_request_body(&rt);
    assert!(
        second.contains("\"tool_call_id\":\"call_p\""),
        "rejected call must still get a paired tool result"
    );
    assert!(
        second.contains("User denied this action."),
        "rejected result must carry the denial text"
    );
}

// ---------------------------------------------------------------------------
// Scenario 3: plugin execution error — error result still paired
// ---------------------------------------------------------------------------

#[tokio::test]
async fn errored_plugin_call_still_pairs_result() {
    let rt = round_trip(
        "file.read",
        r#"{"path":"does_not_exist_12345.txt"}"#,
        ApprovalDecision::Approved,
    )
    .await;

    let second = second_request_body(&rt);
    assert!(
        second.contains("\"tool_call_id\":\"call_p\""),
        "errored call must still get a paired tool result"
    );
    assert!(
        second.contains("[Error]"),
        "errored result must carry the plugin error text"
    );
}

// ---------------------------------------------------------------------------
// Scenario 4: no tool calls → single turn, no approval events
// ---------------------------------------------------------------------------

#[tokio::test]
async fn plain_text_turn_never_gates() {
    let harness = Harness::new(plain_text_script("Hello from mock.")).await;
    let (final_text, events) = harness.run_loop(ApprovalDecision::Approved).await;

    assert!(final_text.contains("Hello from mock."));
    assert!(
        !events
            .iter()
            .any(|e| matches!(e, AgentEvent::PendingApproval { .. })),
        "no tool calls means no approval gate"
    );
    assert_eq!(harness.bodies().len(), 1, "no re-request without tool calls");
}
