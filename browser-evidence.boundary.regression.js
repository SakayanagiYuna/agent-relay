"use strict";

const assert = require("assert");
const fs = require("fs");

const listener = fs.readFileSync("listener.js", "utf8");
const lifecycleStart = listener.indexOf("async function runTaskLifecycle");
const lifecycle = listener.slice(lifecycleStart);
const workerStart = listener.indexOf("const workerPrompt");
const worker = listener.slice(workerStart, listener.indexOf("child.stdin.write", workerStart));

assert.ok(lifecycleStart >= 0, "task lifecycle must exist");
assert.ok(
  lifecycle.indexOf("await executeCodexTask") < lifecycle.indexOf("await runBrowserEvidence"),
  "Relay must await Codex completion before browser evidence"
);
assert.match(
  lifecycle,
  /task\.browser_evidence && result\.status === "DONE"/,
  "browser evidence must be terminal-DONE gated"
);
assert.match(
  worker,
  /Browser evidence is executed only by the Relay host after this Codex process exits DONE/,
  "Codex child must be instructed not to launch the browser"
);

console.log("browser evidence host-boundary regression passed");
