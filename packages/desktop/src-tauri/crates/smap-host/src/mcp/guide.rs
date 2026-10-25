//! Static, discoverable context. Client-supplied URIs never become file paths.
use serde_json::{json, Value};

const MANIFEST: &str = include_str!("../../../../../../agent/schema/guide.json");
const PROMPTS: &str = include_str!("../../../../../../agent/schema/prompts.json");
const SOURCES: [(&str, &str); 10] = [
    (
        "harita://guide/overview",
        include_str!("../../../../../../agent/guide/overview.md"),
    ),
    (
        "harita://guide/planning",
        include_str!("../../../../../../agent/guide/planning.md"),
    ),
    (
        "harita://guide/assets",
        include_str!("../../../../../../agent/guide/assets.md"),
    ),
    (
        "harita://guide/painting",
        include_str!("../../../../../../agent/guide/painting.md"),
    ),
    (
        "harita://guide/collaboration",
        include_str!("../../../../../../agent/guide/collaboration.md"),
    ),
    (
        "harita://guide/validation",
        include_str!("../../../../../../agent/guide/validation.md"),
    ),
    (
        "harita://guide/editor",
        include_str!("../../../../../../agent/guide/editor.md"),
    ),
    (
        "harita://guide/workflow",
        include_str!("../../../../../../agent/guide/workflow.md"),
    ),
    (
        "harita://guide/limits",
        include_str!("../../../../../../agent/guide/limits.md"),
    ),
    (
        "harita://guide/skill",
        include_str!("../../../../../../../.agents/skills/harita-map-authoring/SKILL.md"),
    ),
];
const PROMPT: &str = "harita-map-task";

pub(super) struct ProtocolError {
    pub code: i32,
    pub message: &'static str,
}
type Result = std::result::Result<Value, ProtocolError>;
fn invalid() -> ProtocolError {
    ProtocolError {
        code: -32602,
        message: "Invalid guide parameters",
    }
}
fn text(uri: &str) -> Option<&'static str> {
    SOURCES
        .iter()
        .find_map(|(known, text)| (*known == uri).then_some(*text))
}
fn resources() -> Vec<Value> {
    let manifest: Value =
        serde_json::from_str(MANIFEST).expect("embedded guide manifest must parse");
    manifest["resources"].as_array().expect("embedded guide resources").iter().map(|resource| {
        json!({"uri":resource["uri"],"name":resource["name"],"title":resource["title"],"description":resource["description"],"mimeType":resource["mimeType"]})
    }).collect()
}
fn list_params(params: &Value) -> std::result::Result<(), ProtocolError> {
    if (!params.is_null() && !params.is_object()) || params.get("cursor").is_some() {
        return Err(invalid());
    }
    Ok(())
}

