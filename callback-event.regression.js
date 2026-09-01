"use strict";

const assert = require("assert");
const { buildTerminalEvent, buildTerminalCallbackPayload } = require("./callback-event");

assert.deepStrictEqual(
  buildTerminalEvent({ taskId: "TASK-062", status: "DONE", elapsedSec: 10 }),
  { schema_version: 1, event: "task_terminal", task_id: "TASK-062", status: "DONE", elapsed_sec: 10 },
  "terminal fan-out must use a canonical minimal terminal event"
);

assert.deepStrictEqual(
  buildTerminalCallbackPayload({ taskId: "TASK-062", status: "DONE", callbackTargetId: "target-example", duration: "00m10s", summary: "do not copy", stderr: "do not copy" }),
  { task_id: "TASK-062", status: "DONE", callback_target_id: "target-example" },
  "callback envelope must contain only terminal wake-up data and optional delivery routing"
);
assert.deepStrictEqual(buildTerminalCallbackPayload({ taskId: "TASK-062", status: "FAILED" }), { task_id: "TASK-062", status: "FAILED" });
assert.deepStrictEqual(buildTerminalCallbackPayload({ taskId: "TASK-062", status: "BLOCKED" }), { task_id: "TASK-062", status: "BLOCKED" });
assert.deepStrictEqual(
  buildTerminalCallbackPayload({ taskId: "TASK-062", status: "DONE", callbackTargetId: "target-example", slackStatusTs: "1720000000.000100", slackChannelId: "C123ABC", evidenceReference: { fileId: "F085ABC", permalink: "https://workspace.slack.com/files/U1/F085ABC/evidence.png" } }),
  { task_id: "TASK-062", status: "DONE", callback_target_id: "target-example", slack_status_ts: "1720000000.000100", slack_channel_id: "C123ABC", evidence_file_id: "F085ABC", evidence_permalink: "https://workspace.slack.com/files/U1/F085ABC/evidence.png" },
  "callback must carry only Slack retrieval metadata when browser evidence exists"
);
assert.throws(() => buildTerminalCallbackPayload({ taskId: "TASK-062", status: "RUNNING" }), /callback_status_invalid/);
assert.throws(() => buildTerminalEvent({ taskId: "TASK-062", status: "DONE", elapsedSec: -1 }), /terminal_elapsed_sec_invalid/);

console.log("terminal callback event regression passed");
