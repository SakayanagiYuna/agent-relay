"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  WorkerSessionStore,
  buildCodexExecArgs,
  extractWorkerSessionId,
  resolveResumeSessionId,
  workerSessionKey,
} = require("./worker-session");

assert.strictEqual(workerSessionKey({ agent: "codex", workspaceId: "workspace-1", repoId: "agent-relay" }), "codex:workspace-1:agent-relay");
assert.strictEqual(extractWorkerSessionId({ session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }), "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
assert.strictEqual(extractWorkerSessionId({ thread_id: "thread-relay-01" }), "thread-relay-01");
assert.strictEqual(extractWorkerSessionId({ type: "text", data: "no" }), null);

const newArgs = buildCodexExecArgs({ windowsSandbox: "unelevated", sandboxMode: "workspace-write", repoPath: "D:\\repo" });
assert.ok(!newArgs.includes("--ephemeral"));
assert.ok(!newArgs.includes("resume"));
assert.strictEqual(newArgs.at(-1), "-");

const resumeArgs = buildCodexExecArgs({
  resumeSessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  windowsSandbox: "unelevated",
  sandboxMode: "workspace-write",
  repoPath: "D:\\repo",
});
assert.deepStrictEqual(resumeArgs.slice(-3), ["resume", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "-"]);
assert.throws(() => buildCodexExecArgs({ resumeSessionId: "bad", windowsSandbox: "unelevated", sandboxMode: "workspace-write", repoPath: "D:\\repo" }), /worker_session_id_invalid/);

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-relay-session-"));
const filePath = path.join(directory, "worker-sessions.json");
const store = new WorkerSessionStore({ filePath });
const key = workerSessionKey({ agent: "grok", workspaceId: "workspace-1", repoId: "agent-relay" });
assert.strictEqual(resolveResumeSessionId({ conversation: "continue", agent: "grok", workspaceId: "workspace-1", repoId: "agent-relay", store }), null);
store.put(key, { agent: "grok", workspace_id: "workspace-1", repo_id: "agent-relay", session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", last_task_id: "TASK-1" });
assert.strictEqual(resolveResumeSessionId({ conversation: "continue", agent: "grok", workspaceId: "workspace-1", repoId: "agent-relay", store }), "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
assert.strictEqual(resolveResumeSessionId({ conversation: "new", agent: "grok", workspaceId: "workspace-1", repoId: "agent-relay", store }), null);
assert.strictEqual(resolveResumeSessionId({ conversation: "continue", agent: "codex", workspaceId: "workspace-1", repoId: "agent-relay", store }), null);
store.clear(key);
assert.strictEqual(store.get(key), null);
fs.rmSync(directory, { recursive: true, force: true });
console.log("worker-session regression: passed");
