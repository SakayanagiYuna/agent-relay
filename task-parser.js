"use strict";

function normalizeSlackText(rawText) {
  let text = String(rawText || "").trim();

  if (text.startsWith("```") && text.endsWith("```")) {
    text = text
      .replace(/^```[a-zA-Z0-9_-]*\s*/, "")
      .replace(/\s*```$/, "");
  }

  text = text.replace(/\n\s*\*?发送工具\*?\s+<@[^>]+>[\s\S]*$/i, "");
  text = text.replace(/\n\s*发送工具\s+ChatGPT[\s\S]*$/i, "");
  text = text.replace(/\n\s*Sent with ChatGPT[\s\S]*$/i, "");
  return text.trim();
}

function normalizeBrowserUrl(value) {
  const rawUrl = String(value || "").trim();
  const slackAutolink = rawUrl.match(/^<([^>|]+)(?:\|[^>]*)?>$/);
  return slackAutolink ? slackAutolink[1].trim() : rawUrl;
}

function parseCodexTask(text) {
  const normalized = normalizeSlackText(text);
  if (!normalized.startsWith("CODEX_TASK")) return null;

  const task = {
    schema_version: null,
    task_id: null,
    target_worker: null,
    target_workspace: null,
    target_repo: null,
    instruction: null,
    browser_evidence: null,
    browser_url: null,
    browser_viewport: null,
  };
  let inInstruction = false;
  const instructionLines = [];

  for (const line of normalized.split(/\r?\n/).slice(1)) {
    if (inInstruction) {
      instructionLines.push(line.replace(/^ {2}/, ""));
      continue;
    }
    const match = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim();
    if (key === "instruction" && value === "|") {
      inInstruction = true;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(task, key)) task[key] = value;
  }

  if (instructionLines.length > 0) task.instruction = instructionLines.join("\n").trim();
  if (String(task.schema_version) !== "1") throw new Error("unsupported_schema_version");
  for (const key of ["task_id", "target_worker", "target_workspace", "target_repo", "instruction"]) {
    if (!task[key]) throw new Error(`missing_${key}`);
  }

  const browserFieldsPresent = [task.browser_evidence, task.browser_url, task.browser_viewport]
    .some((value) => value !== null);
  if (browserFieldsPresent) {
    if (task.browser_evidence !== "screenshot" || !task.browser_url || !task.browser_viewport) {
      throw new Error("invalid_browser_evidence_request");
    }
    task.browser_url = normalizeBrowserUrl(task.browser_url);
    task.browser_evidence = {
      mode: "screenshot",
      url: task.browser_url,
      viewport: task.browser_viewport,
    };
  }
  return task;
}

module.exports = { normalizeSlackText, parseCodexTask };
