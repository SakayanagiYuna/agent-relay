"use strict";

const TERMINAL_STATUSES = new Set(["DONE", "FAILED", "BLOCKED"]);

function inferReportedTerminalStatus(summary) {
  const candidate = String(summary || "").slice(0, 4000);
  const match = candidate.match(/(?:^|\n)\s*(?:AGENT_RELAY_RESULT|status|状态)\s*[:：]\s*(DONE|FAILED|BLOCKED)\b/i);
  if (!match) return null;
  const status = match[1].toUpperCase();
  return TERMINAL_STATUSES.has(status) ? status : null;
}

function resolveWorkerOutcome({ exitCode, summary } = {}) {
  if (exitCode !== 0) return null;
  const reportedStatus = inferReportedTerminalStatus(summary);
  return reportedStatus && reportedStatus !== "DONE" ? reportedStatus : "DONE";
}

module.exports = { inferReportedTerminalStatus, resolveWorkerOutcome };
