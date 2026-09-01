"use strict";

const fs = require("fs");
const { createRelayManagedBrowser, parseManagedArguments } = require("./browser-callback");

function bootstrapState({ profileExisted, authenticationState }) {
  return {
    profile: profileExisted ? "PROFILE_EXISTING" : "PROFILE_NEW",
    authorization: authenticationState === "ready" ? "SESSION_RESTORED" : "AUTH_REQUIRED",
  };
}

function logBootstrapState(state, log = console.log) {
  log("[BROWSER]");
  log(`profile state: ${state.profile}`);
  log(`authentication state: ${state.authorization}`);
  if (state.authorization === "AUTH_REQUIRED") log("[BROWSER] waiting for manual login; do not provide credentials, password, or MFA to Relay.");
}

async function bootstrapManagedBrowser({ chromium, args = process.argv.slice(2), environment = process.env, lifecycleLog = console.log } = {}) {
  if (String(environment.AGENT_RELAY_BROWSER_RUNTIME_ENABLED || "true").toLowerCase() === "false") {
    lifecycleLog("[BROWSER] runtime disabled by AGENT_RELAY_BROWSER_RUNTIME_ENABLED=false");
    return { disabled: true, close: async () => {} };
  }
  const config = parseManagedArguments(args, environment);
  const profileExisted = fs.existsSync(config.profilePath);
  lifecycleLog("[BROWSER]");
  lifecycleLog(`profile path: ${config.profilePath}`);
  lifecycleLog("headless: false");
  lifecycleLog(profileExisted ? "[BROWSER] Loaded existing profile" : "[BROWSER] Creating persistent profile");
  const managed = await createRelayManagedBrowser({ chromium, ...config, lifecycleLog });
  lifecycleLog("context created: true");
  const initializationState = bootstrapState({ profileExisted, authenticationState: managed.authenticationState });
  logBootstrapState(initializationState, lifecycleLog);
  return { ...managed, initializationState };
}

async function start() {
  const { chromium } = require("playwright");
  const managed = await bootstrapManagedBrowser({ chromium });
  if (managed.disabled) return;
  console.log(`[READY] visible managed Chromium is running; profile: ${managed.profilePath}; start URL: ${managed.startUrl}`);
  console.log("[READY] Complete any login manually in the visible browser. Press Ctrl+C to close it.");
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await managed.close();
  };
  await new Promise((resolve) => {
    const keepAlive = setInterval(() => {}, 60 * 60 * 1000);
    const shutdown = () => {
      clearInterval(keepAlive);
      resolve();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
  await close();
}

if (require.main === module) start().catch((error) => { console.error(`[ERROR] ${error.message}`); process.exitCode = 1; });

module.exports = { bootstrapManagedBrowser, bootstrapState, logBootstrapState };
