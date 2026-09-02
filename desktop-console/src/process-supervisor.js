"use strict";
const path = require("path");
const { fork, spawn } = require("child_process");
const { browserStatus, requestJson, resolveConsoleProfilePath, profileLockExists } = require("./browser-service");
const { loadLocalEnvironment } = require("../../browser-runtime-init");

function isAlive(child) {
  return Boolean(child && !child.killed && child.exitCode == null);
}

function nodeSpawnEnv(extra = {}) {
  return { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...extra };
}

const BENIGN_CHROMIUM_LOG = /usb_service_win\.cc|SetupDiGetDeviceProperty|device_event_log_impl\.cc|DEPRECATED_ENDPOINT|registration_request\.cc|google_apis[/\\]gcm|Ignore caches that are heterogeneous/i;

function sanitizeLog(component, value) {
  let text = String(value || "").replace(/xox(?:b|a|p)-[A-Za-z0-9-]+/g, "[redacted]").replace(/(?:smtp|token|secret|password)=\S+/gi, "[redacted]");
  if (component === "browser-runtime" || component === "browser-callback") {
    text = text.split(/\r?\n/).filter((line) => line.trim() && !BENIGN_CHROMIUM_LOG.test(line)).join("\n");
  }
  return text.slice(0, 1200);
}

class ProcessSupervisor {
  constructor({
    repoRoot = path.resolve(__dirname, "../.."),
    forkFn = fork,
    spawnFn = spawn,
    onState = () => {},
    onComponent = () => {},
    onLog = () => {},
    browserStatusFn = browserStatus,
    requestJsonFn = requestJson,
    browserReadyTimeoutMs = 8_000,
    resolveProfileFn = resolveConsoleProfilePath,
    profileLockFn = profileLockExists,
    loadEnvFn = loadLocalEnvironment,
    closeBrowserFn = async () => {},
  } = {}) {
    this.repoRoot = repoRoot;
    this.forkFn = forkFn;
    this.spawnFn = spawnFn;
    this.onState = onState;
    this.onComponent = onComponent;
    this.onLog = onLog;
    this.browserStatusFn = browserStatusFn;
    this.requestJsonFn = requestJsonFn;
    this.browserReadyTimeoutMs = browserReadyTimeoutMs;
    this.resolveProfileFn = resolveProfileFn;
    this.profileLockFn = profileLockFn;
    this.loadEnvFn = loadEnvFn;
    this.closeBrowserFn = closeBrowserFn;
    this.listener = null;
    this.browser = null;
    this.callback = null;
  }

  nodeSpawnOptions({ windowsHide = false } = {}) {
    return {
      shell: false,
      windowsHide,
      cwd: this.repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: nodeSpawnEnv(),
    };
  }

  log(component, value) {
    const text = sanitizeLog(component, value);
    if (text.trim()) this.onLog({ component, text });
  }

  observeOutput(component, child) {
    child.stdout?.on("data", (chunk) => this.log(component, chunk));
    child.stderr?.on("data", (chunk) => this.log(component, chunk));
  }

  async waitForBrowserConnected(timeoutMs = this.browserReadyTimeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let status = await this.browserStatusFn({ repoRoot: this.repoRoot });
    while (status.state !== "CONNECTED" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      status = await this.browserStatusFn({ repoRoot: this.repoRoot });
    }
    return status;
  }

  async startListener() {
    if (isAlive(this.listener)) return { started: false, message: "Listener 已在运行或正在启动。" };
    this.onComponent({ component: "listener", state: "STARTING" });
    const child = this.forkFn(path.join(this.repoRoot, "listener.js"), [], { silent: true, cwd: this.repoRoot });
    this.listener = child;
    let diagnostic = "";
    child.stderr?.on("data", (chunk) => { diagnostic = `${diagnostic}${String(chunk)}`.slice(-600); });
    this.observeOutput("listener", child);
    this.log("console", "启动 Listener：node listener.js\n");
    child.on("message", (message) => { if (message?.type === "agent-relay:runtime-state") this.onState(message.payload); });
    child.on("error", (error) => this.onComponent({ component: "listener", state: "FAILED", error: String(error.message || "spawn_failed").slice(0, 240) }));
    child.on("exit", (code, signal) => this.onComponent({ component: "listener", state: "EXITED", code, signal, error: diagnostic.replace(/xox(?:b|a|p)-[A-Za-z0-9-]+/g, "[redacted]").replace(/AGENT_RELAY_[A-Z0-9_]+=[^\s]+/g, "[redacted]").trim().slice(-240) || null }));
    child.send({ type: "agent-relay:request-state" });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    if (child.exitCode !== null) return { started: false, message: `Listener 启动失败：${diagnostic.replace(/xox(?:b|a|p)-[A-Za-z0-9-]+/g, "[redacted]").slice(-180) || `exit ${child.exitCode}`}` };
    return { started: true, message: "Listener 正在启动；连接 Slack 后状态将更新为 RUNNING。" };
  }

  connectedBrowser(status, message) {
    this.onComponent({ component: "browser-runtime", state: "CONNECTED" });
    const result = { started: false, message, pid: status.pid || null, profile: status.profile || null };
    this.log("console", `${result.message}\n`);
    return result;
  }

