"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createUsageCollector, extractUsage, formatUsage, recordUsage } = require("./usage-accounting");

const usage = extractUsage({ usage: { input_tokens: 120, input_tokens_details: { cached_tokens: 20 }, output_tokens: 30, output_tokens_details: { reasoning_tokens: 10 }, total_tokens: 150 } });
assert.deepStrictEqual(usage, { input_tokens: 120, cached_input_tokens: 20, output_tokens: 30, reasoning_tokens: 10, total_tokens: 150 });
assert.strictEqual(formatUsage(usage), "input_tokens=120 cached_input_tokens=20 output_tokens=30 reasoning_tokens=10 total_tokens=150");
const collector = createUsageCollector(); collector.observe({ usage: { input_tokens: 1, output_tokens: 2 } }); collector.observe({ type: "turn.completed", usage: { input_tokens: 4, output_tokens: 5, total_tokens: 9 } }); assert.strictEqual(collector.usage().total_tokens, 9);
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-relay-usage-"));
try { recordUsage({ stateDir, taskId: "TASK-1", workerId: "dev-a", status: "DONE", usage, now: () => new Date("2026-09-01T00:00:00.000Z") }); const saved = JSON.parse(fs.readFileSync(path.join(stateDir, "usage-accounting.json"), "utf8")); assert.strictEqual(saved.records[0].usage.total_tokens, 150); } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
console.log("usage accounting regression passed");
