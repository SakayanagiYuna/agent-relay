"use strict";

const assert = require("assert");
const { parseCodexTask } = require("./task-parser");
const { validateBrowserRequest } = require("./browser-evidence");

const task = parseCodexTask(`CODEX_TASK
schema_version: 1
task_id: TASK-025
target_worker: worker-1
target_workspace: baiyuan
target_repo: agent-relay
browser_evidence: screenshot
browser_url: <http://localhost:5173>
browser_viewport: desktop
instruction: |
  Verify the browser handoff.`);

assert.deepStrictEqual(task.browser_evidence, {
  mode: "screenshot",
  url: "http://localhost:5173",
  viewport: "desktop",
});
assert.deepStrictEqual(
  validateBrowserRequest(task.browser_evidence, ["http://localhost:5173"]),
  { url: "http://localhost:5173/", viewport: "desktop" }
);
assert.throws(
  () => validateBrowserRequest({ mode: "screenshot", url: "https://example.com", viewport: "desktop" }, ["http://localhost:5173"]),
  /browser_url_not_loopback/
);

console.log("browser evidence handoff regression passed");
