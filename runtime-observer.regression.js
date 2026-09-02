"use strict";
const assert = require("assert"); const { RuntimeObserver } = require("./runtime-observer");
const observer = new RuntimeObserver({ workerId: "relay-1", now: () => new Date("2026-01-01T00:00:00.000Z") });
observer.relay("RUNNING"); observer.queue({ running: 1, queued: 2 }); observer.task({ task_id: "TASK-1", agent: "codex", workspace: "ws", repo: "repo" }, "START"); observer.activity("执行测试", 1000); observer.evidence("CAPTURING");
assert.deepStrictEqual(observer.snapshot().queue, { running: 1, queued: 2 }); assert.strictEqual(observer.snapshot().task.activity, "执行测试"); observer.terminal({ task: { task_id: "TASK-1", agent: "codex", repo: "repo" }, status: "DONE", elapsed_ms: 2000 });
assert.strictEqual(observer.snapshot().task, null); assert.strictEqual(observer.snapshot().last_terminal.status, "DONE"); assert.throws(() => observer.relay("UNKNOWN")); console.log("runtime-observer regression: passed");
