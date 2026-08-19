//! Phase 5 core scenarios for the Phase 2 agent loop: a mock OpenAI-compatible
//! SSE provider round-trips a native tool call through the real ai_bridge →
//! agent loop → approval gate → plugin execution → completion-rule machinery.
//! Verified end-to-end, not by inspection.
//!
//! Scenarios: approved/rejected/errored sensitive call + plain-text turn.
//! Per-plugin migration tests live in tests/phase5_plugins.rs.

mod common;

use common::{
    assert_completion_rule, ask_user_script, plain_text_script, round_trip, saw_approval,
    second_request_body, ApprovalDecision, Harness, PluginManager,
};
use weave::agent::AgentEvent;

// ---------------------------------------------------------------------------
// Scenario 5: reserved weave.ask_user native tool (replaces the old
// hand-rolled <questions> XML protocol). It must pause the turn, surface a
// QuestionsAsked card, receive the user's answers as its tool result, and
// continue the loop without ever hitting the approval gate.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn ask_user_native_tool_pauses_and_continues() {
    let harness = Harness::new(ask_user_script("Done.")).await;
    let (final_text, events) = harness
        .run_loop_with_question_answers(vec![vec!["a".to_string()]])
        .await;

    // 1. The model's ask_user call surfaced as a QuestionsAsked card.
    assert!(events.iter().any(|e| matches!(e, AgentEvent::QuestionsAsked { .. })));

    // 2. ask_user is a first-class native tool advertised in request 1.
    let safe_name = PluginManager::provider_tool_name(PluginManager::ASK_USER_CAPABILITY);
    assert!(
        harness.bodies()[0].contains(&format!("{}", safe_name)),
        "request 1 must advertise the reserved ask_user tool"
    );

    // 3. It must NOT hit the approval gate (asking the user is not a side effect).
    assert!(
        !saw_approval(&events, PluginManager::ASK_USER_CAPABILITY),
        "ask_user must never trigger the approval gate"
    );

    // 4. Completion rule: the second request pairs a tool result for the
    //    ask_user call carrying the user's answer.
    let second = &harness.bodies()[1];
    assert!(second.contains("\"tool_call_id\":\"call_p\""), "ask_user result must be paired");
    assert!(second.contains("Which plan?"), "result must carry the question");
    assert!(second.contains(": A: a"), "result must carry the user's answer");
    // 5. The loop continued after the answers and completed.
    assert!(final_text.contains("Done."), "loop must continue after ask_user");
    assert_completion_rule(second);

    // 6. Protocol-level: no hand-written <questions> XML lives in the request.
    assert!(
        !harness.bodies().iter().any(|b| b.contains("<questions")),
        "native tool-calling must replace the old XML questions protocol"
    );
}

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
    let safe_name = PluginManager::provider_tool_name("file.read");
    assert!(
        rt.bodies[0].contains(&format!("\"name\":\"{}\"", safe_name)),
        "tools must advertise file.read with a provider-safe name"
    );

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

    // 5. Protocol-level completion-rule proof for the success path too.
    assert_completion_rule(second);
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