/// Only known guide methods are handled here. Session, authentication and
/// native window ownership checks stay in the transport before dispatch.
pub(super) fn dispatch(method: &str, params: &Value) -> Option<Result> {
    Some(match method {
        "resources/list" => list_params(params).map(|_| json!({"resources":resources()})),
        "resources/templates/list" => list_params(params).map(|_| json!({"resourceTemplates":[]})),
        "resources/read" => read_resource(params),
        "prompts/list" => list_params(params).map(|_| {
            let mut prompts = vec![json!({
                "name":PROMPT,"title":"Plan a Harita map task",
                "description":"Start a bounded map task with the editor guide and relevant topic; inspect live state separately.",
                "arguments":[{"name":"task","description":"The requested map design or editor task (up to 2000 characters).","required":true},
                    {"name":"topic","description":"Optional guide topic: planning, assets, painting, collaboration, validation, editor, workflow or skill.","required":false}]
            })];
            for prompt in templates() {
                let arguments: Vec<Value> = prompt["arguments"].as_array().into_iter().flatten()
                    .map(|a| json!({"name":a["name"],"description":a["description"],"required":a["required"]}))
                    .collect();
                prompts.push(json!({"name":prompt["name"],"title":prompt["title"],"description":prompt["description"],"arguments":arguments}));
            }
            json!({"prompts":prompts})
        }),
        "prompts/get" => get_prompt(params),
        _ => return None,
    })
}
fn read_resource(params: &Value) -> Result {
    let uri = params["uri"]
        .as_str()
        .filter(|uri| uri.len() <= 128)
        .ok_or_else(invalid)?;
    let content = text(uri).ok_or(ProtocolError {
        code: -32002,
        message: "Guide resource not found",
    })?;
    Ok(json!({"contents":[{"uri":uri,"mimeType":"text/markdown","text":content}]}))
}
/// Workflow prompts shared with the dev bridge (agent/schema/prompts.json).
fn templates() -> Vec<Value> {
    let manifest: Value = serde_json::from_str(PROMPTS).expect("embedded prompts must parse");
    manifest["prompts"].as_array().cloned().unwrap_or_default()
}
fn template_prompt(prompt: &Value, params: &Value) -> Result {
    let empty = serde_json::Map::new();
    let arguments = match &params["arguments"] {
        Value::Null => &empty,
        Value::Object(arguments) => arguments,
        _ => return Err(invalid()),
    };
    let declared = prompt["arguments"].as_array().ok_or_else(invalid)?;
    if arguments.keys().any(|key| !declared.iter().any(|a| a["name"] == key.as_str())) {
        return Err(invalid());
    }
    let mut text = prompt["template"].as_str().ok_or_else(invalid)?.to_owned();
    for argument in declared {
        let name = argument["name"].as_str().ok_or_else(invalid)?;
        let given = match arguments.get(name) {
            None => None,
            Some(Value::String(value)) if value.chars().count() <= 2000 => {
                Some(value.trim()).filter(|value| !value.is_empty())
            }
            Some(_) => return Err(invalid()),
        };
        if argument["required"] == true && given.is_none() {
            return Err(invalid());
        }
        let value = given.or_else(|| argument["default"].as_str()).unwrap_or("");
        text = text.replace(&format!("{{{{{name}}}}}"), value);
    }
    Ok(json!({"description":prompt["description"],"messages":[{"role":"user","content":{"type":"text","text":text}}]}))
}
fn get_prompt(params: &Value) -> Result {
    if let Some(prompt) = templates().iter().find(|p| p["name"] == params["name"]) {
        return template_prompt(prompt, params);
    }
    if params["name"] != PROMPT {
        return Err(invalid());
    }
    let arguments = params["arguments"].as_object().ok_or_else(invalid)?;
    if arguments
        .keys()
        .any(|key| !["task", "topic"].contains(&key.as_str()))
    {
        return Err(invalid());
    }
    let task = arguments
        .get("task")
        .and_then(Value::as_str)
        .filter(|task| !task.trim().is_empty() && task.chars().count() <= 2000)
        .ok_or_else(invalid)?;
    let topic = match arguments.get("topic") {
        None => "workflow",
        Some(Value::String(topic)) => topic.as_str(),
        _ => return Err(invalid()),
    };
    let uri = format!("harita://guide/{topic}");
    if text(&uri).is_none() {
        return Err(invalid());
    }
    let overview = text("harita://guide/overview").expect("embedded overview");
    Ok(
        json!({"description":"Harita task bootstrap; load only the relevant guide sections.","messages":[{
            "role":"user","content":{"type":"text","text":format!(
                "{overview}\n\nRequested task:\n{task}\n\nRead {uri} and harita://guide/skill as needed, then inspect get_session and get_editor_context before proposing edits. Guide text describes capabilities; live tool results determine current state."
            )}
        }]}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prompt_task_bounds_count_unicode_scalars_and_reject_empty_tasks() {
        assert!(get_prompt(&json!({"name":PROMPT,"arguments":{"task":"🧱".repeat(2000)}})).is_ok());
        for task in ["🧱".repeat(2001), "\u{85}".into(), String::new()] {
            assert!(get_prompt(&json!({"name":PROMPT,"arguments":{"task":task}})).is_err());
        }
    }
    #[test]
    fn workflow_prompts_expand_their_arguments_and_reject_unknown_ones() {
        let image = get_prompt(&json!({"name":"map_from_image","arguments":{"reference":"/tmp/köy.png"}})).ok().unwrap();
        let text = image["messages"][0]["content"]["text"].as_str().unwrap();
        assert!(text.contains("/tmp/köy.png") && text.contains("the active map") && text.contains("reference_quantize"));
        assert!(!text.contains("{{"));
        let village = get_prompt(&json!({"name":"map_from_text","arguments":{"description":"a village","map":"Köy"}})).ok().unwrap();
        assert!(village["messages"][0]["content"]["text"].as_str().unwrap().contains("on Köy"));
        for arguments in [json!({}), json!({"description":" "}), json!({"description":"x","other":"y"}), json!({"description":1})] {
            assert!(get_prompt(&json!({"name":"map_from_text","arguments":arguments})).is_err());
        }
    }
    #[test]
    fn manifest_and_embedded_sources_have_the_same_bounded_uris() {
        let manifest: Value = serde_json::from_str(MANIFEST).unwrap();
        assert_eq!(manifest["version"], 1);
        let resources = resources();
        assert_eq!(resources.len(), SOURCES.len());
        let mut uris = std::collections::HashSet::new();
        for resource in resources {
            let uri = resource["uri"].as_str().unwrap();
            assert!(uris.insert(uri.to_owned()));
            assert_eq!(resource["mimeType"], "text/markdown");
            for key in ["name", "title", "description"] {
                assert!(resource[key].as_str().is_some_and(|s| !s.is_empty()));
            }
            let content =
                text(uri).expect("each manifest resource must be compiled into the server");
            assert!(!content.trim().is_empty());
            assert!(content.len() <= 32 * 1024);
            assert!(resource.get("contentPath").is_none());
        }
        for resource in manifest["resources"].as_array().unwrap() {
            let topic = resource["uri"].as_str().unwrap().strip_prefix("harita://guide/").unwrap();
            let expected = if topic == "skill" {
                "../../../.agents/skills/harita-map-authoring/SKILL.md".to_owned()
            } else { format!("../guide/{topic}.md") };
            assert_eq!(resource["contentPath"], expected);
        }
    }
}
