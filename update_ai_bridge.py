import re

with open('src-tauri/src/core/ai_bridge.rs', 'r') as f:
    content = f.read()

# 1. First provider config
kimi_block_1 = """                Provider::Kimi => (
                    Provider::Kimi,
                    config.kimi.model.clone(),
                    Some(config.kimi.api_key.clone()),
                    config.kimi.api_url.clone(),
                    config.kimi.temperature,
                    config.kimi.max_tokens,
                ),"""
opencode_block_1 = """                Provider::Kimi => (
                    Provider::Kimi,
                    config.kimi.model.clone(),
                    Some(config.kimi.api_key.clone()),
                    config.kimi.api_url.clone(),
                    config.kimi.temperature,
                    config.kimi.max_tokens,
                ),
                Provider::Opencode => (
                    Provider::Opencode,
                    config.opencode.model.clone(),
                    Some(config.opencode.api_key.clone()),
                    config.opencode.api_url.clone(),
                    config.opencode.temperature,
                    config.opencode.max_tokens,
                ),"""
content = content.replace(kimi_block_1, opencode_block_1)

# 2. Chat match
kimi_match_1 = """            Provider::Kimi => {
                self.chat_kimi(enhanced_messages, &model, api_key, api_url.as_deref(), temperature, max_tokens).await
            }"""
opencode_match_1 = """            Provider::Kimi => {
                self.chat_kimi(enhanced_messages, &model, api_key, api_url.as_deref(), temperature, max_tokens).await
            }
            Provider::Opencode => {
                self.chat_opencode(enhanced_messages, &model, api_key, api_url.as_deref(), temperature, max_tokens).await
            }"""
content = content.replace(kimi_match_1, opencode_match_1)

# 3. Stream match
kimi_match_2 = """                Provider::Kimi => {
                    Self::stream_kimi_internal(
                        client, enhanced_messages, &model, api_key, api_url.as_deref(),
                        temperature, max_tokens, tx.clone(),
                    ).await
                }"""
opencode_match_2 = """                Provider::Kimi => {
                    Self::stream_kimi_internal(
                        client, enhanced_messages, &model, api_key, api_url.as_deref(),
                        temperature, max_tokens, tx.clone(),
                    ).await
                }
                Provider::Opencode => {
                    Self::stream_opencode_internal(
                        client, enhanced_messages, &model, api_key, api_url.as_deref(),
                        temperature, max_tokens, tx.clone(),
                    ).await
                }"""
content = content.replace(kimi_match_2, opencode_match_2)


# 4. list models
list_kimi = """            Provider::Kimi => {
                let api_key = config.kimi.api_key.clone();
                if api_key.is_empty() {
                    return Err(WeaveError::ApiKeyNotConfigured("Kimi".to_string()));
                }
                let url = config.kimi.api_url.as_deref().unwrap_or("https://api.moonshot.cn/v1");
                let response = self.client
                    .get(format!("{}/models", url))
                    .bearer_auth(api_key)
                    .send()
                    .await?;

                if !response.status().is_success() {
                    let error_text = response.text().await.unwrap_or_default();
                    return Err(WeaveError::AiApiError(format!("Kimi models error: {}", error_text)));
                }

                let json: serde_json::Value = response.json().await?;
                let models: Vec<String> = json["data"]
                    .as_array()
                    .unwrap_or(&Vec::new())
                    .iter()
                    .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
                    .filter(|id| id.starts_with("kimi"))
                    .collect();
                Ok(models)
            }"""

list_opencode = list_kimi + """
            Provider::Opencode => {
                let api_key = config.opencode.api_key.clone();
                if api_key.is_empty() {
                    return Err(WeaveError::ApiKeyNotConfigured("Opencode".to_string()));
                }
                let url = config.opencode.api_url.as_deref().unwrap_or("https://api.opencode.com/v1");
                let response = self.client
                    .get(format!("{}/models", url))
                    .bearer_auth(api_key)
                    .send()
                    .await?;

                if !response.status().is_success() {
                    let error_text = response.text().await.unwrap_or_default();
                    return Err(WeaveError::AiApiError(format!("Opencode models error: {}", error_text)));
                }

                let json: serde_json::Value = response.json().await?;
                let models: Vec<String> = json["data"]
                    .as_array()
                    .unwrap_or(&Vec::new())
                    .iter()
                    .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
                    .filter(|id| id.starts_with("opencode"))
                    .collect();
                Ok(models)
            }"""

content = content.replace(list_kimi, list_opencode)


# 5. Extract chat_kimi and stream_kimi_internal logic and clone it for opencode
# I'll just use regex to extract the chat_kimi method block

chat_kimi_regex = r"(    async fn chat_kimi\([\s\S]*?)    async fn chat_local\("
match = re.search(chat_kimi_regex, content)
if match:
    chat_kimi_block = match.group(1)
    chat_opencode_block = chat_kimi_block.replace("chat_kimi", "chat_opencode") \
                                         .replace('"Kimi"', '"Opencode"') \
                                         .replace("moonshot.cn", "opencode.com") \
                                         .replace("kimi_messages", "opencode_messages") \
                                         .replace("Kimi error", "Opencode error")
    content = content.replace(chat_kimi_block, chat_kimi_block + chat_opencode_block)

stream_kimi_regex = r"(    async fn stream_kimi_internal\([\s\S]*?)    async fn stream_local_internal\("
match2 = re.search(stream_kimi_regex, content)
if match2:
    stream_kimi_block = match2.group(1)
    stream_opencode_block = stream_kimi_block.replace("stream_kimi_internal", "stream_opencode_internal") \
                                         .replace('"Kimi"', '"Opencode"') \
                                         .replace("moonshot.cn", "opencode.com") \
                                         .replace("kimi_messages", "opencode_messages") \
                                         .replace("Kimi Stream Error", "Opencode Stream Error")
    content = content.replace(stream_kimi_block, stream_kimi_block + stream_opencode_block)


with open('src-tauri/src/core/ai_bridge.rs', 'w') as f:
    f.write(content)
