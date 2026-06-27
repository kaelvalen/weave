use regex::Regex;
use serde_json::json;
use tracing::debug;

use crate::models::chat::IntentResult;
use crate::utils::errors::WeaveError;

pub struct IntentEngine {
    patterns: Vec<IntentPattern>,
}

struct IntentPattern {
    intent: String,
    keywords: Vec<String>,
    regex_patterns: Vec<Regex>,
    suggested_plugins: Vec<String>,
    suggested_capabilities: Vec<String>,
    weight: f64,
}

impl IntentEngine {
    pub fn new() -> Self {
        let patterns = Self::build_patterns();
        Self { patterns }
    }

    fn build_patterns() -> Vec<IntentPattern> {
        vec![
            IntentPattern {
                intent: "file.read".to_string(),
                keywords: vec![
                    "read".to_string(), "open".to_string(), "show".to_string(),
                    "display".to_string(), "view".to_string(), "contents".to_string(),
                    "content of".to_string(), "what is in".to_string(),
                ],
                regex_patterns: vec![
                    Regex::new(r"(?i)(read|open|show|view)\s+(the\s+)?file").unwrap(),
                    Regex::new(r"(?i)(show|display)\s+(me\s+)?(the\s+)?contents?\s+(of\s+)?(.+)").unwrap(),
                    Regex::new(r"(?i)what\s+(is|are)\s+(in|inside)\s+(the\s+)?(file|folder|directory)").unwrap(),
                ],
                suggested_plugins: vec!["com.weave.builtin.file".to_string()],
                suggested_capabilities: vec!["file.read".to_string()],
                weight: 1.0,
            },
            IntentPattern {
                intent: "file.write".to_string(),
                keywords: vec![
                    "write".to_string(), "save".to_string(), "create file".to_string(),
                    "save to".to_string(), "write to".to_string(), "output".to_string(),
                ],
                regex_patterns: vec![
                    Regex::new(r"(?i)(write|save)\s+(this|that|it|content)\s+(to\s+)?(a\s+)?(file\s+)?").unwrap(),
                    Regex::new(r"(?i)create\s+(a\s+)?(new\s+)?file").unwrap(),
                ],
                suggested_plugins: vec!["com.weave.builtin.file".to_string()],
                suggested_capabilities: vec!["file.write".to_string()],
                weight: 1.0,
            },
            IntentPattern {
                intent: "file.list".to_string(),
                keywords: vec![
                    "list".to_string(), "files".to_string(), "directory".to_string(),
                    "folder".to_string(), "ls".to_string(), "dir".to_string(),
                    "show me the files".to_string(), "what files".to_string(),
                ],
                regex_patterns: vec![
                    Regex::new(r"(?i)(list|show)\s+(all\s+)?(the\s+)?files?").unwrap(),
                    Regex::new(r"(?i)(what|which)\s+files?\s+(are|is)\s+(in|there)").unwrap(),
                    Regex::new(r"(?i)ls\s+(.+)").unwrap(),
                ],
                suggested_plugins: vec!["com.weave.builtin.file".to_string()],
                suggested_capabilities: vec!["file.list".to_string()],
                weight: 1.0,
            },
            IntentPattern {
                intent: "file.search".to_string(),
                keywords: vec![
                    "find".to_string(), "search".to_string(), "locate".to_string(),
                    "look for".to_string(), "find file".to_string(), "where is".to_string(),
                ],
                regex_patterns: vec![
                    Regex::new(r"(?i)(find|search|locate)\s+(for\s+)?(the\s+)?(file\s+)?").unwrap(),
                    Regex::new(r"(?i)where\s+is\s+(the\s+)?(file\s+)?").unwrap(),
                ],
                suggested_plugins: vec!["com.weave.builtin.file".to_string()],
                suggested_capabilities: vec!["file.search".to_string()],
                weight: 1.0,
            },
            IntentPattern {
                intent: "calc.eval".to_string(),
                keywords: vec![
                    "calculate".to_string(), "compute".to_string(), "what is".to_string(),
                    "eval".to_string(), "math".to_string(), "solve".to_string(),
                    "sum".to_string(), "product".to_string(), "divide".to_string(),
                    "multiply".to_string(), "add".to_string(), "subtract".to_string(),
                    "sqrt".to_string(), "sin".to_string(), "cos".to_string(),
                    "log".to_string(), "ln".to_string(), "power".to_string(),
                ],
                regex_patterns: vec![
                    Regex::new(r"(?i)(calculate|compute|eval(uate)?)\s+(.+)").unwrap(),
                    Regex::new(r"(?i)what\s+is\s+([0-9\+\-\*\/\^\(\)\.\s]+)").unwrap(),
                    Regex::new(r"(?i)([0-9]+\s*[\+\-\*\/\^]\s*)+[0-9]+").unwrap(),
                    Regex::new(r"(?i)sqrt\s*\(\s*[0-9]+\s*\)").unwrap(),
                ],
                suggested_plugins: vec!["com.weave.builtin.calc".to_string()],
                suggested_capabilities: vec!["calc.eval".to_string()],
                weight: 1.0,
            },
            IntentPattern {
                intent: "calc.convert".to_string(),
                keywords: vec![
                    "convert".to_string(), "to".to_string(), "from".to_string(),
                    "km".to_string(), "miles".to_string(), "kg".to_string(),
                    "pounds".to_string(), "celsius".to_string(), "fahrenheit".to_string(),
                    "inches".to_string(), "cm".to_string(), "feet".to_string(),
                    "meters".to_string(), "liters".to_string(), "gallons".to_string(),
                ],
                regex_patterns: vec![
                    Regex::new(r"(?i)(convert|change|transform)\s+([0-9]+\s*[a-zA-Z]+)\s+(to|into)\s+([a-zA-Z]+)").unwrap(),
                    Regex::new(r"(?i)([0-9]+)\s*(km|miles|kg|pounds|lbs?|celsius|fahrenheit|inches?|cm|feet?|meters?|liters?)\s+(in|to)\s+([a-zA-Z]+)").unwrap(),
                ],
                suggested_plugins: vec!["com.weave.builtin.calc".to_string()],
                suggested_capabilities: vec!["calc.convert".to_string()],
                weight: 1.0,
            },
            IntentPattern {
                intent: "note.create".to_string(),
                keywords: vec![
                    "note".to_string(), "take note".to_string(), "remember".to_string(),
                    "save note".to_string(), "write down".to_string(), "jot down".to_string(),
                    "create note".to_string(), "new note".to_string(),
                ],
                regex_patterns: vec![
                    Regex::new(r"(?i)(take\s+(a\s+)?note|write\s+down|jot\s+down)\s+(that\s+)?(.+)").unwrap(),
                    Regex::new(r"(?i)create\s+(a\s+)?(new\s+)?note").unwrap(),
                    Regex::new(r"(?i)remember\s+(that\s+)?(.+)").unwrap(),
                ],
                suggested_plugins: vec!["com.weave.builtin.note".to_string()],
                suggested_capabilities: vec!["note.create".to_string()],
                weight: 1.0,
            },
            IntentPattern {
                intent: "note.list".to_string(),
                keywords: vec![
                    "my notes".to_string(), "list notes".to_string(), "show notes".to_string(),
                    "all notes".to_string(), "saved notes".to_string(),
                ],
                regex_patterns: vec![
                    Regex::new(r"(?i)(show|list|display)\s+(me\s+)?(my\s+)?notes?").unwrap(),
                    Regex::new(r"(?i)what\s+notes?\s+do\s+i\s+have").unwrap(),
                ],
                suggested_plugins: vec!["com.weave.builtin.note".to_string()],
                suggested_capabilities: vec!["note.list".to_string()],
                weight: 1.0,
            },
            IntentPattern {
                intent: "note.delete".to_string(),
                keywords: vec![
                    "delete note".to_string(), "remove note".to_string(),
                    "trash note".to_string(), "discard note".to_string(),
                ],
                regex_patterns: vec![
                    Regex::new(r"(?i)(delete|remove|trash|discard)\s+(the\s+)?note").unwrap(),
                ],
                suggested_plugins: vec!["com.weave.builtin.note".to_string()],
                suggested_capabilities: vec!["note.delete".to_string()],
                weight: 1.0,
            },
            IntentPattern {
                intent: "analyze".to_string(),
                keywords: vec![
                    "analyze".to_string(), "analysis".to_string(), "process".to_string(),
                    "parse".to_string(), "extract".to_string(), "summarize".to_string(),
                ],
                regex_patterns: vec![
                    Regex::new(r"(?i)(analyze|process|parse)\s+(this|that|the|these)\s+(data|file|csv|json|log)").unwrap(),
                    Regex::new(r"(?i)(extract|summarize)\s+(data|info|information|insights?)").unwrap(),
                ],
                suggested_plugins: vec![
                    "com.weave.builtin.file".to_string(),
                ],
                suggested_capabilities: vec!["file.read".to_string()],
                weight: 0.7,
            },
            IntentPattern {
                intent: "workflow.chain".to_string(),
                keywords: vec![
                    "and then".to_string(), "workflow".to_string(), "chain".to_string(),
                    "pipeline".to_string(), "sequence".to_string(), "automate".to_string(),
                ],
                regex_patterns: vec![
                    Regex::new(r"(?i)(create|build|make)\s+(a\s+)?workflow").unwrap(),
                    Regex::new(r"(?i)chain\s+(these|the|multiple|several)").unwrap(),
                    Regex::new(r"(?i)(and\s+then|then\s+)").unwrap(),
                ],
                suggested_plugins: vec![],
                suggested_capabilities: vec![],
                weight: 0.8,
            },
        ]
    }