  async startBrowser() {
    this.loadEnvFn(process.env, path.join(this.repoRoot, ".env"));
    const profilePath = this.resolveProfileFn({ repoRoot: this.repoRoot, environment: process.env });
    this.log("console", `使用浏览器 profile：${path.basename(profilePath)}\n`);
    const current = await this.browserStatusFn({ repoRoot: this.repoRoot });
    if (current.state === "CONNECTED") return this.connectedBrowser(current, "Relay 浏览器已连接。");
    if (isAlive(this.browser)) {
      this.log("console", "先前的 Chrome 已退出，正在重新启动 Browser Runtime。\n");
      this.browser.kill();
      this.browser = null;
    }
    if (this.profileLockFn(profilePath)) {
      this.log("console", "检测到 profile 锁，等待已有 Chrome 的 CDP，避免启动丢失登录态的第二实例。\n");
      const waited = await this.waitForBrowserConnected();
      if (waited.state === "CONNECTED") return this.connectedBrowser(waited, "已复用锁定 profile 中的 Relay 浏览器。");
      const blocked = { started: false, message: "Relay Chrome profile 被占用且 CDP 未连通。请先关闭已有 Chrome 窗口，再启动浏览器。" };
      this.onComponent({ component: "browser-runtime", state: "DEGRADED" });
      this.log("console", `${blocked.message}\n`);
      return blocked;
    }
    this.onComponent({ component: "browser-runtime", state: "STARTING" });
    this.browser = this.spawnFn(process.execPath, [path.join(this.repoRoot, "browser-runtime-init.js"), "--profile", profilePath], this.nodeSpawnOptions({ windowsHide: false }));
    this.observeOutput("browser-runtime", this.browser);
    this.log("console", "启动 Browser Runtime：node browser-runtime-init.js\n");
    this.browser.on("error", (error) => this.onComponent({ component: "browser-runtime", state: "FAILED", error: String(error.message || "spawn_failed").slice(0, 240) }));
    this.browser.on("exit", (code, signal) => this.onComponent({ component: "browser-runtime", state: "EXITED", code, signal }));
    const status = await this.waitForBrowserConnected();
    const result = status.state === "CONNECTED"
      ? { started: true, message: "Relay 浏览器已启动并连接。", pid: status.pid || null, profile: path.basename(profilePath) }
      : { started: true, message: "Browser Runtime 已尝试启动，但 CDP 9333 未连通；请查看 Chrome 是否被 Windows、现有 profile 锁或安全软件关闭。" };
    this.onComponent({ component: "browser-runtime", state: status.state === "CONNECTED" ? "CONNECTED" : "DEGRADED" });
    this.log("console", `${result.message}\n`);
    return result;
  }

  async startCallback() {
    if (isAlive(this.callback)) return { started: false, message: "Browser Callback 已在运行。" };
    try {
      await this.requestJsonFn({ path: "/api/state" });
      this.onComponent({ component: "browser-callback", state: "CONNECTED" });
      const reused = { started: false, message: "Browser Callback 已连接。" };
      this.log("console", `${reused.message}\n`);
      return reused;
    } catch {
      // Port 8787 is free or not serving the callback controller yet.
    }
    const browser = await this.browserStatusFn({ repoRoot: this.repoRoot });
    if (browser.state !== "CONNECTED") {
      this.onComponent({ component: "browser-callback", state: "DEGRADED" });
      const skipped = { started: false, message: "Browser Callback 未启动：需要先连通 Relay Chrome 的 CDP。" };
      this.log("console", `${skipped.message}\n`);
      return skipped;
    }
    this.onComponent({ component: "browser-callback", state: "STARTING" });
    this.callback = this.spawnFn(process.execPath, [path.join(this.repoRoot, "browser-callback.js"), "runtime"], this.nodeSpawnOptions({ windowsHide: true }));
    this.observeOutput("browser-callback", this.callback);
    this.log("console", "启动 Browser Callback：node browser-callback.js runtime\n");
    this.callback.on("exit", (code, signal) => this.onComponent({ component: "browser-callback", state: "EXITED", code, signal }));
    const started = { started: true, message: "Browser Callback 正在启动。" };
    this.log("console", `${started.message}\n`);
    return started;
  }

  async waitForBrowserDisconnected(timeoutMs = 8_000) {
    const deadline = Date.now() + timeoutMs;
    let status = await this.browserStatusFn({ repoRoot: this.repoRoot });
    while (status.state === "CONNECTED" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      status = await this.browserStatusFn({ repoRoot: this.repoRoot });
    }
    return status;
  }

  async shutdown(mode) {
    if (isAlive(this.callback)) this.callback.kill();
    this.log("console", "正在关闭 Relay Chrome 并写入登录态到 profile…\n");
    await this.closeBrowserFn();
    const stopped = await this.waitForBrowserDisconnected();
    if (stopped.state === "CONNECTED") this.log("console", "Chrome 未在时限内退出；将结束本机控制进程，profile 可能未完整写入。\n");
    else this.log("console", "Relay Chrome 已退出，profile 已保留。\n");
    if (this.listener?.connected) this.listener.send({ type: "agent-relay:shutdown", mode });
    if (isAlive(this.browser)) this.browser.kill();
  }
}

module.exports = { ProcessSupervisor, isAlive, nodeSpawnEnv, sanitizeLog };
