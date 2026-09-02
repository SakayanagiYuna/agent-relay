"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");
const { parseManagedArguments } = require("./browser-callback");
const { BrowserRuntimeRegistry } = require("./browser-runtime-registry");

function loadLocalEnvironment(environment = process.env, envPath = path.join(__dirname, ".env")) {
  if (!fs.existsSync(envPath)) return environment;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) throw new Error("browser_runtime_env_invalid");
    if (environment[match[1]] === undefined) environment[match[1]] = match[2];
  }
  return environment;
}

function resolveManagedBrowserExecutable(environment = process.env) {
  const candidates = [environment.AGENT_RELAY_BROWSER_EXECUTABLE_PATH, path.join(environment.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"), path.join(environment["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe")].filter(Boolean);
  if (environment.AGENT_RELAY_BROWSER_EXECUTABLE_PATH && !path.isAbsolute(environment.AGENT_RELAY_BROWSER_EXECUTABLE_PATH)) throw new Error("browser_executable_path_invalid");
  const executable = candidates.find((candidate) => { try { return fs.statSync(candidate).isFile(); } catch { return false; } });
  if (!executable) throw new Error("managed_browser_executable_not_found_set_AGENT_RELAY_BROWSER_EXECUTABLE_PATH");
  return path.resolve(executable);
}

function cdpReady(port) { return new Promise((resolve) => { const request = http.get({ host: "127.0.0.1", port, path: "/json/version", timeout: 1000 }, (response) => { response.resume(); resolve(response.statusCode === 200); }); request.once("timeout", () => { request.destroy(); resolve(false); }); request.once("error", () => resolve(false)); }); }

function chromeLaunchArgs({ profilePath, cdpPort, startUrl, existed }) {
  const args = [`--user-data-dir=${profilePath}`, "--profile-directory=Default", "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${cdpPort}`, "--remote-allow-origins=*", "--no-first-run", "--no-default-browser-check"];
  if (existed) args.push("--restore-last-session");
  else args.push(startUrl);
  return args;
}

function chromeSpawnOptions() {
  return { shell: false, windowsHide: false, detached: true, stdio: "ignore" };
}

async function launchManualManagedBrowser({ args = process.argv.slice(2), environment = process.env, spawnFn = spawn, log = console.log, registry = new BrowserRuntimeRegistry() } = {}) {
  if (String(environment.AGENT_RELAY_BROWSER_RUNTIME_ENABLED || "true").toLowerCase() === "false") { log("[BROWSER] runtime disabled by AGENT_RELAY_BROWSER_RUNTIME_ENABLED=false"); return { disabled: true }; }
  const { profilePath, startUrl } = parseManagedArguments(args, environment); const cdpPort = Number(environment.AGENT_RELAY_BROWSER_CDP_PORT || 9333);
  if (!Number.isSafeInteger(cdpPort) || cdpPort < 1024 || cdpPort > 65535) throw new Error("browser_cdp_port_invalid");
  const existing = registry.load(); if (existing && existing.profile_path === profilePath && existing.cdp_endpoint === `http://127.0.0.1:${cdpPort}` && await cdpReady(cdpPort)) { log(`[BROWSER] Reusing verified Relay runtime: ${existing.runtime_id}`); return { reused: true, profilePath, startUrl, cdpPort, runtime: existing }; } if (existing) registry.clear();
  const existed = fs.existsSync(profilePath); fs.mkdirSync(profilePath, { recursive: true });
  const executable = resolveManagedBrowserExecutable(environment);
  log("[BROWSER]"); log(`profile path: ${profilePath}`); log("headless: false"); log(existed ? "[BROWSER] Loaded existing profile" : "[BROWSER] Creating persistent profile"); log("[BROWSER] Launching visible Chromium for manual login");
  const child = spawnFn(executable, chromeLaunchArgs({ profilePath, cdpPort, startUrl, existed }), chromeSpawnOptions());
  child.once("error", (error) => log(`[BROWSER] launch failed: ${error.message}`));
  log("context created: native browser profile"); log("authentication state: unknown (complete login manually if prompted)");
  for (let attempt = 0; attempt < 10; attempt += 1) { await new Promise((resolve) => setTimeout(resolve, 500)); if (await cdpReady(cdpPort)) { const runtime = registry.save({ profilePath, cdpPort, pid: child.pid }); return { child, profilePath, startUrl, cdpPort, runtime, close: () => { child.kill(); registry.clear(); } }; } }
  child.kill(); throw new Error("relay_browser_cdp_not_ready");
}

if (require.main === module) { loadLocalEnvironment(); launchManualManagedBrowser().then((runtime) => { if (runtime.disabled) return; console.log(`[READY] visible managed Chromium is running; profile: ${runtime.profilePath}; CDP: http://127.0.0.1:${runtime.cdpPort}; start URL: ${runtime.startUrl}`); if (runtime.child && typeof runtime.child.on === "function") runtime.child.on("exit", (code, signal) => { console.log(`[BROWSER] chrome exited code=${code}${signal ? ` signal=${signal}` : ""}`); }); }).catch((error) => { console.error(`[ERROR] ${error.message}`); process.exitCode = 1; }); }

module.exports = { launchManualManagedBrowser, loadLocalEnvironment, resolveManagedBrowserExecutable, chromeLaunchArgs, chromeSpawnOptions };
