"use strict";

const fs = require("fs");
const path = require("path");

const MAX_USAGE_RECORDS = 1000;

function tokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function firstCount(...values) {
  for (const value of values) {
    const parsed = tokenCount(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function extractUsage(event) {
  const usage = event?.usage || event?.response?.usage || event?.result?.usage || event?.turn?.usage;
  if (!usage || typeof usage !== "object") return null;
  const inputTokens = firstCount(usage.input_tokens, usage.inputTokens, usage.prompt_tokens, usage.promptTokens);
  const cachedInputTokens = firstCount(usage.input_tokens_details?.cached_tokens, usage.input_tokens_details?.cached_input_tokens, usage.inputTokensDetails?.cachedTokens, usage.prompt_tokens_details?.cached_tokens);
  const outputTokens = firstCount(usage.output_tokens, usage.outputTokens, usage.completion_tokens, usage.completionTokens);
  const reasoningTokens = firstCount(usage.output_tokens_details?.reasoning_tokens, usage.outputTokensDetails?.reasoningTokens, usage.completion_tokens_details?.reasoning_tokens);
  const totalTokens = firstCount(usage.total_tokens, usage.totalTokens, inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);
  if ([inputTokens, cachedInputTokens, outputTokens, reasoningTokens, totalTokens].every((value) => value === null)) return null;
  return { input_tokens: inputTokens, cached_input_tokens: cachedInputTokens, output_tokens: outputTokens, reasoning_tokens: reasoningTokens, total_tokens: totalTokens };
}

function createUsageCollector() {
  let fallback = null;
  let terminal = null;
  return {
    observe(event) {
      const usage = extractUsage(event);
      if (!usage) return null;
      fallback = usage;
      if (String(event?.type || "").toLowerCase() === "turn.completed") terminal = usage;
      return usage;
    },
    usage: () => terminal || fallback,
  };
}

function recordUsage({ stateDir, taskId, workerId, status, usage, now = () => new Date() }) {
  fs.mkdirSync(stateDir, { recursive: true });
  const filePath = path.join(stateDir, "usage-accounting.json");
  let records = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (Array.isArray(parsed.records)) records = parsed.records;
  } catch {}
  const record = { task_id: taskId, worker_id: workerId, status, recorded_at: now().toISOString(), usage: usage || null };
  records = records.filter((item) => item?.task_id !== taskId);
  records.push(record);
  const payload = JSON.stringify({ schema_version: 1, records: records.slice(-MAX_USAGE_RECORDS) }, null, 2);
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, payload, "utf8");
  fs.renameSync(temporary, filePath);
  return record;
}

function formatUsage(usage) {
  if (!usage) return "unavailable";
  return ["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_tokens", "total_tokens"].map((key) => `${key}=${usage[key] ?? "unavailable"}`).join(" ");
}

module.exports = { createUsageCollector, extractUsage, formatUsage, recordUsage };
