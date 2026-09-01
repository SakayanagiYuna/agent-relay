"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { CallbackTargetRegistry } = require("./callback-target-registry");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-relay-callback-registry-"));
const filePath = path.join(directory, "callback-registry.json");
try {
  const registry = new CallbackTargetRegistry({ filePath, now: () => "2026-09-01T00:00:00.000Z", randomUUID: () => "fixed-id" });
  const target = registry.register({ platform: "chatgpt", conversation_identity: "https://chatgpt.com/c/conversation-a", browser_context_id: "context-relay-a" });
  assert.deepStrictEqual(target, { callback_target_id: "target-fixed-id", platform: "chatgpt", conversation_identity: "https://chatgpt.com/c/conversation-a", browser_context_id: "context-relay-a", created_at: "2026-09-01T00:00:00.000Z", state: "REGISTERED" });
  assert.deepStrictEqual(registry.resolve(target.callback_target_id), target, "registered target resolves by explicit ID");
  assert.strictEqual(registry.resolve("target-missing"), null, "unknown target fails safely without a fallback");

  const execution = { task_id: "TASK-055", current_status: "RUNNING" };
  const armed = registry.setState(target.callback_target_id, "ARMED");
  execution.current_status = "DONE";
  assert.strictEqual(armed.state, "ARMED");
  assert.strictEqual(registry.resolve(target.callback_target_id).state, "ARMED", "execution changes do not change callback target state");
  assert.strictEqual(execution.current_status, "DONE", "callback target changes do not change execution status");

  const reloaded = new CallbackTargetRegistry({ filePath });
  assert.deepStrictEqual(reloaded.resolve(target.callback_target_id), armed, "target is persisted locally");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

console.log("callback target registry regression passed");
