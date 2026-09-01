"use strict";

const assert = require("assert");
const { HEALTH_COMMAND, buildHealthStatusText } = require("./health-command");

assert.strictEqual(HEALTH_COMMAND, "AGENT_RELAY_HEALTH");
assert.strictEqual(buildHealthStatusText({ workerId: "dev-a", runningTasks: 1, queuedTasks: 3 }), "AGENT_RELAY_HEALTH\nworker: dev-a\nrunning_tasks: 1\nqueued_tasks: 3");
assert.throws(() => buildHealthStatusText({ workerId: "", runningTasks: 0, queuedTasks: 0 }), /health_worker_id_invalid/);
assert.throws(() => buildHealthStatusText({ workerId: "dev-a", runningTasks: -1, queuedTasks: 0 }), /health_running_tasks_invalid/);
assert.throws(() => buildHealthStatusText({ workerId: "dev-a", runningTasks: 0, queuedTasks: 1.5 }), /health_queued_tasks_invalid/);

console.log("health command regression passed");
