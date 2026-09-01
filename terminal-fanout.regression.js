"use strict";

const assert = require("assert");
const { fanoutTerminalEvent } = require("./terminal-fanout");

(async () => {
  for (const status of ["DONE", "FAILED", "BLOCKED"]) {
    const received = [];
    const diagnostics = [];
    const outcome = await fanoutTerminalEvent({ taskId: "TASK-075", status, elapsedSec: 7, deliverBrowser: async (event) => received.push(["browser", event]), notifyHuman: async (event) => received.push(["human", event]), diagnostic: (code) => diagnostics.push(code) });
    assert.strictEqual(outcome.browser.status, "fulfilled");
    assert.strictEqual(outcome.human.status, "fulfilled");
    assert.strictEqual(received[0][1], received[1][1], `${status} branches must receive the same terminal event object`);
    assert.deepStrictEqual(outcome.event, { schema_version: 1, event: "task_terminal", task_id: "TASK-075", status, elapsed_sec: 7 });
    assert.deepStrictEqual(diagnostics, []);
  }
  const diagnostics = [];
  const outcome = await fanoutTerminalEvent({ taskId: "TASK-075", status: "DONE", deliverBrowser: async () => { throw new Error("browser_down"); }, notifyHuman: async () => "sent", diagnostic: (code) => diagnostics.push(code) });
  assert.strictEqual(outcome.browser.status, "rejected");
  assert.strictEqual(outcome.human.status, "fulfilled");
  assert.deepStrictEqual(diagnostics, ["BROWSER_CALLBACK_FAILED"]);
  const reverse = await fanoutTerminalEvent({ taskId: "TASK-075", status: "DONE", deliverBrowser: async () => "sent", notifyHuman: async () => { throw new Error("provider_down"); }, diagnostic: (code) => diagnostics.push(code) });
  assert.strictEqual(reverse.browser.status, "fulfilled");
  assert.strictEqual(reverse.human.status, "rejected");
  assert.deepStrictEqual(diagnostics, ["BROWSER_CALLBACK_FAILED", "HUMAN_NOTIFY_FAILED"]);
  console.log("terminal fan-out regression passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
