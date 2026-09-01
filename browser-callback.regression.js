"use strict";
const assert = require("assert");
const http = require("http");
const { BOUND_NAVIGATION_ORIGINS, CHANNELS, EVENT_SCHEMA, attachViaPlaywrightCli, cliLaunchSpec, createCallbackServer, createCliContext, extractChatInputRef, extractSnapshotTextboxRef, extractTabs, extractUrls, isAllowedBoundNavigation, isAllowedChatGPTOrigin, npxCliEntrypoint, parseAttachArguments, renderAgentRelayEvent, resolveChatComposer, targetIdentity, validateAttachEndpoint, validateCallback, validateRelayCallbackUrl } = require("./browser-callback");

assert.deepStrictEqual(CHANNELS, ["msedge", "chrome"]);
assert.strictEqual(isAllowedChatGPTOrigin("https://chatgpt.com/c/abc"), true);
assert.strictEqual(isAllowedChatGPTOrigin("https://chatgpt.com.evil.example/c/abc"), false);
assert.strictEqual(isAllowedChatGPTOrigin("http://chatgpt.com/c/abc"), false);
assert.strictEqual(isAllowedBoundNavigation("https://auth.openai.com/u/login"), false);
assert.ok(BOUND_NAVIGATION_ORIGINS.includes("https://chatgpt.com"));
assert.strictEqual(targetIdentity("https://chatgpt.com/c/abc?oai-dm=1"), "https://chatgpt.com/c/abc");
assert.deepStrictEqual(parseAttachArguments(["--channel", "msedge"], {}), { mode: "channel", channel: "msedge" });
assert.deepStrictEqual(parseAttachArguments([], { AGENT_RELAY_BROWSER_CDP_ENDPOINT: "ws://localhost:9222/devtools/browser/test-id" }), { mode: "endpoint", endpoint: "ws://localhost:9222/devtools/browser/test-id" });
assert.throws(() => parseAttachArguments(["--channel", "firefox"], {}), /channel_must/);
assert.strictEqual(validateAttachEndpoint("http://127.0.0.1:9333"), "http://127.0.0.1:9333/");
assert.throws(() => validateAttachEndpoint("http://example.com:9333"), /explicit_local_cdp/);
assert.throws(() => validateAttachEndpoint("ws://127.0.0.1:9222/devtools/page/page-id"), /browser_cdp/);
assert.strictEqual(validateRelayCallbackUrl("http://127.0.0.1:8787/api/callback"), "http://127.0.0.1:8787/api/callback");
assert.throws(() => validateRelayCallbackUrl("https://chatgpt.com/api/callback"), /explicit_loopback/);
assert.deepStrictEqual(extractUrls("# Tab 0 - https://bilibili.com/video/1\n# Tab 1 - https://chatgpt.com/c/target"), ["https://bilibili.com/video/1", "https://chatgpt.com/c/target"]);
assert.deepStrictEqual(extractTabs("### Result\n- 5: [网站改进建议](https://chatgpt.com/c/target)"), [{ index: 5, title: "网站改进建议", url: "https://chatgpt.com/c/target" }]);
assert.strictEqual(extractChatInputRef('- textbox "与 ChatGPT 聊天" [ref=e1217]'), "e1217");
assert.throws(() => extractChatInputRef('- textbox "搜索" [ref=e1217]'), /composer_not_found/);
assert.strictEqual(extractSnapshotTextboxRef('- textbox "Message ChatGPT" [ref=e1217]'), "e1217");
const rendered = renderAgentRelayEvent({ task_id: "TASK-045", status: "DONE" });
assert.strictEqual(rendered, '{"schema_version":1,"event":"task_terminal","action":"REVIEW","task_id":"TASK-045","status":"DONE"}');
assert.deepStrictEqual(JSON.parse(rendered), { ...EVENT_SCHEMA, task_id: "TASK-045", status: "DONE" });
assert.deepStrictEqual(
  JSON.parse(renderAgentRelayEvent({ task_id: "TASK-085", status: "DONE", slack_channel_id: "C123ABC", slack_status_ts: "1720000000.000100", evidence_file_id: "F085ABC", evidence_permalink: "https://workspace.slack.com/files/U1/F085ABC/evidence.png" })),
  { ...EVENT_SCHEMA, task_id: "TASK-085", status: "DONE", slack_channel_id: "C123ABC", slack_status_ts: "1720000000.000100", evidence_file_id: "F085ABC", evidence_permalink: "https://workspace.slack.com/files/U1/F085ABC/evidence.png" },
  "callback must preserve validated Slack evidence retrieval metadata"
);
assert.deepStrictEqual(
  JSON.parse(renderAgentRelayEvent({ task_id: "TASK-045", status: "FAILED", summary: "do not copy", stderr: "private diagnostic", result: { changed_files: ["listener.js"] }, duration: "01m00s" })),
  { ...EVENT_SCHEMA, task_id: "TASK-045", status: "FAILED" },
  "callback event must remain a wake-up signal and never copy execution details"
);
assert.throws(() => validateCallback({ task_id: "TASK-045", status: "START" }), /callback_status_invalid/);

