"use strict";

const assert = require("assert");
const { extractCodexTaskId, parseCodexTask } = require("./task-parser");
const { validateBrowserRequest } = require("./browser-evidence");

const task = parseCodexTask(`CODEX_TASK
schema_version: 1
task_id: TASK-025
target_worker: worker-1
target_workspace: baiyuan
target_repo: agent-relay
browser_evidence: screenshot
browser_url: <http://localhost:5173>
browser_viewport: desktop
instruction: |
  Verify the browser handoff.`);

assert.deepStrictEqual(task.browser_evidence, {
  mode: "screenshot",
  url: "http://localhost:5173",
  viewport: "desktop",
});
assert.deepStrictEqual(
  validateBrowserRequest(task.browser_evidence, ["http://localhost:5173"]),
  { url: "http://localhost:5173/", viewport: "desktop" }
);
assert.throws(
  () => validateBrowserRequest({ mode: "screenshot", url: "https://example.com", viewport: "desktop" }, ["http://localhost:5173"]),
  /browser_url_not_loopback/
);

const validTask = `CODEX_TASK
schema_version: 1
task_id: TASK-SCHEMA-001
target_worker: worker-1
target_workspace: baiyuan
target_repo: agent-relay
instruction: |
  Validate protocol fields.`;

function getParseError(text) {
  try {
    parseCodexTask(text);
  } catch (error) {
    return error;
  }
  assert.fail("expected schema validation failure");
}

assert.strictEqual(parseCodexTask(validTask).task_id, "TASK-SCHEMA-001");
assert.strictEqual(parseCodexTask(validTask).agent, "codex", "agent defaults to codex for existing tasks");
assert.strictEqual(parseCodexTask(validTask.replace("target_repo: agent-relay", "target_repo: agent-relay\nagent: grok")).agent, "grok");
const unsupportedAgentError = getParseError(validTask.replace("target_repo: agent-relay", "target_repo: agent-relay\nagent: claude"));
assert.match(unsupportedAgentError.message, /unsupported_agent/);
assert.strictEqual(unsupportedAgentError.parseStage, "agent");
const missingSchemaError = getParseError(validTask.replace("schema_version: 1\n", ""));
assert.match(missingSchemaError.message, /unsupported_schema_version/);
assert.strictEqual(missingSchemaError.parseStage, "schema_version");
assert.deepStrictEqual(missingSchemaError.recognizedFields, ["task_id", "target_worker", "target_workspace", "target_repo", "instruction"]);

const unsupportedSchemaError = getParseError(validTask.replace("schema_version: 1", "schema_version: 999"));
assert.match(unsupportedSchemaError.message, /unsupported_schema_version/);
assert.strictEqual(unsupportedSchemaError.parseStage, "schema_version");
assert.deepStrictEqual(unsupportedSchemaError.recognizedFields, ["schema_version", "task_id", "target_worker", "target_workspace", "target_repo", "instruction"]);

const missingRepoError = getParseError(validTask.replace("target_repo: agent-relay\n", ""));
assert.match(missingRepoError.message, /missing_target_repo/);
assert.strictEqual(missingRepoError.parseStage, "required_fields");

const missingInstructionError = getParseError(validTask.replace("instruction: |\n  Validate protocol fields.", ""));
assert.match(missingInstructionError.message, /missing_instruction/);
assert.strictEqual(missingInstructionError.parseStage, "required_fields");

const malformedTask = validTask.replace("task_id: TASK-SCHEMA-001", "task_id TASK-MALFORMED-001");
const malformedTaskError = getParseError(malformedTask);
assert.match(malformedTaskError.message, /missing_task_id/);
assert.strictEqual(malformedTaskError.parseStage, "required_fields");
assert.deepStrictEqual(malformedTaskError.recognizedFields, ["schema_version", "target_worker", "target_workspace", "target_repo", "instruction"]);
assert.strictEqual(extractCodexTaskId("CODEX_TASK\ntask_id: TASK-RAW-001\nschema_version: 999"), "TASK-RAW-001");
assert.strictEqual(extractCodexTaskId(malformedTask), "TASK-MALFORMED-001");
assert.strictEqual(extractCodexTaskId("CODEX_TASK\ntask_id: \nschema_version: 999"), null);
assert.strictEqual(extractCodexTaskId("CODEX_TASK\nschema_version: 999"), null);

console.log("browser evidence handoff regression passed");
