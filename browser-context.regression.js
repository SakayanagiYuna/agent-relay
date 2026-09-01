"use strict";

const assert = require("assert");
const http = require("http");
const { CallbackTargetRegistry } = require("./callback-target-registry");
const { createBrowserContextDescriptor, createBrowserTargetDescriptor, createCallbackServer, createRelayManagedBrowser, managedContextId, parseManagedArguments } = require("./browser-callback");

function request(relay, route, body) { return new Promise((resolve, reject) => { const request = http.request({ host: "127.0.0.1", port: relay.server.address().port, method: "POST", path: route, headers: { "content-type": "application/json" } }, (response) => { let text = ""; response.on("data", (chunk) => { text += chunk; }); response.on("end", () => resolve(JSON.parse(text))); }); request.on("error", reject); request.end(body ? JSON.stringify(body) : ""); }); }

function chatPage(identity, calls) { return { url: () => identity, locator: () => ({ first: { fill: async (value) => calls.push(["fill", value]), press: async (key) => calls.push(["press", key]) } }) }; }

(async () => {
  const profilePath = require("path").join(require("os").tmpdir(), `agent-relay-profile-${process.pid}`);
  const launches = [];
  const persistentContexts = [];
  const persistentChromium = {
    async launchPersistentContext(userDataDir, options) {
      const page = { url: () => "about:blank", goto: async (url) => { page.url = () => url; } };
      const context = { pages: () => [page], newPage: async () => page, close: async () => { context.closed = true; } };
      launches.push({ userDataDir, options }); persistentContexts.push(context); return context;
    },
  };
  const managedConfig = parseManagedArguments(["--profile", profilePath, "--start-url", "https://chatgpt.com/c/relay-profile"]);
  assert.strictEqual(managedConfig.profilePath, require("path").resolve(profilePath));
  assert.strictEqual(managedConfig.startUrl, "https://chatgpt.com/c/relay-profile");
  assert.strictEqual(parseManagedArguments(["--start-url", "https://chatgpt.com/", "--profile", profilePath]).profilePath, managedConfig.profilePath);
  assert.throws(() => parseManagedArguments(["--profile", "relative-profile"]), /browser_profile_path_invalid/);
  assert.throws(() => parseManagedArguments(["--start-url", "https://example.com"]), /browser_start_url_must_be_allowlisted_chatgpt_url/);
  assert.throws(() => parseManagedArguments(["--profile", profilePath, "--start-url", "https://chatgpt.com/?next=/c/relay-profile"]), /browser_start_url_must_be_allowlisted_chatgpt_url/);
  const persistentFirst = await createRelayManagedBrowser({ chromium: persistentChromium, ...managedConfig });
  await persistentFirst.close();
  const persistentSecond = await createRelayManagedBrowser({ chromium: persistentChromium, ...managedConfig });
  try {
    assert.strictEqual(launches.length, 2, "Relay restarts reopen the same managed profile");
    assert.strictEqual(launches[0].userDataDir, managedConfig.profilePath);
    assert.strictEqual(launches[0].options.headless, false, "first launch permits manual login");
    assert.strictEqual(persistentFirst.browserContext.id, managedContextId(managedConfig.profilePath));
    assert.strictEqual(persistentSecond.browserContext.id, persistentFirst.browserContext.id, "profile context identity survives Relay restart");
    assert.strictEqual(persistentSecond.context.pages()[0].url(), managedConfig.startUrl, "configured start_url opens in the managed context");
    assert.strictEqual(persistentSecond.browserTarget.type, "start_url");
    assert.strictEqual(persistentSecond.browserTarget.page, persistentSecond.context.pages()[0]);
  } finally { await persistentSecond.close(); }

  const { chromium } = require("playwright");
  let first; let second;
  try { first = await createRelayManagedBrowser({ chromium }); second = await createRelayManagedBrowser({ chromium }); }
  catch (error) { if (/spawn EPERM/.test(error.message || "")) console.log("browser context real-instance regression skipped: sandbox blocks browser process creation"); else throw error; }
  if (first && second) try {
    assert.strictEqual(first.browserContext.ownership, "relay_managed");
    assert.match(first.browserContext.id, /^context-/);
    assert.notStrictEqual(first.browserContext.id, second.browserContext.id);
    await first.context.newPage();
    assert.strictEqual(first.context.pages().length, 1, "Relay-created page stays in its own real Playwright context");
    assert.strictEqual(second.context.pages().length, 0, "another Relay context cannot read the first context's page");
  } finally { await Promise.all([first.close(), second.close()]); }

  const targets = new CallbackTargetRegistry({ filePath: require("path").join(require("os").tmpdir(), `agent-relay-context-${process.pid}-${Date.now()}.json`) });
  const calls = []; const page = chatPage("https://chatgpt.com/c/relay-a", calls);
  const relay = createCallbackServer({ context: { pages: () => [page] }, browserContext: createBrowserContextDescriptor({ context: { pages: () => [page] }, ownership: "relay_managed", contextId: "context-relay-a" }), registry: targets, port: 0 });
  await relay.listen();
  try {
    assert.throws(() => createBrowserContextDescriptor({ ownership: "relay_managed" }), /browser_context_required/, "a missing context is rejected before callback setup");
    let state = await new Promise((resolve, reject) => { http.get({ host: "127.0.0.1", port: relay.server.address().port, path: "/api/state" }, (response) => { let text = ""; response.on("data", (chunk) => { text += chunk; }); response.on("end", () => resolve(JSON.parse(text))); }).on("error", reject); });
    assert.deepStrictEqual(state.browser_context, { id: "context-relay-a", ownership: "relay_managed" });
    const bound = await request(relay, "/api/bind", { page_id: 1 });
    await request(relay, "/api/arm");
    const target = targets.register({ platform: "chatgpt", conversation_identity: "https://chatgpt.com/c/relay-a", browser_context_id: "context-relay-b" });
    targets.setState(target.callback_target_id, "ARMED");
    assert.match(bound.callback_target_id, /^target-/);
    const result = await request(relay, "/api/callback", { task_id: "TASK-068", status: "DONE", callback_target_id: target.callback_target_id });
    assert.strictEqual(result.error, "callback_target_context_mismatch", "a target from another context cannot be delivered here");
    assert.deepStrictEqual(calls, [], "mismatched context does not control a page");
  } finally { await relay.close(); }

  const targetCalls = []; const targetPage = chatPage("https://chatgpt.com/", targetCalls); let targetPages = [targetPage];
  const targetRelay = createCallbackServer({ context: { pages: () => targetPages }, browserContext: createBrowserContextDescriptor({ context: { pages: () => targetPages }, ownership: "relay_managed", contextId: "context-relay-target" }), browserTarget: createBrowserTargetDescriptor({ page: targetPage, startUrl: "https://chatgpt.com/" }), port: 0 });
  await targetRelay.listen();
  try {
    const getState = () => new Promise((resolve, reject) => { http.get({ host: "127.0.0.1", port: targetRelay.server.address().port, path: "/api/state" }, (response) => { let text = ""; response.on("data", (chunk) => { text += chunk; }); response.on("end", () => resolve(JSON.parse(text))); }).on("error", reject); });
    let state = await getState();
    assert.deepStrictEqual(state.browser_target, { type: "start_url", url: "https://chatgpt.com/", browser_context_id: "context-relay-target", page_id: 1, state: "OPEN" });
    targetPages = [];
    state = await getState();
    assert.deepStrictEqual(state.browser_target, { type: "start_url", url: "https://chatgpt.com/", browser_context_id: "context-relay-target", page_id: null, state: "NOT_FOUND" }, "a missing target never falls back to another tab");
  } finally { await targetRelay.close(); }
})().then(() => console.log("browser context ownership/isolation regression passed")).catch((error) => { console.error(error); process.exitCode = 1; });
