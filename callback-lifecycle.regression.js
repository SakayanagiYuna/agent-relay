"use strict";

const assert = require("assert");
const { deliverTerminalCallback } = require("./callback-lifecycle");

(async () => {
  for (const status of ["DONE", "FAILED", "BLOCKED"]) {
    const deliveries = [];
    const payload = await deliverTerminalCallback({
      taskId: "TASK-066",
      status,
      callbackTargetId: "target-example",
      summary: "must not be copied",
      stdout: "must not be copied",
      stderr: "must not be copied",
      diff: "must not be copied",
      deliver: async (event) => deliveries.push(event),
    });

    const expected = { task_id: "TASK-066", status, callback_target_id: "target-example" };
    assert.deepStrictEqual(payload, expected, `${status} must use the terminal callback envelope`);
    assert.deepStrictEqual(deliveries, [expected], `${status} must deliver the correlated terminal event`);
    for (const field of ["summary", "stdout", "stderr", "diff"]) assert.ok(!(field in payload), `${status} callback must not carry ${field}`);
  }

  await assert.rejects(
    () => deliverTerminalCallback({ taskId: "TASK-066", status: "RUNNING", deliver: async () => {} }),
    /callback_status_invalid/
  );

  const evidenceDeliveries = [];
  const evidencePayload = await deliverTerminalCallback({ taskId: "TASK-085", status: "DONE", callbackTargetId: "target-example", slackStatusTs: "1720000000.000100", slackChannelId: "C123ABC", evidenceReference: { fileId: "F085ABC", permalink: "https://workspace.slack.com/files/U1/F085ABC/evidence.png" }, deliver: async (event) => evidenceDeliveries.push(event) });
  assert.strictEqual(evidencePayload.evidence_file_id, "F085ABC");
  assert.strictEqual(evidencePayload.slack_status_ts, "1720000000.000100");
  assert.deepStrictEqual(evidenceDeliveries, [evidencePayload]);

  console.log("callback lifecycle regression passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
