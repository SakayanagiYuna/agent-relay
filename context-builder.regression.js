"use strict";

const assert = require("assert");
const { parseCodexTask } = require("./task-parser");
const { buildContext, selectContextFragments } = require("./context-builder");

const route = { workspace_id: "workspace-1", repo_id: "agent-relay", local_path: __dirname, sandboxMode: "workspace-write" };
function task(instruction, extra = "") {
  return parseCodexTask(`CODEX_TASK\nschema_version: 1\ntask_id: TASK-CONTEXT\ntarget_worker: worker-1\ntarget_workspace: workspace-1\ntarget_repo: agent-relay\n${extra}instruction: |\n  ${instruction}`);
}

const docs = buildContext({ task: task("Update docs/guide.md with Simplified Chinese documentation."), route });
const doctor = buildContext({ task: task("Run npm run doctor and update doctor.js readiness checks."), route });
const browser = buildContext({ task: task("Verify Browser Evidence screenshot handoff."), route, });
assert.deepStrictEqual(docs.selectedFragments, ["docs"]);
assert.deepStrictEqual(doctor.selectedFragments, ["doctor"]);
assert.deepStrictEqual(browser.selectedFragments, ["browser-evidence"]);
assert.notStrictEqual(docs.prompt, doctor.prompt);
assert.notStrictEqual(doctor.prompt, browser.prompt);
assert(!docs.prompt.includes("Doctor: keep checks"));
assert(!docs.prompt.includes("Browser Evidence: Relay host-only"));

const structuredBrowser = task("Capture the requested page after completion.", "browser_evidence: screenshot\nbrowser_url: http://127.0.0.1:3000\nbrowser_viewport: 1280x720\n");
const structuredBrowserContext = buildContext({ task: structuredBrowser, route });
assert.deepStrictEqual(structuredBrowserContext.selectedFragments, ["browser-evidence"]);

const unrelated = buildContext({ task: task("Rename a local helper function."), route });
assert.deepStrictEqual(unrelated.selectedFragments, []);
assert.deepStrictEqual(unrelated.prompt, buildContext({ task: task("Rename a local helper function."), route }).prompt);
assert.deepStrictEqual(selectContextFragments(task("Update README.md documentation.")), ["docs"]);
assert.match(unrelated.prompt, /Pre-existing dirty git state is not FAILED/);

const acceptance = "acceptance-" + "x".repeat(5000);
const longTask = task(`Implement change. Acceptance: ${acceptance}`);
const longContext = buildContext({ task: longTask, route });
assert(longContext.prompt.endsWith(`User instruction:\nImplement change. Acceptance: ${acceptance}`));
assert.strictEqual(longContext.telemetry.taskChars, longTask.instruction.length);
assert.strictEqual(longContext.telemetry.finalPromptChars, longContext.prompt.length);
assert(!JSON.stringify(longContext.telemetry).includes("acceptance-"));
assert(!JSON.stringify(longContext.telemetry).includes("worker-1"));
assert.strictEqual(longTask.schema_version, "1");
assert.strictEqual(longTask.target_repo, "agent-relay");

console.log("context builder regression passed");
