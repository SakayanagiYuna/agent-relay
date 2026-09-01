"use strict";

const HEALTH_COMMAND = "AGENT_RELAY_HEALTH";

function assertTaskCount(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name}_invalid`);
  return value;
}

function buildHealthStatusText({ workerId, runningTasks, queuedTasks }) {
  const name = String(workerId || "").trim();
  if (!name) throw new Error("health_worker_id_invalid");
  return [
    HEALTH_COMMAND,
    `worker: ${name}`,
    `running_tasks: ${assertTaskCount(runningTasks, "health_running_tasks")}`,
    `queued_tasks: ${assertTaskCount(queuedTasks, "health_queued_tasks")}`,
  ].join("\n");
}

module.exports = { HEALTH_COMMAND, buildHealthStatusText };
