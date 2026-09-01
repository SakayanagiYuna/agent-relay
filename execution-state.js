"use strict";

// `START` is the accepted lifecycle event. The in-process execution begins in
// `RUNNING` only after that event has been sent successfully.
const EXECUTION_STATUSES = Object.freeze(["START", "RUNNING", "DONE", "FAILED", "BLOCKED"]);
const TERMINAL_EXECUTION_STATUSES = Object.freeze(["DONE", "FAILED", "BLOCKED"]);

function assertExecutionStatus(status) {
  if (!EXECUTION_STATUSES.includes(status)) throw new Error("execution_status_invalid");
  return status;
}

function isTerminalExecutionStatus(status) {
  return TERMINAL_EXECUTION_STATUSES.includes(status);
}

function assertExecutionTransition(from, to) {
  assertExecutionStatus(from);
  assertExecutionStatus(to);
  const allowed = (from === "START" && to === "RUNNING") || (from === "RUNNING" && isTerminalExecutionStatus(to));
  if (!allowed) throw new Error("execution_status_transition_invalid");
  return to;
}

module.exports = {
  EXECUTION_STATUSES,
  TERMINAL_EXECUTION_STATUSES,
  assertExecutionStatus,
  assertExecutionTransition,
  isTerminalExecutionStatus,
};
