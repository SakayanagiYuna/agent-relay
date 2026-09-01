"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DEFAULT_MANAGED_START_URL, createRelayManagedBrowser, parseManagedArguments } = require("./browser-callback");
const { bootstrapManagedBrowser } = require("./browser-bootstrap");

function chromiumFor(finalUrl, launches = []) {
  return {
    async launchPersistentContext(profilePath, options) {
      const page = { currentUrl: "about:blank", url() { return this.currentUrl; }, async goto(url) { this.currentUrl = finalUrl || url; } };
      const context = { pages: () => [page], newPage: async () => page, close: async () => {} };
      launches.push({ profilePath, options });
      return context;
    },
  };
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-relay-bootstrap-"));
  try {
    const absentProfile = path.join(root, "absent-profile");
    const defaultConfig = parseManagedArguments(["--profile", absentProfile]);
    assert.strictEqual(defaultConfig.startUrl, DEFAULT_MANAGED_START_URL, "a first bootstrap opens ChatGPT by default");
    const absentLogs = []; const absentLaunches = [];
    const absent = await createRelayManagedBrowser({ chromium: chromiumFor("https://auth.openai.com/log-in", absentLaunches), ...defaultConfig, lifecycleLog: (line) => absentLogs.push(line) });
    try {
      assert.strictEqual(fs.existsSync(absentProfile), true, "bootstrap creates its persistent profile directory before launch");
      assert.deepStrictEqual(absentLaunches[0].options, { headless: false }, "bootstrap launches a visible browser");
      assert.strictEqual(absent.authenticationState, "authentication required");
      assert.deepStrictEqual(absentLogs, [`[BROWSER] launching visible Chromium`, `[BROWSER] profile path: ${path.resolve(absentProfile)}`, "[BROWSER] authentication required"]);
    } finally { await absent.close(); }

    const unauthenticatedProfile = path.join(root, "unauthenticated-profile"); fs.mkdirSync(unauthenticatedProfile);
    const unauthenticatedLogs = [];
    const unauthenticated = await createRelayManagedBrowser({ chromium: chromiumFor("https://auth.openai.com/log-in"), profilePath: unauthenticatedProfile, lifecycleLog: (line) => unauthenticatedLogs.push(line) });
    try {
      assert.strictEqual(unauthenticated.authenticationState, "authentication required", "an existing profile without a session waits for manual login");
      assert.strictEqual(unauthenticatedLogs.at(-1), "[BROWSER] authentication required");
    } finally { await unauthenticated.close(); }

    const authenticatedProfile = path.join(root, "authenticated-profile"); fs.mkdirSync(authenticatedProfile);
    const authenticatedLogs = [];
    const authenticated = await createRelayManagedBrowser({ chromium: chromiumFor("https://chatgpt.com/"), profilePath: authenticatedProfile, lifecycleLog: (line) => authenticatedLogs.push(line) });
    try {
      assert.strictEqual(authenticated.authenticationState, "ready", "an existing ChatGPT session is ready for continued use");
      assert.strictEqual(authenticatedLogs.at(-1), "[BROWSER] ready");
    } finally { await authenticated.close(); }

    const runtimeProfile = path.join(root, "runtime-profile");
    const runtimeLogs = [];
    const runtime = await bootstrapManagedBrowser({ chromium: chromiumFor("https://auth.openai.com/log-in"), args: ["--profile", runtimeProfile], lifecycleLog: (line) => runtimeLogs.push(line) });
    try {
      assert.deepStrictEqual(runtime.initializationState, { profile: "PROFILE_NEW", authorization: "AUTH_REQUIRED" });
      assert(runtimeLogs.includes("[BROWSER] Creating persistent profile"));
      assert(runtimeLogs.includes("headless: false"));
      assert(runtimeLogs.includes("context created: true"));
      assert(runtimeLogs.includes("profile state: PROFILE_NEW"));
      assert(runtimeLogs.includes("authentication state: AUTH_REQUIRED"));
      assert(runtimeLogs.some((line) => line.includes("waiting for manual login")));
    } finally { await runtime.close(); }

    const restored = await bootstrapManagedBrowser({ chromium: chromiumFor("https://chatgpt.com/"), args: ["--profile", runtimeProfile], lifecycleLog: () => {} });
    try { assert.deepStrictEqual(restored.initializationState, { profile: "PROFILE_EXISTING", authorization: "SESSION_RESTORED" }); }
    finally { await restored.close(); }

    const disabledLogs = [];
    const disabled = await bootstrapManagedBrowser({ chromium: chromiumFor("https://chatgpt.com/"), args: ["--profile", path.join(root, "disabled-profile")], environment: { AGENT_RELAY_BROWSER_RUNTIME_ENABLED: "false" }, lifecycleLog: (line) => disabledLogs.push(line) });
    assert.strictEqual(disabled.disabled, true, "a disabled runtime does not launch Chromium");
    assert.deepStrictEqual(disabledLogs, ["[BROWSER] runtime disabled by AGENT_RELAY_BROWSER_RUNTIME_ENABLED=false"]);

    await assert.rejects(
      () => createRelayManagedBrowser({ chromium: { launchPersistentContext: async () => { throw new Error("Target page, context or browser has been closed"); } }, profilePath: path.join(root, "locked-profile") }),
      /browser_profile_in_use_close_existing_managed_browser/,
      "a locked managed profile reports an actionable error"
    );

    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
    assert.strictEqual(packageJson.scripts["browser:init"], "node browser-runtime-init.js", "browser:init uses the manual native browser runtime entry");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().then(() => console.log("visible browser bootstrap regression passed")).catch((error) => { console.error(error); process.exitCode = 1; });
