"use strict";
const RELAY_STATES = new Set(["STARTING", "RUNNING", "STOPPING", "STOPPED", "FAILED"]);
const TASK_STATUSES = new Set(["START", "RUNNING", "DONE", "FAILED", "BLOCKED"]);
const EVIDENCE_STATES = new Set(["IDLE", "CAPTURING", "UPLOADING", "UPLOADED", "FAILED"]);
function clone(value) { return JSON.parse(JSON.stringify(value)); }
class RuntimeObserver {
  constructor({ workerId = null, now = () => new Date() } = {}) { this.now = now; this.state = { schema_version: 1, relay: { state: "STARTING", worker_id: workerId, started_at: null }, queue: { running: 0, queued: 0 }, task: null, browser_evidence: { state: "IDLE", task_id: null }, last_terminal: null }; }
  snapshot() { return clone(this.state); }
  relay(state) { if (!RELAY_STATES.has(state)) throw new Error("runtime_relay_state_invalid"); this.state.relay.state = state; if (state === "RUNNING" && !this.state.relay.started_at) this.state.relay.started_at = this.now().toISOString(); }
  queue({ running, queued }) { if (![running, queued].every(Number.isSafeInteger) || running < 0 || queued < 0) throw new Error("runtime_queue_invalid"); this.state.queue = { running, queued }; }
  task(task, status = task?.status) { if (!task) { this.state.task = null; return; } if (!TASK_STATUSES.has(status)) throw new Error("runtime_task_status_invalid"); this.state.task = { task_id: String(task.task_id), agent: String(task.agent), workspace: String(task.workspace || task.workspace_id || ""), repo: String(task.repo || task.repo_id || ""), status, started_at: task.started_at || this.now().toISOString(), elapsed_ms: Number.isSafeInteger(task.elapsed_ms) ? task.elapsed_ms : 0, activity: task.activity || null }; }
  activity(activity, elapsedMs) { if (!this.state.task) return; this.state.task.activity = activity || null; if (Number.isSafeInteger(elapsedMs)) this.state.task.elapsed_ms = elapsedMs; }
  evidence(state, taskId = this.state.task?.task_id || null) { if (!EVIDENCE_STATES.has(state)) throw new Error("runtime_evidence_state_invalid"); this.state.browser_evidence = { state, task_id: taskId }; }
  terminal({ task, status, elapsed_ms }) { if (!["DONE", "FAILED", "BLOCKED"].includes(status)) throw new Error("runtime_terminal_status_invalid"); this.state.last_terminal = { task_id: task.task_id, agent: task.agent, repo: task.repo || task.repo_id, status, elapsed_ms: Number.isSafeInteger(elapsed_ms) ? elapsed_ms : 0, completed_at: this.now().toISOString() }; this.state.task = null; this.evidence("IDLE", null); }
}
module.exports = { RuntimeObserver, RELAY_STATES, TASK_STATUSES, EVIDENCE_STATES };