    pub fn recognize(&self, message: &str) -> Option<IntentResult> {
        debug!("Recognizing intent for: {}", message);
        
        let message_lower = message.to_lowercase();
        let mut best_match: Option<(String, f64, Vec<String>, Vec<String>)> = None;

        for pattern in &self.patterns {
            let mut score = 0.0;

            for keyword in &pattern.keywords {
                if message_lower.contains(keyword) {
                    score += 0.15 * pattern.weight;
                }
            }

            for regex in &pattern.regex_patterns {
                if regex.is_match(message) {
                    score += 0.4 * pattern.weight;
                    if let Some(captures) = regex.captures(message) {
                        let matched_text = captures.get(0)
                            .map(|m| m.as_str().to_string())
                            .unwrap_or_default();
                        if !matched_text.is_empty() {
                            score += 0.1;
                        }
                    }
                }
            }

            if score > 0.0 {
                if best_match.is_none() || score > best_match.as_ref().unwrap().1 {
                    best_match = Some((
                        pattern.intent.clone(),
                        score.min(1.0),
                        pattern.suggested_plugins.clone(),
                        pattern.suggested_capabilities.clone(),
                    ));
                }
            }
        }

        if let Some((intent, confidence, plugins, capabilities)) = best_match {
            if confidence >= 0.3 {
                let params = self.extract_params(message, &intent);
                
                debug!(
                    "Intent recognized: {} (confidence: {:.2}, plugins: {:?})",
                    intent, confidence, plugins
                );
                
                return Some(IntentResult {
                    intent,
                    confidence,
                    plugins,
                    params,
                });
            }
        }

        debug!("No intent recognized for message");
        None
    }

