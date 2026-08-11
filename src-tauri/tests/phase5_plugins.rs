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
