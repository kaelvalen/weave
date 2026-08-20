use serde_json::{json, Value};
use tracing::info;

use crate::models::plugin::PluginExecutor;
use crate::utils::errors::WeaveError;
use crate::utils::ssrf;

pub struct WebPlugin;

impl PluginExecutor for WebPlugin {
    fn execute(
        &self,
        capability: &str,
        params: Value,
        ctx: &runtime_kernel::execution_context::ExecutionContext,
    ) -> Result<Value, WeaveError> {
        WebPlugin::execute(capability, params, ctx)
    }
}

impl WebPlugin {
    pub fn execute(
        capability: &str,
        params: Value,
        _ctx: &runtime_kernel::execution_context::ExecutionContext,
    ) -> Result<Value, WeaveError> {
        match capability {
            "web.fetch" => Self::fetch(params),
            "web.search" => Self::search(params),
            _ => Err(WeaveError::CapabilityNotFound(capability.to_string())),
        }
    }

    /// Search the web and return ranked results (title, URL, snippet).
    ///
    /// Keyless DuckDuckGo HTML search: the host is a fixed constant, so the
    /// only user-controlled input is the query parameter — no SSRF surface
    /// (unlike `web.fetch`). Results are parsed from the classic HTML
    /// endpoint, which needs no API key and works from a desktop app.
    fn search(params: Value) -> Result<Value, WeaveError> {
        let query = params
            .get("query")
            .and_then(|v| v.as_str())
            .map(|q| q.trim())
            .filter(|q| !q.is_empty())
            .ok_or_else(|| WeaveError::PluginError("Missing 'query' parameter".to_string()))?
            .chars()
            .take(200)
            .collect::<String>();

        info!("Web search: {}", query);

        let result: Result<Value, WeaveError> = std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|e| WeaveError::PluginError(e.to_string()))?;