function request(relay, method, route, body) { return new Promise((resolve, reject) => { const req = http.request({ host: "127.0.0.1", port: relay.server.address().port, method, path: route, headers: { "content-type": "application/json" } }, (res) => { let text = ""; res.on("data", (chunk) => { text += chunk; }); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(text) })); }); req.on("error", reject); if (body) req.write(JSON.stringify(body)); req.end(); }); }

(async () => {
  const composer = await resolveChatComposer(async (executable, args) => {
    if (args.includes("div[contenteditable='true']")) return { stdout: '- textbox "与 ChatGPT 聊天" [ref=e1217]' };
    throw new Error("selector_not_found");
  });
  assert.deepStrictEqual(composer, { ref: "e1217", selector: "div[contenteditable='true']" });

  const cliCalls = [];
  const runner = async (executable, args, options) => { cliCalls.push({ executable, args, options }); const command = args[args.length - 1]; return { stdout: command === "tab-list" ? "# Tab 0 - https://www.bilibili.com/video/1\n# Tab 1 - https://chatgpt.com/c/target" : args.includes("snapshot") ? '- textbox "与 ChatGPT 聊天" [ref=e1217]' : "" }; };
  await attachViaPlaywrightCli({ channel: "msedge", runner });
  const { adapter, context } = createCliContext({ channel: "chrome", runner });
  await adapter.refresh();
  assert.deepStrictEqual(context.pages().map((page) => page.url()), ["https://www.bilibili.com/video/1", "https://chatgpt.com/c/target"]);
  await context.pages()[1].locator("textarea").first.fill("event");
  await context.pages()[1].locator("textarea").first.press("Enter");
  const commandOffset = process.platform === "win32" ? 5 : 4;
  assert.deepStrictEqual(cliCalls.slice(-7).map((call) => call.args.slice(commandOffset)).filter((args) => args[0] !== "tab-list"), [["tab-select", "1"], ["snapshot", "textarea[placeholder*='Message']"], ["fill", "e1217", "event"], ["tab-select", "1"], ["press", "Enter"]]);

  let currentUrl = "https://chatgpt.com/c/target"; let navigationHandler; const calls = [];
  const page = { url: () => currentUrl, route: async () => {}, on: (event, handler) => { if (event === "framenavigated") navigationHandler = handler; }, mainFrame: () => "main", locator: () => ({ first: { fill: async (value) => calls.push(["fill", value]), press: async (key) => calls.push(["press", key]) } }) };
  const otherPage = { url: () => "https://www.bilibili.com/video/1" };
  let configuredTargetId = null;
  const relay = createCallbackServer({ context: { pages: () => [otherPage, page] }, port: 0, configureCallbackTarget: ({ targetId }) => { configuredTargetId = targetId; } }); await relay.listen();
  try {
    let result = await request(relay, "POST", "/api/bind-arm-configure", { page_id: 2 }); assert.strictEqual(result.status, 200); assert.match(result.body.callback_target_id, /^target-/); assert.strictEqual(configuredTargetId, result.body.callback_target_id);
    result = await request(relay, "GET", "/api/state"); assert.strictEqual(result.body.bound, true); assert.strictEqual(result.body.armed, true); assert.strictEqual(result.body.callback_target_state, "ARMED");
    result = await request(relay, "POST", "/api/bind", { page_id: 2 }); assert.strictEqual(result.status, 200); const callbackTargetId = result.body.callback_target_id;
    result = await request(relay, "POST", "/api/send"); assert.strictEqual(result.body.error, "send_guard_blocked");
    result = await request(relay, "POST", "/api/mock-callback", { task_id: "TASK-045", status: "DONE" }); assert.strictEqual(result.body.error, "arm_required_before_callback");
    result = await request(relay, "GET", "/api/state"); assert.strictEqual(result.body.bound, true); assert.strictEqual(result.body.armed, false);
    result = await request(relay, "POST", "/api/send"); assert.strictEqual(result.body.error, "send_guard_blocked");
    result = await request(relay, "POST", "/api/arm"); assert.strictEqual(result.status, 200);
    result = await request(relay, "POST", "/api/callback", { task_id: "TASK-045", status: "DONE", callback_target_id: "target-missing" }); assert.strictEqual(result.body.error, "callback_target_not_armed");
    result = await request(relay, "POST", "/api/callback", { task_id: "TASK-045", status: "DONE", callback_target_id: callbackTargetId }); assert.strictEqual(result.status, 200); assert.deepStrictEqual(calls, [["fill", '{"schema_version":1,"event":"task_terminal","action":"REVIEW","task_id":"TASK-045","status":"DONE"}'], ["press", "Enter"]]); calls.length = 0;
    result = await request(relay, "POST", "/api/mock-callback", { task_id: "TASK-045", status: "BLOCKED" }); assert.match(result.body.event, /"status":"BLOCKED"/);
    result = await request(relay, "POST", "/api/send"); assert.strictEqual(result.status, 200); assert.deepStrictEqual(calls, [["fill", result.body.error ? "" : '{"schema_version":1,"event":"task_terminal","action":"REVIEW","task_id":"TASK-045","status":"BLOCKED"}'], ["press", "Enter"]]);
    currentUrl = "https://chatgpt.com/c/other"; navigationHandler(); result = await request(relay, "GET", "/api/state"); assert.strictEqual(result.body.armed, false); result = await request(relay, "POST", "/api/send"); assert.strictEqual(result.body.error, "send_guard_blocked");
    currentUrl = "https://www.bilibili.com/video/2"; navigationHandler(); result = await request(relay, "GET", "/api/state"); assert.strictEqual(result.body.armed, false);
  } finally { await relay.close(); }
})().then(() => console.log("browser callback CLI/multi-tab/identity/bind-arm regression passed")).catch((error) => { console.error(error); process.exitCode = 1; });

