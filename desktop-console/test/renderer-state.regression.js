"use strict";
const assert = require("assert");
const { connect, selectedPage } = require("../src/callback-service");

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

connect(4, request).then((state) => {
  assert.strictEqual(state.armed, true);
  assert.strictEqual(calls, 3);
  return connect(99, request);
}).then((state) => {
  assert.strictEqual(state.armed, true, "a unique ChatGPT page may be connected without matching the stale id");
  return assert.rejects(() => connect(7, manyPages), /callback_requires_explicit_page_selection/);
}).then(() => console.log("renderer-state regression: passed"));
