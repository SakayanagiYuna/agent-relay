"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");
const { BrowserRuntimeRegistry } = require("../../browser-runtime-registry");

function requestJson({ port = 8787, path, method = "GET", body }) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: "127.0.0.1", port, path, method, timeout: 2500, headers: data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {} }, (res) => {
      let text = "";
      res.on("data", (part) => { text += part; });
      res.on("end", () => {
        try {
          const json = JSON.parse(text || "{}");
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else reject(new Error(json.error || `loopback_http_${res.statusCode}`));
        } catch { reject(new Error("loopback_invalid_json")); }
      });
    });
    req.once("timeout", () => req.destroy(new Error("loopback_timeout")));
    req.once("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function cdpConnected(endpoint) {
  try {
    const url = new URL(endpoint);
    return requestJson({ port: Number(url.port), path: "/json/version" }).then(() => true, () => false);
  } catch { return Promise.resolve(false); }
}

function profileLockExists(profilePath, fsModule = fs) {
  return ["lockfile", "SingletonLock", "SingletonCookie"].some((name) => fsModule.existsSync(path.join(profilePath, name)));
}

function resolveConsoleProfilePath({ repoRoot, environment = process.env } = {}) {
  const configured = environment.AGENT_RELAY_BROWSER_PROFILE_PATH;
  if (configured) {
    if (!path.isAbsolute(configured)) throw new Error("browser_profile_path_invalid");
    return path.resolve(configured);
  }
  return path.join(repoRoot, ".agent-relay", "chrome-profile");
}

async function browserStatus({ registry, repoRoot } = {}) {
  try {
    const selectedRegistry = registry || new BrowserRuntimeRegistry({ filePath: repoRoot ? path.join(repoRoot, ".agent-relay", "browser-runtime.json") : undefined });
    const runtime = selectedRegistry.load();
    if (!runtime) return { state: "STOPPED" };
    return {
      state: await cdpConnected(runtime.cdp_endpoint) ? "CONNECTED" : "DEGRADED",
      runtime_id: runtime.runtime_id,
      profile: path.basename(runtime.profile_path),
      pid: runtime.pid,
      cdp_endpoint: runtime.cdp_endpoint,
    };
  } catch { return { state: "DEGRADED" }; }
}

module.exports = { requestJson, cdpConnected, browserStatus, resolveConsoleProfilePath, profileLockExists };
