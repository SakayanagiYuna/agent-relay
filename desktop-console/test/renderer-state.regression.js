"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { connect, selectedPage, state, isCallbackOffline } = require("../src/callback-service");

const html = fs.readFileSync(path.join(__dirname, "../src/renderer/index.html"), "utf8");
const terminalHtml = fs.readFileSync(path.join(__dirname, "../src/renderer/terminal.html"), "utf8");
const surface = html.match(/<section id="overview"[\s\S]*?<aside class="right-rail">/)[0];
const rightRail = html.match(/<aside class="right-rail">[\s\S]*?<\/aside>/)[0];
assert.match(surface, /id="browserHost"/);
assert.doesNotMatch(surface, /id="consoleLog"/);
assert.doesNotMatch(surface, /id="taskPanel"/);
assert.doesNotMatch(surface, /callback-panel/);
assert.match(rightRail, /id="taskPanel"/);
assert.match(rightRail, /id="defaultAgent"/);
assert.match(rightRail, /callback-panel/);
assert.match(rightRail, /id="pages"/);
assert.match(rightRail, /id="connect"/);
assert.match(terminalHtml, /id="consoleLog"/);
assert.match(terminalHtml, /id="toggleTerminal"/);
assert.match(terminalHtml, /class="console-terminal"/);

assert.strictEqual(selectedPage([{ id: 4 }], "4").id, 4);
assert.strictEqual(selectedPage([{ id: 4 }], 0), null);
assert.strictEqual(selectedPage([], 4), null);

let calls = 0;
const request = async (input) => {
  calls += 1;
  if (input.path === "/api/state") {
    return calls === 1
      ? { pages: [{ id: 4, title: "Conversation" }], bound: false, armed: false }
      : { pages: [{ id: 4 }], bound: true, armed: true, callback_target_state: "ARMED" };
  }
  return { message: "ok" };
};

const manyPages = async (input) => {
  if (input.path === "/api/state") return { pages: [{ id: 4 }, { id: 5 }], bound: false, armed: false };
  return { message: "ok" };
};

assert.strictEqual(isCallbackOffline({ code: "ECONNREFUSED", message: "connect ECONNREFUSED 127.0.0.1:8787" }), true);
assert.strictEqual(isCallbackOffline(new Error("callback_no_chatgpt_conversation")), false);

(async () => {
  const offline = await state(async () => {
    throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8787"), { code: "ECONNREFUSED" });
  });
  assert.strictEqual(offline.available, false);
  assert.strictEqual(offline.error, "callback_unavailable");
  await assert.rejects(
    () => connect(4, async () => { throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8787"), { code: "ECONNREFUSED" }); }),
    /callback_unavailable/
  );
  const connected = await connect(4, request);
  assert.strictEqual(connected.armed, true);
  assert.strictEqual(calls, 3);
  const unique = await connect(99, request);
  assert.strictEqual(unique.armed, true, "a unique ChatGPT page may be connected without matching the stale id");
  await assert.rejects(() => connect(7, manyPages), /callback_requires_explicit_page_selection/);
  console.log("renderer-state regression: passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