;(async () => {
  let tabOutput = "# Tab 0 - https://www.bilibili.com/video/1\n# Tab 1 - https://chatgpt.com/c/target";
  const calls = [];
  const runner = async (executable, args) => {
    if (args.includes("tab-list")) return { stdout: tabOutput };
    if (args.includes("snapshot")) return { stdout: '- textbox "与 ChatGPT 聊天" [ref=e1217]' };
    calls.push(args.slice(args.indexOf("tab-select")));
    return { stdout: "" };
  };
  const { adapter, context } = createCliContext({ channel: "msedge", runner });
  await adapter.refresh();
  const relay = createCallbackServer({ context, refresh: adapter.refresh, port: 0 });
  await relay.listen();
  try {
    let result = await request(relay, "POST", "/api/bind", { page_id: 2 });
    assert.strictEqual(result.status, 200);
    result = await request(relay, "POST", "/api/send");
    assert.strictEqual(result.body.error, "send_guard_blocked");
    result = await request(relay, "POST", "/api/arm");
    assert.strictEqual(result.status, 200);
    await request(relay, "POST", "/api/mock-callback", { task_id: "TASK-050", status: "DONE" });
    result = await request(relay, "POST", "/api/send");
    assert.strictEqual(result.status, 200);
    assert.ok(calls.length > 0);
    assert.ok(calls.filter((args) => args[0] === "tab-select").every((args) => args[1] === "1"));

    tabOutput = "# Tab 0 - https://chatgpt.com/c/target\n# Tab 1 - https://www.bilibili.com/video/2";
    result = await request(relay, "GET", "/api/state");
    assert.strictEqual(result.body.armed, true);
    calls.length = 0;
    result = await request(relay, "POST", "/api/send");
    assert.strictEqual(result.status, 200);
    assert.ok(calls.filter((args) => args[0] === "tab-select").every((args) => args[1] === "0"));

    tabOutput = "# Tab 0 - https://www.bilibili.com/video/2\n# Tab 1 - https://chatgpt.com/c/other";
    result = await request(relay, "GET", "/api/state");
    assert.strictEqual(result.body.armed, false);
    result = await request(relay, "POST", "/api/send");
    assert.strictEqual(result.body.error, "send_guard_blocked");
  } finally { await relay.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });

const launcher = cliLaunchSpec(["attach", "--cdp=msedge"], "win32");
assert.strictEqual(launcher.args.includes("--shell=true"), false);
assert.strictEqual(launcher.args.some((arg) => arg.includes(";")), false);
if (process.platform === "win32") { assert.strictEqual(launcher.executable, process.execPath); assert.ok(!launcher.executable.endsWith(".cmd")); assert.match(launcher.args[0], /[\\/]npx-cli\.js$/); }
