use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubGoal {
    pub id: String,
    pub description: String,
    pub intent: String,
    pub preconditions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoalAnalysis {
    pub raw_goal: String,
    pub primary_intent: String,
    pub sub_goals: Vec<SubGoal>,
}

pub struct GoalAnalyzer;

impl GoalAnalyzer {
    pub fn new() -> Self {
        Self
    }

    pub fn analyze(&self, goal: &str) -> GoalAnalysis {
        let lower = goal.to_lowercase();
        let mut sub_goals = Vec::new();

        if lower.contains("search") || lower.contains("find") {
            sub_goals.push(SubGoal {
                id: "sub-1".into(),
                description: "Search workspace or memory for target files or records".into(),
                intent: "search".into(),
                preconditions: vec![],
            });
        }

        if lower.contains("read") || lower.contains("open") || lower.contains("show") || lower.contains("summarize") {
            let pre = if sub_goals.is_empty() { vec![] } else { vec!["sub-1".to_string()] };
            sub_goals.push(SubGoal {
                id: "sub-2".into(),
                description: "Read document content or code files".into(),
                intent: "read".into(),
                preconditions: pre,
            });
        }

        if lower.contains("write") || lower.contains("save") || lower.contains("create") {
            let pre = if sub_goals.is_empty() { vec![] } else { vec!["sub-2".to_string()] };
            sub_goals.push(SubGoal {
                id: "sub-3".into(),
                description: "Write content to disk or create notes".into(),
                intent: "write".into(),
                preconditions: pre,
            });
        }

        if lower.contains("calc") || lower.contains("math") || lower.contains("convert") {
            sub_goals.push(SubGoal {
                id: "sub-4".into(),
                description: "Perform mathematical evaluation or unit conversion".into(),
                intent: "calc".into(),
                preconditions: vec![],
            });
        }

        if sub_goals.is_empty() {
            sub_goals.push(SubGoal {
                id: "sub-1".into(),
                description: "General execution query".into(),
                intent: "read".into(),
                preconditions: vec![],
            });
        }

        let primary_intent = sub_goals.first().map(|s| s.intent.clone()).unwrap_or_else(|| "read".into());

        GoalAnalysis {
            raw_goal: goal.to_string(),
            primary_intent,
            sub_goals,
        }
    }
}
