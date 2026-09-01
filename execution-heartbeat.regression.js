const assert = require("assert");
const fs = require("fs");
const { buildCompletionSummary, buildHeartbeatLog, createDebugHeartbeatLogger, createExecutionHeartbeat, formatElapsed } = require("./execution-heartbeat");
const { EXECUTION_STATUSES, TERMINAL_EXECUTION_STATUSES, assertExecutionTransition, isTerminalExecutionStatus } = require("./execution-state");

assert.deepStrictEqual(EXECUTION_STATUSES, ["START", "RUNNING", "DONE", "FAILED", "BLOCKED"]);
assert.deepStrictEqual(TERMINAL_EXECUTION_STATUSES, ["DONE", "FAILED", "BLOCKED"]);
assert.strictEqual(assertExecutionTransition("START", "RUNNING"), "RUNNING");
for (const terminalStatus of TERMINAL_EXECUTION_STATUSES) {
  assert.strictEqual(assertExecutionTransition("RUNNING", terminalStatus), terminalStatus, `${terminalStatus} must be a terminal execution state`);
  assert.strictEqual(isTerminalExecutionStatus(terminalStatus), true);
}
assert.throws(() => assertExecutionTransition("START", "DONE"), /transition_invalid/);
assert.throws(() => assertExecutionTransition("DONE", "RUNNING"), /transition_invalid/);

const listenerSource = fs.readFileSync(require.resolve("./listener"), "utf8");
assert.doesNotMatch(listenerSource, /function sendHeartbeat\(/, "recurring heartbeat must not have a Slack sender");
assert.match(listenerSource, /const logHeartbeat = createDebugHeartbeatLogger\(\{[\s\S]*enabled: DEBUG_CODEX_JSON/, "heartbeat logging must use the existing debug log level");
assert.match(listenerSource, /onHeartbeat: \(current\) => logHeartbeat\(\{ taskId: task\.task_id, workerId: current\.worker_id, elapsedMs: current\.elapsed_ms \}\)/, "recurring heartbeat must stay local");

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
  const debugLogs = [];
  const debugHeartbeat = createDebugHeartbeatLogger({ enabled: true, write: (message) => debugLogs.push(message) });
  assert.strictEqual(debugHeartbeat({ taskId: "TASK-057", workerId: "dev-pc-b", elapsedMs: 210_000 }), true);
  assert.deepStrictEqual(debugLogs, ["[HEARTBEAT]\ntask_id=TASK-057\nworker=dev-pc-b\nelapsed=03m30s"], "debug logging must capture heartbeat output");

  const normalLogs = [];
  const normalHeartbeat = createDebugHeartbeatLogger({ enabled: false, write: (message) => normalLogs.push(message) });
  assert.strictEqual(normalHeartbeat({ taskId: "TASK-057", workerId: "dev-pc-b", elapsedMs: 210_000 }), false);
  assert.deepStrictEqual(normalLogs, [], "normal logs must hide heartbeat output");

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
  const blocked = createExecutionHeartbeat({ taskId: "TASK-056", workerId: "dev-pc-b", now: () => new Date(nowMs), setIntervalFn: () => ({ unref() {} }), clearIntervalFn: () => {} });
  blocked.start();
  assert.strictEqual(blocked.stop("BLOCKED").context.current_status, "BLOCKED", "BLOCKED must be retained as a terminal execution state");
  assert.throws(() => blocked.stop("RUNNING"), /terminal_status_invalid/);
  assert.strictEqual(formatElapsed(332000), "05m32s");
  assert.strictEqual(buildHeartbeatLog({ taskId: "TASK-054", workerId: "dev-pc-b", elapsedMs: 332000 }), "[HEARTBEAT]\ntask_id=TASK-054\nworker=dev-pc-b\nelapsed=05m32s");
  assert.match(buildCompletionSummary({ status: "DONE", taskId: "TASK-054", workerId: "dev-pc-b", elapsedMs: 872000 }), /Duration:\n14m32s/);
  console.log("execution state and heartbeat lifecycle regression passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