    fn extract_params(&self, message: &str, intent: &str) -> serde_json::Value {
        match intent {
            "file.read" | "file.write" | "file.search" => {
                let file_pattern = Regex::new(r"(?:file|path)\s+(?:named\s+)?[`\"']?([^`'\"\s\n]+)[`\"']?").unwrap();
                if let Some(caps) = file_pattern.captures(message) {
                    if let Some(matched) = caps.get(1) {
                        return json!({ "path": matched.as_str() });
                    }
                }
                
                let general_pattern = Regex::new(r"[`\"']([^`'\"]+)[`\"']").unwrap();
                if let Some(caps) = general_pattern.captures(message) {
                    if let Some(matched) = caps.get(1) {
                        return json!({ "path": matched.as_str() });
                    }
                }
                json!({})
            }
            "file.list" => {
                let dir_pattern = Regex::new(r"(?:in|from|under)\s+[`\"']?([^`'\"\s]+)[`\"']?").unwrap();
                if let Some(caps) = dir_pattern.captures(message) {
                    if let Some(matched) = caps.get(1) {
                        return json!({ "directory": matched.as_str() });
                    }
                }
                json!({ "directory": "." })
            }
            "calc.eval" => {
                let expr_pattern = Regex::new(r"(?:calculate|compute|eval(?:uate)?|what is)\s+(.+?)(?:\?|$)").unwrap();
                if let Some(caps) = expr_pattern.captures(message) {
                    if let Some(matched) = caps.get(1) {
                        return json!({ "expression": matched.as_str().trim() });
                    }
                }
                json!({})
            }
            "calc.convert" => {
                let conv_pattern = Regex::new(r"([0-9]+\.?[0-9]*)\s*([a-zA-Z]+)\s+(?:to|in)\s+([a-zA-Z]+)").unwrap();
                if let Some(caps) = conv_pattern.captures(message) {
                    let value = caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                    let from = caps.get(2).map(|m| m.as_str().to_string()).unwrap_or_default();
                    let to = caps.get(3).map(|m| m.as_str().to_string()).unwrap_or_default();
                    return json!({
                        "value": value.parse::<f64>().unwrap_or(0.0),
                        "from": from,
                        "to": to
                    });
                }
                json!({})
            }
            "note.create" => {
                let title_pattern = Regex::new(r"(?:titled|named|called)\s+[`\"']([^`'\"]+)[`\"']").unwrap();
                let title = if let Some(caps) = title_pattern.captures(message) {
                    caps.get(1).map(|m| m.as_str().to_string())
                } else {
                    None
                };
                
                let content_pattern = Regex::new(r"(?:saying|that|with content|content)\s+(.+)").unwrap();
                let content = if let Some(caps) = content_pattern.captures(message) {
                    caps.get(1).map(|m| m.as_str().to_string())
                } else {
                    Some(message.to_string())
                };
                
                let mut result = serde_json::Map::new();
                if let Some(t) = title {
                    result.insert("title".to_string(), json!(t));
                }
                if let Some(c) = content {
                    result.insert("content".to_string(), json!(c));
                }
                json!(result)
            }
            _ => json!({}),
        }
    }

    pub fn suggest_plugins_for_query(&self, query: &str) -> Vec<String> {
        let mut suggestions = Vec::new();
        
        let query_lower = query.to_lowercase();
        
        if query_lower.contains("file") || query_lower.contains("read") || query_lower.contains("open") {
            suggestions.push("com.weave.builtin.file".to_string());
        }
        if query_lower.contains("calc") || query_lower.contains("math") || query_lower.contains("compute")
            || query_lower.chars().any(|c| "+-*/^".contains(c)) {
            suggestions.push("com.weave.builtin.calc".to_string());
        }
        if query_lower.contains("note") || query_lower.contains("remember") || query_lower.contains("save") {
            suggestions.push("com.weave.builtin.note".to_string());
        }
        
        suggestions
    }
}
