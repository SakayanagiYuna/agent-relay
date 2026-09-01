"use strict";

const TERMINAL_STATUSES = new Set(["DONE", "FAILED", "BLOCKED"]);

function indentBlock(value) {
  return String(value || "").split(/\r?\n/).map((line) => `  ${line}`);
}

function inferTestResult(summary) {
  const text = String(summary || "");
  if (!/\b(?:npm\s+(?:run\s+)?test|node\s+--test|pytest|go\s+test|cargo\s+test)\b/i.test(text)) return null;
  if (/\b(?:fail(?:ed|ure)?|error)\b/i.test(text)) return "failed";
  if (/\b(?:pass(?:ed)?|success(?:ful|fully)?)\b/i.test(text)) return "passed";
  return "executed; outcome not reported by worker";
}

function buildStatusText({ status, task, route, workerId, summary, duration, gitAudit, testResult, evidenceReference }) {
  const lines = ["CODEX_STATUS", "schema_version: 1", `task_id: ${task.task_id}`, `status: ${status}`, `worker: ${workerId}`, `workspace: ${route.workspace_id}`, `repo: ${route.repo_id}`];
  if (!TERMINAL_STATUSES.has(status)) return lines.concat(summary ? ["summary: |", ...indentBlock(summary)] : []).join("\n");
  lines.push(`duration: ${duration || "unavailable"}`);
  lines.push(`git_commit: ${gitAudit?.commit || "unavailable"}`);
  if (Array.isArray(gitAudit?.changedFiles)) {
    lines.push("changed_files: |", ...indentBlock(gitAudit.changedFiles.length ? gitAudit.changedFiles.join("\n") : "none"));
  } else {
    lines.push("changed_files: unavailable");
  }
  lines.push(`git_diff_summary: ${gitAudit?.summary || "unavailable"}`);
  const resolvedTestResult = testResult || inferTestResult(summary);
  if (resolvedTestResult) lines.push(`test_result: ${resolvedTestResult}`);
  if (evidenceReference?.fileId) lines.push(`evidence_file_id: ${evidenceReference.fileId}`);
  if (evidenceReference?.permalink) lines.push(`evidence_permalink: ${evidenceReference.permalink}`);
  if (summary) lines.push(status === "DONE" ? "summary: |" : "reason: |", ...indentBlock(summary));
  return lines.join("\n");
}

module.exports = { buildStatusText, inferTestResult };