            rt.block_on(async {
                let client = reqwest::Client::builder()
                    .timeout(std::time::Duration::from_secs(15))
                    .user_agent(
                        "Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0",
                    )
                    .build()
                    .map_err(|e| WeaveError::PluginError(e.to_string()))?;

                // Primary: the classic HTML results page (rich results, no
                // API key). DDG bot-checks it under rapid fire — when that
                // happens (or the query has no HTML hits) fall back to the
                // official keyless Instant Answer API.
                let mut results = {
                    let mut base = reqwest::Url::parse("https://html.duckduckgo.com/html/")
                        .map_err(|e| WeaveError::PluginError(e.to_string()))?;
                    let url = base
                        .query_pairs_mut()
                        .append_pair("q", &query)
                        .append_pair("kl", "us-en")
                        .finish()
                        .clone();

                    match client.get(url).send().await {
                        Ok(response) if response.status().is_success() => {
                            let html = response.text().await.unwrap_or_default();
                            Self::parse_ddg_results(&html)
                        }
                        _ => Vec::new(),
                    }
                };

                if results.is_empty() {
                    results = Self::instant_answer_results(&client, &query).await;
                }

                if results.is_empty() {
                    info!("Web search '{}' returned no results", query);
                }

                Ok(json!({
                    "query": query,
                    "results": results,
                    "count": results.len(),
                }))
            })
        })
        .join()
        .map_err(|_| WeaveError::PluginError("Web search thread panicked".to_string()))?;

        result
    }

    /// DuckDuckGo Instant Answer API fallback (official, keyless, JSON).
    /// Maps the abstract + related topics to the same `{title,url,snippet}`
    /// shape the HTML parser produces. Coverage is sparser, but the endpoint
    /// is stable — no bot-checking.
    async fn instant_answer_results(client: &reqwest::Client, query: &str) -> Vec<Value> {
        let mut base = match reqwest::Url::parse("https://api.duckduckgo.com/") {
            Ok(b) => b,
            Err(_) => return Vec::new(),
        };
        let url = base
            .query_pairs_mut()
            .append_pair("q", query)
            .append_pair("format", "json")
            .append_pair("no_html", "1")
            .append_pair("no_redirect", "1")
            .finish()
            .clone();

        let response = match client.get(url).send().await {
            Ok(r) if r.status().is_success() => r,
            _ => return Vec::new(),
        };
        let json: Value = match response.json().await {
            Ok(v) => v,
            Err(_) => return Vec::new(),
        };

        let mut results: Vec<Value> = Vec::new();
        let abstract_text = json["Abstract"].as_str().unwrap_or("").trim();
        let abstract_url = json["AbstractURL"].as_str().unwrap_or("");
        if !abstract_text.is_empty() && !abstract_url.is_empty() {
            results.push(json!({
                "title": json["Heading"].as_str().unwrap_or("Answer"),
                "url": abstract_url,
                "snippet": abstract_text,
            }));
        }

        fn push_topics(results: &mut Vec<Value>, topics: &Value) {
            for item in topics.as_array().unwrap_or(&Vec::new()) {
                if let Some(nested) = item.get("Topics").and_then(|t| t.as_array()) {
                    push_topics(results, &Value::Array(nested.clone()));
                    continue;
                }
                let text = item["Text"].as_str().unwrap_or("");
                let url = item["FirstURL"].as_str().unwrap_or("");
                if text.is_empty() || url.is_empty() || results.len() >= 6 {
                    continue;
                }
                let (title, snippet) = match text.split_once(" — ") {
                    Some((t, s)) => (t, s),
                    None => text
                        .find(" - ")
                        .map(|i| (&text[..i], &text[i + 3..]))
                        .unwrap_or((text, "")),
                };
                results.push(json!({
                    "title": title.trim(),
                    "url": url,
                    "snippet": snippet.trim(),
                }));
            }
        }
        push_topics(&mut results, &json["RelatedTopics"]);

        results.into_iter().take(6).collect()
    }

    /// Parse the DuckDuckGo HTML results page: `result__a` anchors carry the
    /// title and a `//duckduckgo.com/l/?uddg=<encoded>` redirect link;
    /// `result__snippet` carries the snippet. Tag stripping + entity decode
    /// keep the JSON clean for the model and the UI trace.
    fn parse_ddg_results(html: &str) -> Vec<Value> {
        let mut results: Vec<Value> = Vec::new();
        let mut rest = html;

        while let Some(class_idx) = rest.find("class=\"result__a\"") {
            let tag_start = rest[..class_idx].rfind("<a ").unwrap_or(class_idx);
            let anchor = &rest[tag_start..];

            // Closing ">" of the <a ...> tag.
            let Some(gt) = anchor.find('>') else { break };
            let open_tag = &anchor[..gt];
            let Some(end_rel) = anchor[gt..].find("</a>") else {
                break;
            };
            let title = Self::strip_inner_tags(&anchor[gt + 1..gt + end_rel])
                .trim()
                .to_string();

            let href = Self::extract_attr(open_tag, "href").unwrap_or_default();
            let url = Self::decode_ddg_href(&href);

            // Move past this result anchor.
            rest = &anchor[gt + end_rel..];
            // After the title comes the snippet in a `result__snippet` element.
            let snippet = match rest.find("class=\"result__snippet\"") {
                Some(s) => {
                    let s_start = rest[..s].rfind("<a ").unwrap_or(s);
                    let snippet_a = &rest[s_start..];
                    match snippet_a.find('>') {
                        Some(gt2) => {
                            let end = snippet_a[gt2..].find("</a>").unwrap_or(0);
                            let text = Self::strip_inner_tags(&snippet_a[gt2 + 1..gt2 + end]);
                            let text = text.trim().to_string();
                            // advance to just after the snippet anchor
                            rest = &snippet_a[gt2 + end..];
                            text
                        }
                        None => String::new(),
                    }
                }
                None => String::new(),
            };

            if url.is_empty() || title.is_empty() {
                continue;
            }
            if results.len() >= 6 {
                break;
            }
            results.push(json!({
                "title": Self::decode_entities(&title),
                "url": url,
                "snippet": Self::decode_entities(&snippet),
            }));
        }

        results
    }

    /// The HTML endpoint links through `//duckduckgo.com/l/?uddg=<enc>&rut=…`.
    fn decode_ddg_href(href: &str) -> String {
        if let Some(uddg) = Self::url_param(href, "uddg") {
            let decoded = Self::percent_decode(&uddg);
            if !decoded.is_empty() {
                return decoded;
            }
        }
        // Non-redirect links (rare) pass through with scheme normalized.
        let cleaned = Self::strip_inner_tags(href).trim().to_string();
        if cleaned.starts_with("//") {
            format!("https:{}", cleaned)
        } else {
            cleaned
        }
    }

    fn url_param(href: &str, key: &str) -> Option<String> {
        let after_question = href.split('?').nth(1)?;
        let query = after_question.split('#').next()?;
        for pair in query.split('&') {
            if let Some((k, v)) = pair.split_once('=') {
                if k == key {
                    return Some(v.to_string());
                }
            }
        }
        None
    }

    fn percent_decode(input: &str) -> String {
        let bytes = input.as_bytes();
        let mut out = Vec::with_capacity(bytes.len());
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%' && i + 2 < bytes.len() {
                if let (Some(h), Some(l)) =
                    (Self::hex_val(bytes[i + 1]), Self::hex_val(bytes[i + 2]))
                {
                    out.push(h * 16 + l);
                    i += 3;
                    continue;
                }
            }
            out.push(bytes[i]);
            i += 1;
        }
        String::from_utf8_lossy(&out).into_owned()
    }

    fn hex_val(b: u8) -> Option<u8> {
        match b {
            b'0'..=b'9' => Some(b - b'0'),
            b'a'..=b'f' => Some(b - b'a' + 10),
            b'A'..=b'F' => Some(b - b'A' + 10),
            _ => None,
        }
    }

    fn extract_attr(tag: &str, key: &str) -> Option<String> {
        let needle = format!("{}=", key);
        let idx = tag.find(&needle)?;
        let after = &tag[idx + needle.len()..];
        if let Some(q) = after.strip_prefix('"') {
            let end = q.find('"')?;
            return Some(q[..end].to_string());
        }
        if let Some(q) = after.strip_prefix('\'') {
            let end = q.find('\'')?;
            return Some(q[..end].to_string());
        }
        let end = after
            .find(|c: char| c.is_whitespace() || c == '>')
            .unwrap_or(after.len());
        Some(after[..end].to_string())
    }

    fn strip_inner_tags(input: &str) -> String {
        let mut out = String::with_capacity(input.len());
        let mut in_tag = false;
        for ch in input.chars() {
            if ch == '<' {
                in_tag = true;
                continue;
            }
            if ch == '>' {
                in_tag = false;
                continue;
            }
            if !in_tag {
                out.push(ch);
            }
        }
        out
    }

    fn decode_entities(input: &str) -> String {
        input
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#x27;", "'")
            .replace("&#39;", "'")
    }

    fn fetch(params: Value) -> Result<Value, WeaveError> {
        let url = params
            .get("url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| WeaveError::PluginError("Missing 'url' parameter".to_string()))?
            .to_string();

        info!("Fetching URL: {}", url);

        // Use reqwest in a blocking thread instead of spawning curl subprocess
        let result: Result<Value, WeaveError> = std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|e| WeaveError::PluginError(e.to_string()))?;

            rt.block_on(async {
                // SSRF guard: scheme/host policy + private-IP resolution check,
                // re-validated on every redirect hop.
                let parsed = ssrf::ensure_safe_url(&url).await?;

                let client = reqwest::Client::builder()
                    .timeout(std::time::Duration::from_secs(30))
                    .redirect(reqwest::redirect::Policy::custom(|attempt| {
                        match ssrf::ensure_safe_url_sync(attempt.url()) {
                            Ok(()) => attempt.follow(),
                            Err(e) => attempt.error(e.to_string()),
                        }
                    }))
                    .build()
                    .map_err(|e| WeaveError::PluginError(e.to_string()))?;

                let response =
                    client.get(parsed).send().await.map_err(|e| {
                        WeaveError::PluginError(format!("Failed to fetch URL: {}", e))
                    })?;

                let status = response.status().as_u16();
                let content_type = response
                    .headers()
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("unknown")
                    .to_string();

                let body = response.text().await.unwrap_or_default();
                let size = body.len();

                // Basic HTML tag stripping for readability
                let clean_text = if content_type.contains("text/html") {
                    Self::strip_html_tags(&body)
                } else {
                    body.clone()
                };

                Ok(json!({
                    "url": url,
                    "status": status,
                    "content_type": content_type,
                    "content": clean_text,
                    "raw_size": size,
                    "success": (200..400).contains(&status),
                }))
            })
        })
        .join()
        .map_err(|_| WeaveError::PluginError("Web fetch thread panicked".to_string()))?;

        result
    }

    fn strip_html_tags(html: &str) -> String {
        let mut result = String::with_capacity(html.len());
        let mut in_tag = false;
        let mut in_script = false;
        let mut in_style = false;

        let lower = html.to_lowercase();
        let chars: Vec<char> = html.chars().collect();
        let lower_chars: Vec<char> = lower.chars().collect();

        let mut i = 0;
        while i < chars.len() {
            if !in_tag && i + 7 < lower_chars.len() {
                let slice: String = lower_chars[i..i + 7].iter().collect();
                if slice == "<script" {
                    in_script = true;
                }
                if slice == "<style "
                    || (i + 6 < lower_chars.len()
                        && lower_chars[i..i + 6].iter().collect::<String>() == "<style")
                {
                    in_style = true;
                }
            }
            if i + 9 < lower_chars.len() {
                let slice: String = lower_chars[i..i + 9].iter().collect();
                if slice == "</script>" {
                    in_script = false;
                    i += 9;
                    continue;
                }
            }
            if i + 8 < lower_chars.len() {
                let slice: String = lower_chars[i..i + 8].iter().collect();
                if slice == "</style>" {
                    in_style = false;
                    i += 8;
                    continue;
                }
            }

            if in_script || in_style {
                i += 1;
                continue;
            }

            if chars[i] == '<' {
                in_tag = true;
                i += 1;
                continue;
            }
            if chars[i] == '>' {
                in_tag = false;
                i += 1;
                continue;
            }
            if !in_tag {
                result.push(chars[i]);
            }
            i += 1;
        }

        // Collapse excessive whitespace
        let mut collapsed = String::new();
        let mut prev_was_space = false;
        for ch in result.chars() {
            if ch.is_whitespace() {
                if !prev_was_space {
                    collapsed.push(' ');
                }
                prev_was_space = true;
            } else {
                collapsed.push(ch);
                prev_was_space = false;
            }
        }
        collapsed.trim().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::WebPlugin;

    /// A realistic slice of the DuckDuckGo HTML results page.
    const FIXTURE: &str = r#"
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.example.com%2Fcones&rut=abc">Waffle <b>Cones</b> — Example</a>
    </h2>
    <div class="result__extras">
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.example.com%2Fcones">Handmade waffle cones with <b>free shipping</b> &amp; bulk pricing.</a>
    </div>
  </div>
</div>
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fshop.io%2Fice-cream-supplies&rut=def">Ice Cream Shop Supplies</a>
    </h2>
    <div class="result__extras">
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fshop.io%2Fice-cream-supplies">Everything a scoop shop needs.</a>
    </div>
  </div>
</div>
"#;

    #[test]
    fn parses_titles_urls_and_snippets_from_ddg_html() {
        let results = WebPlugin::parse_ddg_results(FIXTURE);

        assert_eq!(results.len(), 2);

        let first = &results[0];
        assert_eq!(first["title"], "Waffle Cones — Example");
        assert_eq!(first["url"], "https://www.example.com/cones");
        assert_eq!(
            first["snippet"],
            "Handmade waffle cones with free shipping & bulk pricing."
        );

        let second = &results[1];
        assert_eq!(second["title"], "Ice Cream Shop Supplies");
        assert_eq!(second["url"], "https://shop.io/ice-cream-supplies");
    }

    #[test]
    fn empty_page_yields_empty_results() {
        assert!(WebPlugin::parse_ddg_results("<html><body>no results</body></html>").is_empty());
    }

    #[test]
    fn caps_result_count_at_six() {
        let mut html = String::new();
        for i in 0..8 {
            html.push_str(&format!(
                r#"<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsite{i}.com%2F">Site {i}</a>"#
            ));
        }
        let results = WebPlugin::parse_ddg_results(&html);
        assert_eq!(results.len(), 6);
    }
}
