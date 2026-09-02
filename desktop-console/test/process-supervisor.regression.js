"use strict";
const assert = require("assert");
const path = require("path");
const EventEmitter = require("events");
const { ProcessSupervisor, isAlive, nodeSpawnEnv, sanitizeLog } = require("../src/process-supervisor");
const { resolveConsoleProfilePath, profileLockExists } = require("../src/browser-service");
const { chromeLaunchArgs, chromeSpawnOptions } = require("../../browser-runtime-init");

function child() {
  const value = new EventEmitter();
  value.killed = false;
  value.exitCode = null;
  value.connected = true;
  value.send = (message) => { value.sent = message; };
  value.kill = () => { value.killed = true; };
  return value;
}

assert.strictEqual(nodeSpawnEnv({ CUSTOM: "1" }).ELECTRON_RUN_AS_NODE, "1");
assert.strictEqual(sanitizeLog("browser-runtime", "[61452:118468:0902/131122.755:ERROR:components\\device_event_log\\device_event_log_impl.cc:211] USB: usb_service_win.cc:108 SetupDiGetDeviceProperty failed"), "");
assert.strictEqual(sanitizeLog("browser-runtime", "Registration response error message: DEPRECATED_ENDPOINT"), "");
assert.strictEqual(sanitizeLog("browser-runtime", "[WARNING] Ignore caches that are heterogeneous"), "");
assert.match(sanitizeLog("browser-runtime", "[BROWSER] Launching visible Chromium for manual login"), /Launching visible Chromium/);
assert.match(sanitizeLog("listener", "CODEX_STATUS: START / DONE / BLOCKED / FAILED"), /CODEX_STATUS/);
assert.strictEqual(isAlive(null), false);
assert.strictEqual(isAlive(child()), true);
const exited = child();
exited.exitCode = 0;
assert.strictEqual(isAlive(exited), false);

const fakeRoot = "D:\\relay-root";
assert.strictEqual(
  resolveConsoleProfilePath({ repoRoot: fakeRoot, environment: { AGENT_RELAY_BROWSER_PROFILE_PATH: "D:\\AgentRelay\\chrome-profile" } }),
  "D:\\AgentRelay\\chrome-profile"
);
assert.strictEqual(
  resolveConsoleProfilePath({ repoRoot: fakeRoot, environment: {} }),
  path.join(fakeRoot, ".agent-relay", "chrome-profile")
);
assert.strictEqual(profileLockExists("D:\\profile", { existsSync: (value) => String(value).endsWith("lockfile") }), true);
assert.strictEqual(profileLockExists("D:\\profile", { existsSync: () => false }), false);
assert.ok(chromeLaunchArgs({ profilePath: "D:\\p", cdpPort: 9333, startUrl: "https://chatgpt.com/", existed: true }).includes("--restore-last-session"));
assert.ok(chromeLaunchArgs({ profilePath: "D:\\p", cdpPort: 9333, startUrl: "https://chatgpt.com/", existed: true }).includes("--remote-allow-origins=*"));
assert.ok(!chromeLaunchArgs({ profilePath: "D:\\p", cdpPort: 9333, startUrl: "https://chatgpt.com/", existed: true }).includes("https://chatgpt.com/"));
assert.ok(chromeLaunchArgs({ profilePath: "D:\\p", cdpPort: 9333, startUrl: "https://chatgpt.com/", existed: false }).includes("https://chatgpt.com/"));
assert.strictEqual(chromeSpawnOptions().detached, true);
assert.strictEqual(chromeSpawnOptions().stdio, "ignore");

let made = 0;
const listenerSupervisor = new ProcessSupervisor({
  forkFn: () => { made += 1; return child(); },
  spawnFn: () => child(),
  browserStatusFn: async () => ({ state: "STOPPED" }),
  requestJsonFn: async () => { throw new Error("loopback_offline"); },
  browserReadyTimeoutMs: 0,
  loadEnvFn: () => {},
  resolveProfileFn: () => "D:\\relay-profile",
  profileLockFn: () => false,
});

