"use strict";

const { isTerminalExecutionStatus } = require("./execution-state");

function buildTerminalEvent({ taskId, status, elapsedSec } = {}) {
  const normalizedTaskId = String(taskId || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(normalizedTaskId)) throw new Error("callback_task_id_invalid");
  if (!isTerminalExecutionStatus(status)) throw new Error("callback_status_invalid");
  if (elapsedSec !== undefined && (!Number.isSafeInteger(elapsedSec) || elapsedSec < 0)) throw new Error("terminal_elapsed_sec_invalid");
  return {
    schema_version: 1,
    event: "task_terminal",
    task_id: normalizedTaskId,
    status,
    ...(elapsedSec === undefined ? {} : { elapsed_sec: elapsedSec }),
  };
}

function buildTerminalCallbackPayload({ taskId, status, callbackTargetId, slackStatusTs, slackChannelId, evidenceReference } = {}) {
  const terminalEvent = buildTerminalEvent({ taskId, status });
  // Keep this envelope a wake-up signal. callback_target_id is delivery routing,
  // not execution data; duration and execution details remain in Slack.
  const payload = {
    task_id: terminalEvent.task_id,
    status: terminalEvent.status,
    ...(callbackTargetId ? { callback_target_id: String(callbackTargetId) } : {}),
  };
  if (slackStatusTs) payload.slack_status_ts = String(slackStatusTs);
  if (slackChannelId) payload.slack_channel_id = String(slackChannelId);
  if (evidenceReference?.fileId) payload.evidence_file_id = String(evidenceReference.fileId);
  if (evidenceReference?.permalink) payload.evidence_permalink = String(evidenceReference.permalink);
  return payload;
}

module.exports = { buildTerminalEvent, buildTerminalCallbackPayload };
