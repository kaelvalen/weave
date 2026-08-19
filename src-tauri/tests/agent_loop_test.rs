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
    second_request_body, tool_call_script, ApprovalDecision, Harness, PluginManager,
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

// ---------------------------------------------------------------------------
// Scenario 6: a hung tool execution is cut off by the guard timeout instead
// of stalling the agent-loop worker forever (DSH guard / loop-hygiene pattern).
// The executor sleeps far longer than the (shortened) per-tool timeout; the
// loop must surface "timed out", still pair a completion-rule result, and
// continue — all within a fraction of the hang.
// ---------------------------------------------------------------------------

use std::sync::atomic::Ordering;
use serde_json::Value;
use weave::models::plugin::{
    Capabilities, Plugin, PluginCategory, PluginState, PluginUiConfig, RuntimeConfig,
    RuntimeType, SandboxLevel, UiType, PluginExecutor,
};
use weave::utils::errors::WeaveError;

/// An executor that blocks much longer than the test's (shortened) tool
/// timeout. The guard must cut it off rather than let it stall the turn.
struct HangingPlugin;
impl PluginExecutor for HangingPlugin {
    fn execute(
        &self,
        _capability: &str,
        _params: Value,
        _ctx: &runtime_kernel::execution_context::ExecutionContext,
    ) -> Result<Value, WeaveError> {
        std::thread::sleep(std::time::Duration::from_secs(30));
        Ok(Value::Null)
    }
}

fn slow_plugin_fixture() -> Plugin {
    let mut capabilities = Capabilities::default();
    capabilities.provide.push("slow.echo".to_string());
    capabilities
        .schemas
        .insert("slow.echo".into(), serde_json::json!({"type": "object", "properties": {}}));
    Plugin {
        id: "com.weave.test.slow".into(),
        name: "Slow".into(),
        version: "0.0.0".into(),
        author: "test".into(),
        description: String::new(),
        capabilities,
        runtime: RuntimeConfig {
            runtime_type: RuntimeType::Builtin,
            entry: String::new(),
            sandbox: SandboxLevel::Strict,
        },
        ui: PluginUiConfig {
            ui_type: UiType::None,
            entry: String::new(),
        },
        state: PluginState::Active,
        path: None,
        is_builtin: false,
        category: PluginCategory::System,
    }
}

#[tokio::test]
async fn hung_tool_execution_is_timed_out_not_never() {
    let harness = Harness::new(tool_call_script("slow.echo", r#"{}"#, "Done.")).await;
    // Shorten the per-tool timeout so this test runs fast; the guard must cut
    // the 30s hang short (in ~200ms) rather than waiting it out.
    harness.loop_.tool_timeout_ms.store(200, Ordering::SeqCst);
    harness
        .loop_
        .plugin_manager
        .register_plugin(slow_plugin_fixture(), Box::new(HangingPlugin));

    let start = std::time::Instant::now();
    let (final_text, _events) = harness.run_loop(ApprovalDecision::Approved).await;
    let elapsed = start.elapsed();

    // 1. The loop continued after the timed-out tool.
    assert!(final_text.contains("Done."), "loop must continue after a timed-out tool");
    // 2. The timeout is reported back to the model as an error...
    let second = &harness.bodies()[1];
    assert!(second.contains("timed out"), "tool result must report the timeout, got: {}", second);
    assert!(second.contains("slow.echo"), "the timeout message must name the capability");
    // 3. ...and the completion rule still holds (paired result).
    assert_completion_rule(second);
    // 4. The whole turn finished far sooner than the 30s hang.
    assert!(
        elapsed < std::time::Duration::from_secs(5),
        "timeout guard must cut the hang short (took {:?})",
        elapsed
    );
}