(async () => {
  assert.strictEqual((await listenerSupervisor.startListener()).started, true);
  assert.strictEqual((await listenerSupervisor.startListener()).started, false);
  assert.strictEqual(made, 1);
  await listenerSupervisor.shutdown("force");
  assert.strictEqual(listenerSupervisor.listener.sent.mode, "force");

  const spawned = [];
  let browserState = { state: "STOPPED" };
  const supervisor = new ProcessSupervisor({
    forkFn: () => child(),
    spawnFn: (executable, args, options) => {
      spawned.push({ executable, args, options });
      return child();
    },
    browserStatusFn: async () => browserState,
    requestJsonFn: async () => { throw new Error("loopback_offline"); },
    browserReadyTimeoutMs: 0,
    loadEnvFn: () => {},
    resolveProfileFn: () => "D:\\relay-profile",
    profileLockFn: () => false,
  });

  const browserStart = await supervisor.startBrowser();
  assert.strictEqual(browserStart.started, true);
  assert.strictEqual(spawned.length, 1);
  assert.strictEqual(spawned[0].executable, process.execPath);
  assert.match(spawned[0].args[0], /browser-runtime-init\.js$/);
  assert.deepStrictEqual(spawned[0].args.slice(1), ["--profile", "D:\\relay-profile"]);
  assert.strictEqual(spawned[0].options.env.ELECTRON_RUN_AS_NODE, "1");
  assert.strictEqual(spawned[0].options.windowsHide, false);
  assert.strictEqual(spawned[0].options.shell, false);

  const skippedCallback = await supervisor.startCallback();
  assert.strictEqual(skippedCallback.started, false);
  assert.match(skippedCallback.message, /CDP/);
  assert.strictEqual(spawned.length, 1);

  browserState = { state: "CONNECTED", pid: 4242 };
  const callbackStart = await supervisor.startCallback();
  assert.strictEqual(callbackStart.started, true);
  assert.strictEqual(spawned.length, 2);
  assert.match(spawned[1].args[0], /browser-callback\.js$/);
  assert.deepStrictEqual(spawned[1].args.slice(1), ["runtime"]);
  assert.strictEqual(spawned[1].options.env.ELECTRON_RUN_AS_NODE, "1");
  assert.strictEqual(spawned[1].options.windowsHide, true);

  const stillRunning = await supervisor.startBrowser();
  assert.strictEqual(stillRunning.started, false);
  assert.match(stillRunning.message, /已连接/);
  assert.strictEqual(spawned.length, 2);

  browserState = { state: "STOPPED" };
  const restarted = await supervisor.startBrowser();
  assert.strictEqual(restarted.started, true);
  assert.strictEqual(spawned.length, 3);

  browserState = { state: "CONNECTED", pid: 4242 };
  const reused = await supervisor.startBrowser();
  assert.strictEqual(reused.started, false);
  assert.match(reused.message, /已连接/);
  assert.strictEqual(spawned.length, 3);

  const locked = new ProcessSupervisor({
    spawnFn: () => { throw new Error("should_not_spawn"); },
    browserStatusFn: async () => ({ state: "STOPPED" }),
    browserReadyTimeoutMs: 0,
    loadEnvFn: () => {},
    resolveProfileFn: () => "D:\\relay-profile",
    profileLockFn: () => true,
  });
  const blocked = await locked.startBrowser();
  assert.strictEqual(blocked.started, false);
  assert.match(blocked.message, /被占用/);

  let closed = false;
  const closing = new ProcessSupervisor({
    forkFn: () => child(),
    spawnFn: () => child(),
    browserStatusFn: async () => ({ state: "STOPPED" }),
    browserReadyTimeoutMs: 0,
    loadEnvFn: () => {},
    resolveProfileFn: () => "D:\\relay-profile",
    profileLockFn: () => false,
    closeBrowserFn: async () => { closed = true; },
  });
  await closing.startListener();
  await closing.shutdown("force");
  assert.strictEqual(closed, true);

  console.log("process-supervisor regression: passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
