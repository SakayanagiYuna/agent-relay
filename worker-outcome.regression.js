"use strict";

const assert = require("assert");
const { inferReportedTerminalStatus, resolveWorkerOutcome } = require("./worker-outcome");

assert.strictEqual(inferReportedTerminalStatus("状态：FAILED（navigation）\n未生成截图。"), "FAILED");
assert.strictEqual(inferReportedTerminalStatus("AGENT_RELAY_RESULT: BLOCKED\n需要主机权限。"), "BLOCKED");
assert.strictEqual(inferReportedTerminalStatus("The previous status: FAILED was historical context."), null);
assert.strictEqual(resolveWorkerOutcome({ exitCode: 0, summary: "状态：FAILED（navigation）" }), "FAILED", "an explicit worker failure must override a zero CLI exit code");
assert.strictEqual(resolveWorkerOutcome({ exitCode: 0, summary: "Completed requested change." }), "DONE");
assert.strictEqual(resolveWorkerOutcome({ exitCode: 1, summary: "AGENT_RELAY_RESULT: DONE" }), null);

console.log("worker outcome regression passed");
