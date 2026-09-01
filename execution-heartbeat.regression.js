const assert = require("assert");
const { buildCompletionSummary, buildHeartbeatText, createExecutionHeartbeat, formatElapsed } = require("./execution-heartbeat");

let nowMs = Date.parse("2026-09-01T00:00:00.000Z");
let scheduled;
let cleared = false;
const heartbeats = [];
const heartbeat = createExecutionHeartbeat({
  taskId: "TASK-054",
  workerId: "dev-pc-b",
  now: () => new Date(nowMs),
  setIntervalFn: (callback, intervalMs) => { scheduled = { callback, intervalMs, unrefCalled: false, unref() { this.unrefCalled = true; } }; return scheduled; },
  clearIntervalFn: (timer) => { assert.strictEqual(timer, scheduled); cleared = true; },
  onHeartbeat: async (context) => heartbeats.push(context),
});

const started = heartbeat.start();
assert.deepStrictEqual(started, { task_id: "TASK-054", worker_id: "dev-pc-b", started_at: "2026-09-01T00:00:00.000Z", current_status: "RUNNING", last_heartbeat_at: "2026-09-01T00:00:00.000Z" });
assert.strictEqual(scheduled.intervalMs, 30_000);
assert.strictEqual(scheduled.unrefCalled, true, "heartbeat timer must not keep Node alive");
nowMs += 32_000;
(async () => {
  await heartbeat.heartbeat();
  assert.strictEqual(heartbeats.length, 1);
  assert.strictEqual(heartbeats[0].last_heartbeat_at, "2026-09-01T00:00:32.000Z");
  assert.strictEqual(heartbeats[0].elapsed_ms, 32_000);
  nowMs += 28_000;
  const done = heartbeat.stop("DONE");
  assert.strictEqual(cleared, true);
  assert.strictEqual(heartbeat.isRunning(), false);
  assert.strictEqual(done.context.current_status, "DONE");
  assert.strictEqual(done.elapsed_ms, 60_000);
  await scheduled.callback();
  assert.strictEqual(heartbeats.length, 1, "DONE must stop heartbeats");

  const failed = createExecutionHeartbeat({ taskId: "TASK-055", workerId: "dev-pc-b", now: () => new Date(nowMs), setIntervalFn: () => ({ unref() {} }), clearIntervalFn: () => {} });
  failed.start();
  failed.stop("FAILED");
  assert.strictEqual(failed.isRunning(), false, "FAILED must stop heartbeats");
  assert.strictEqual(formatElapsed(332000), "05m32s");
  assert.match(buildHeartbeatText({ taskId: "TASK-054", workerId: "dev-pc-b", elapsedMs: 332000 }), /Status:\nRUNNING/);
  assert.match(buildCompletionSummary({ status: "DONE", taskId: "TASK-054", workerId: "dev-pc-b", elapsedMs: 872000 }), /Duration:\n14m32s/);
  console.log("execution heartbeat lifecycle regression passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
