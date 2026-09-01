"use strict";

const assert = require("assert");
const fs = require("fs");
const { buildTerminalCallbackPayload } = require("./callback-event");
const { buildStatusText } = require("./status-audit");

const task = { task_id: "TASK-063" };
const route = { workspace_id: "baiyuan", repo_id: "agent-relay" };
const audit = { commit: "abc1234", changedFiles: ["listener.js", "status-audit.js"], summary: "2 changed file(s), +12/-3" };
const done = buildStatusText({ status: "DONE", task, route, workerId: "worker-a", duration: "00m42s", gitAudit: audit, usage: { input_tokens: 12, cached_input_tokens: 3, output_tokens: 4, reasoning_tokens: 2, total_tokens: 16 }, summary: "Implemented status audit.\nnpm test passed." });
for (const field of ["task_id: TASK-063", "status: DONE", "worker: worker-a", "workspace: baiyuan", "repo: agent-relay", "duration: 00m42s", "git_commit: abc1234", "changed_files: |\n  listener.js\n  status-audit.js", "git_diff_summary: 2 changed file(s), +12/-3", "token_usage: input=12 cached_input=3 output=4 reasoning=2 total=16", "test_result: passed"]) assert.ok(done.includes(field), `DONE must include ${field}`);
assert.doesNotMatch(done, /HEARTBEAT|elapsed_ms|last_heartbeat_at/, "heartbeat must not enter a terminal Slack status");
const withEvidence = buildStatusText({ status: "DONE", task, route, workerId: "worker-a", duration: "00m42s", gitAudit: audit, evidenceReference: { fileId: "F085ABC", permalink: "https://workspace.slack.com/files/U1/F085ABC/evidence.png" } });
assert.match(withEvidence, /evidence_file_id: F085ABC/);
assert.match(withEvidence, /evidence_permalink: https:\/\/workspace\.slack\.com\/files\/U1\/F085ABC\/evidence\.png/);
for (const status of ["FAILED", "BLOCKED"]) {
  const rendered = buildStatusText({ status, task, route, workerId: "worker-a", duration: "00m01s", gitAudit: audit, summary: "Permission denied by sandbox." });
  assert.match(rendered, new RegExp(`status: ${status}`));
  assert.match(rendered, /reason: \|\n  Permission denied by sandbox\./, `${status} must carry a concise reason`);
}
assert.deepStrictEqual(buildTerminalCallbackPayload({ taskId: "TASK-063", status: "DONE", callbackTargetId: "target-example", duration: "00m42s", gitAudit: audit, summary: done }), { task_id: "TASK-063", status: "DONE", callback_target_id: "target-example" }, "status audit must not enlarge callback payload");
assert.doesNotMatch(fs.readFileSync(require.resolve("./listener"), "utf8"), /sendHeartbeat\(/, "heartbeat must stay out of Slack status delivery");
console.log("terminal status audit regression passed");
