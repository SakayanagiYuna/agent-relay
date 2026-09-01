const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

function formatElapsed(elapsedMs) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}m${String(seconds).padStart(2, "0")}s`;
}

function createExecutionHeartbeat({ taskId, workerId, intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS, now = () => new Date(), setIntervalFn = setInterval, clearIntervalFn = clearInterval, onHeartbeat = async () => {}, onError = () => {} }) {
  let timer = null;
  let context = null;

  function timestamp() {
    return now().toISOString();
  }

  function elapsedMs() {
    return context ? Math.max(0, now().getTime() - Date.parse(context.started_at)) : 0;
  }

  async function heartbeat() {
    if (!context || context.current_status !== "RUNNING") return null;
    context.last_heartbeat_at = timestamp();
    try {
      await onHeartbeat({ ...context, elapsed_ms: elapsedMs() });
    } catch (error) {
      onError(error, { ...context });
    }
    return { ...context, elapsed_ms: elapsedMs() };
  }

  function start() {
    if (context) throw new Error("execution_heartbeat_already_started");
    const startedAt = timestamp();
    context = { task_id: taskId, worker_id: workerId, started_at: startedAt, current_status: "RUNNING", last_heartbeat_at: startedAt };
    timer = setIntervalFn(() => { void heartbeat(); }, intervalMs);
    if (typeof timer?.unref === "function") timer.unref();
    return { ...context };
  }

  function stop(status) {
    if (timer) clearIntervalFn(timer);
    timer = null;
    if (!context) return { context: null, elapsed_ms: 0 };
    context.current_status = status;
    return { context: { ...context }, elapsed_ms: elapsedMs() };
  }

  return { start, heartbeat, stop, getContext: () => context ? { ...context } : null, isRunning: () => Boolean(timer) };
}

function buildHeartbeatText({ taskId, workerId, elapsedMs }) {
  return ["Agent Relay heartbeat", "", "Task:", taskId, "", "Worker:", workerId, "", "Status:", "RUNNING", "", "Elapsed:", formatElapsed(elapsedMs)].join("\n");
}

function buildCompletionSummary({ status, taskId, workerId, elapsedMs }) {
  const heading = status === "DONE" ? "Task completed" : status === "BLOCKED" ? "Task blocked" : "Task failed";
  return [heading, "", "Task:", taskId, "", "Worker:", workerId, "", "Duration:", formatElapsed(elapsedMs)].join("\n");
}

module.exports = { DEFAULT_HEARTBEAT_INTERVAL_MS, buildCompletionSummary, buildHeartbeatText, createExecutionHeartbeat, formatElapsed };
