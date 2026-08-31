"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { captureBrowserEvidence } = require("./browser-evidence");

const repoPath = process.cwd();
const allowedOrigins = ["http://localhost:5173"];

function createPlaywright({ navigationError, navigationResponse } = {}) {
  const calls = { bodyLocator: 0, screenshot: 0, settleMs: 0 };
  const page = {
    on() {},
    async goto() {
      if (navigationError) throw navigationError;
      return navigationResponse === undefined ? { ok: () => true } : navigationResponse;
    },
    locator() {
      calls.bodyLocator += 1;
      throw new Error("hidden body must not be used as a readiness gate");
    },
    async waitForTimeout(milliseconds) {
      calls.settleMs = milliseconds;
    },
    async screenshot({ path: screenshotPath }) {
      calls.screenshot += 1;
      fs.writeFileSync(screenshotPath, "test screenshot");
    },
  };
  const context = {
    async route() {},
    async newPage() { return page; },
    async close() {},
  };
  return {
    calls,
    playwright: {
      chromium: {
        async launch() {
          return {
            async newContext() { return context; },
            async close() {},
          };
        },
      },
    },
  };
}

async function withMockedPlaywright(fake, action) {
  const playwrightPath = require.resolve("playwright");
  const cached = require.cache[playwrightPath];
  require.cache[playwrightPath] = { id: playwrightPath, filename: playwrightPath, loaded: true, exports: fake };
  try {
    return await action();
  } finally {
    if (cached) require.cache[playwrightPath] = cached;
    else delete require.cache[playwrightPath];
  }
}

async function capture(taskId) {
  return captureBrowserEvidence({
    taskId,
    route: { local_path: repoPath },
    request: { mode: "screenshot", url: "http://localhost:5173", viewport: "desktop" },
    config: { allowedOrigins, timeoutMs: 1_000 },
  });
}

(async () => {
  const success = createPlaywright();
  const evidence = await withMockedPlaywright(success.playwright, () => capture("TEST-RENDERED-STATE"));
  assert.strictEqual(success.calls.bodyLocator, 0, "hidden body must not be used for readiness");
  assert.strictEqual(success.calls.screenshot, 1, "parsed document should still be captured");
  assert.ok(success.calls.settleMs > 0 && success.calls.settleMs <= 500, "render settle must be bounded");
  assert.ok(fs.existsSync(evidence.screenshotPath), "successful capture must produce an artifact");

  const failure = createPlaywright({ navigationError: new Error("navigation failed") });
  await assert.rejects(
    () => withMockedPlaywright(failure.playwright, () => capture("TEST-NAVIGATION-FAILURE")),
    /navigation failed/,
    "navigation failure must fail closed"
  );
  assert.strictEqual(failure.calls.screenshot, 0, "failed navigation must not capture a screenshot");

  const rejectedResponse = createPlaywright({ navigationResponse: { ok: () => false } });
  await assert.rejects(
    () => withMockedPlaywright(rejectedResponse.playwright, () => capture("TEST-NAVIGATION-REJECTED")),
    /browser_navigation_failed/,
    "unsuccessful navigation response must fail closed"
  );
  assert.strictEqual(rejectedResponse.calls.screenshot, 0, "unsuccessful navigation must not capture a screenshot");

  fs.rmSync(path.join(repoPath, ".agent-relay", "evidence", "TEST-RENDERED-STATE"), { recursive: true, force: true });
  fs.rmSync(path.join(repoPath, ".agent-relay", "evidence", "TEST-NAVIGATION-FAILURE"), { recursive: true, force: true });
  fs.rmSync(path.join(repoPath, ".agent-relay", "evidence", "TEST-NAVIGATION-REJECTED"), { recursive: true, force: true });
  console.log("browser evidence rendered-state regression passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
