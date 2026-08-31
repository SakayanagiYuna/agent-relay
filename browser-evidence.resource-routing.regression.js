"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { captureBrowserEvidence, isAllowedResourceUrl } = require("./browser-evidence");

const repoPath = process.cwd();
const allowedOrigins = ["http://localhost:5173"];
const requests = [
  { url: "http://localhost:5173/@vite/client", resourceType: "script" },
  { url: "http://localhost:5173/src/main.js", resourceType: "script" },
  { url: "http://localhost:5173/node_modules/.vite/deps/vue.js?v=build-id", resourceType: "script" },
  { url: "http://localhost:5173/src/App.vue?vue&type=script", resourceType: "script" },
  { url: "http://localhost:5173/src/styles/global.css?t=build-id", resourceType: "stylesheet" },
  { url: "http://localhost:5173/api/bootstrap?compact=1", resourceType: "fetch" },
  { url: "http://localhost:5173/assets/app.woff2?v=build-id", resourceType: "font" },
  { url: "http://127.0.0.1:5173/not-allowlisted.js", resourceType: "script" },
  { url: "https://example.com/analytics.js", resourceType: "script" },
];

function createPlaywright() {
  const calls = { continued: [], aborted: [], screenshot: 0 };
  let routeHandler;
  const page = {
    on() {},
    async goto() {
      for (const entry of requests) {
        await routeHandler({
          request: () => ({
            url: () => entry.url,
            resourceType: () => entry.resourceType,
          }),
          continue: async () => calls.continued.push(entry),
          abort: async () => calls.aborted.push(entry),
        });
      }
      return { ok: () => true };
    },
    async waitForTimeout() {},
    async screenshot({ path: screenshotPath }) {
      calls.screenshot += 1;
      fs.writeFileSync(screenshotPath, "test screenshot");
    },
  };
  const context = {
    async route(_pattern, handler) { routeHandler = handler; },
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

(async () => {
  assert.ok(isAllowedResourceUrl("http://localhost:5173/node_modules/.vite/deps/vue.js?v=build-id", allowedOrigins));
  assert.ok(!isAllowedResourceUrl("http://127.0.0.1:5173/not-allowlisted.js", allowedOrigins));
  assert.ok(!isAllowedResourceUrl("https://example.com/analytics.js", allowedOrigins));

  const fake = createPlaywright();
  const evidence = await withMockedPlaywright(fake.playwright, () => captureBrowserEvidence({
    taskId: "TEST-RESOURCE-ROUTING",
    route: { local_path: repoPath },
    request: { mode: "screenshot", url: "http://localhost:5173", viewport: "desktop" },
    config: { allowedOrigins, timeoutMs: 1_000 },
  }));

  assert.deepStrictEqual(
    fake.calls.continued.map((entry) => entry.resourceType),
    ["script", "script", "script", "script", "stylesheet", "fetch", "font"],
    "same-origin SPA resources, including versioned modules, must continue"
  );
  assert.deepStrictEqual(
    fake.calls.aborted.map((entry) => entry.resourceType),
    ["script", "script"],
    "non-allowlisted loopback and external resources must remain fail-closed"
  );
  assert.strictEqual(fake.calls.screenshot, 1, "allowed SPA resources must reach screenshot capture");
  assert.ok(fs.existsSync(evidence.screenshotPath), "successful capture must produce an artifact");

  fs.rmSync(path.join(repoPath, ".agent-relay", "evidence", "TEST-RESOURCE-ROUTING"), { recursive: true, force: true });
  console.log("browser evidence resource-routing regression passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
