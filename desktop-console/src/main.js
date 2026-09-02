"use strict";
const path = require("path");
const { app, BrowserWindow, ipcMain, dialog, screen } = require("electron");
const { ProcessSupervisor } = require("./process-supervisor");
const { validateAction } = require("./ipc-contract");
const callback = require("./callback-service");
const { isCallbackOffline } = callback;
const { browserStatus } = require("./browser-service");
const { needsProtection, ShutdownCoordinator } = require("./shutdown-coordinator");
const { BrowserDock, validateSurfaceRect, nativeHandleToHwnd } = require("./window-dock");
const { terminalOverlayBounds } = require("./terminal-overlay");
const { loadDefaultAgent, saveDefaultAgent } = require("../../local-preferences");

const REPO_ROOT = path.resolve(__dirname, "../..");
const ENV_PATH = path.join(REPO_ROOT, ".env");
app.setPath("userData", path.join(REPO_ROOT, ".agent-relay", "console-userdata"));
let window;
let overlay;
let surfaceRect = null;
let terminalCollapsed = false;
const dock = new BrowserDock();
let runtime = {
  schema_version: 1,
  relay: { state: "STOPPED", worker_id: null, started_at: null },
  queue: { running: 0, queued: 0 },
  task: null,
  browser_evidence: { state: "IDLE", task_id: null },
  last_terminal: null,
  components: {},
  default_agent: loadDefaultAgent({ envPath: ENV_PATH, environment: process.env, migrateLegacy: true }),
};

function sendToRenderers(channel, payload) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send(channel, payload);
}

const broadcast = () => sendToRenderers("relay-console:state", runtime);

function releaseOverlayFromChrome() {
  if (!overlay || overlay.isDestroyed() || !window || window.isDestroyed()) return;
  try {
    dock.setOwner(nativeHandleToHwnd(overlay.getNativeWindowHandle()), nativeHandleToHwnd(window.getNativeWindowHandle()));
  } catch {
    // Overlay HWND may already be gone during shutdown.
  }
}

function raiseTerminalOverlay() {
  if (!overlay || overlay.isDestroyed() || !overlay.isVisible()) return;
  try {
    const overlayHwnd = nativeHandleToHwnd(overlay.getNativeWindowHandle());
    if (dock.attached && dock.hwnd) dock.setOwner(overlayHwnd, dock.hwnd);
    else if (window && !window.isDestroyed()) dock.setOwner(overlayHwnd, nativeHandleToHwnd(window.getNativeWindowHandle()));
    dock.raiseHwnd(overlayHwnd);
  } catch {
    overlay.moveTop();
  }
}

function layoutTerminalOverlay() {
  if (!overlay || overlay.isDestroyed() || !window || window.isDestroyed()) return;
  if (window.isMinimized() || !window.isVisible() || !surfaceRect) {
    overlay.hide();
    return;
  }
  const relative = terminalOverlayBounds(surfaceRect, { collapsed: terminalCollapsed });
  if (!relative) {
    overlay.hide();
    return;
  }
  const content = window.getContentBounds();
  overlay.setBounds({
    x: Math.round(content.x + relative.x),
    y: Math.round(content.y + relative.y),
    width: Math.round(relative.width),
    height: Math.round(relative.height),
  });
  if (!overlay.isVisible()) overlay.showInactive();
  raiseTerminalOverlay();
}

function layoutDock(options = {}) {
  if (!window || window.isDestroyed() || window.isMinimized() || !surfaceRect || !dock.attached) {
    layoutTerminalOverlay();
    return;
  }
  try { dock.layout(window, surfaceRect, screen, options); } catch (error) {
    supervisor.log("console", `浏览器停靠失败：${String(error.message || error).slice(0, 180)}\n`);
  }
  layoutTerminalOverlay();
}

async function attachDock(status) {
  const pid = status?.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    const result = await dock.attach({ pid });
    if (!result.attached) {
      supervisor.log("console", "已启动 Chrome，但尚未找到可停靠窗口。\n");
      return false;
    }
    layoutDock({ restyle: true });
    supervisor.log("console", "Relay Chrome 已停靠到浏览器区域。\n");
    return true;
  } catch (error) {
    supervisor.log("console", `浏览器停靠失败：${String(error.message || error).slice(0, 180)}\n`);
    return false;
  }
}

async function startBrowserAndDock() {
  const result = await supervisor.startBrowser();
  runtime.browser = await browserStatus({ repoRoot: REPO_ROOT });
  broadcast();
  if (runtime.browser?.state === "CONNECTED") {
    await attachDock(runtime.browser);
    await supervisor.startCallback();
  }
  return result;
}

const supervisor = new ProcessSupervisor({
  onState: (state) => {
    const default_agent = runtime.default_agent;
    runtime = { ...runtime, ...state, default_agent };
    broadcast();
    coordinator.observe(runtime);
  },
  onComponent: (entry) => {
    runtime.components[entry.component] = entry;
    if (entry.component === "browser-runtime" && ["EXITED", "FAILED"].includes(entry.state)) {
      releaseOverlayFromChrome();
      dock.detach();
      runtime.browser = { state: "STOPPED", profile: runtime.browser?.profile || null };
      supervisor.log("console", "Relay Chrome 已退出。点击「启动浏览器」可重新打开并恢复登录态。\n");
    }
    broadcast();
  },
  onLog: (entry) => sendToRenderers("relay-console:log", entry),
  closeBrowserFn: async () => { releaseOverlayFromChrome(); dock.requestClose(); },
});

const coordinator = new ShutdownCoordinator({
  stop: async (mode) => {
    await supervisor.shutdown(mode);
    app.exit();
  },
  hide: () => { overlay?.hide(); window?.hide(); },
});

async function requestClose() {
  if (!needsProtection(runtime)) {
    await coordinator.choose("force-confirmed");
    return;
  }
  const answer = await dialog.showMessageBox(window, {
    type: "warning",
    title: "任务仍在执行",
    message: `${runtime.task?.task_id || "Browser Evidence"} 仍在执行`,
    detail: "强制退出可能导致 Slack 终态未发送或需要人工恢复。",
    buttons: ["保持运行并返回", "完成后自动退出", "立即强制退出…"],
    defaultId: 0,
    cancelId: 0,
  });
  if (answer.response === 1) await coordinator.choose("when-idle");
  if (answer.response === 2) {
    const confirm = await dialog.showMessageBox(window, {
      type: "warning",
      title: "确认强制退出",
      message: "任务可能缺少 Slack 终态。",
      buttons: ["取消", "立即强制退出"],
      defaultId: 0,
      cancelId: 0,
    });
    if (confirm.response === 1) await coordinator.choose("force-confirmed");
  }
}

app.whenReady().then(() => {
  if (!app.requestSingleInstanceLock()) return app.quit();
  window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 320,
    backgroundColor: "#10151d",
    frame: true,
    minimizable: true,
    maximizable: true,
    closable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.loadFile(path.join(__dirname, "renderer", "index.html"));
  overlay = new BrowserWindow({
    parent: window,
    show: false,
    frame: false,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    fullscreenable: false,
    hasShadow: true,
    backgroundColor: "#10151d",
    width: 640,
    height: 280,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  overlay.setMenuBarVisibility(false);
  overlay.loadFile(path.join(__dirname, "renderer", "terminal.html"));
  overlay.on("close", (event) => { if (!app.isQuitting) event.preventDefault(); });
  overlay.on("focus", () => raiseTerminalOverlay());
  window.webContents.once("did-finish-load", () => {
    supervisor.startListener().catch(() => {});
    startBrowserAndDock().then(() => supervisor.startCallback()).catch(() => {});
  });
  window.on("resize", () => layoutDock());
  window.on("will-resize", () => layoutDock());
  window.on("move", () => layoutDock());
  window.on("will-move", () => layoutDock());
  window.on("focus", () => { dock.raise(); raiseTerminalOverlay(); });
  window.on("minimize", () => { overlay?.hide(); dock.hide(); });
  window.on("restore", () => { dock.show(); layoutDock(); });
  window.on("show", () => { dock.show(); layoutDock(); });
  window.on("hide", () => { overlay?.hide(); dock.hide(); });
  screen.on("display-metrics-changed", () => layoutDock());
  window.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      requestClose();
    }
  });
  app.on("second-instance", () => { window.show(); window.focus(); layoutDock(); });
});

ipcMain.on("relay-console:surface", (_event, value) => {
  try {
    surfaceRect = validateSurfaceRect(value);
    layoutDock();
  } catch {
    // Ignore malformed renderer bounds; layout keeps the last valid rect.
  }
});

ipcMain.on("relay-console:terminal-collapsed", (_event, collapsed) => {
  terminalCollapsed = Boolean(collapsed);
  sendToRenderers("relay-console:terminal-collapsed", terminalCollapsed);
  layoutTerminalOverlay();
});

ipcMain.on("relay-console:diagnostic", (_event, text) => {
  sendToRenderers("relay-console:diagnostic", String(text || ""));
});

ipcMain.handle("relay-console:action", async (_event, value) => {
  const action = validateAction(value);
  if (action.type === "start-listener") return supervisor.startListener();
  if (action.type === "start-browser") return startBrowserAndDock();
  if (action.type === "focus-browser") return dock.focus();
  if (action.type === "request-state") {
    runtime.browser = await browserStatus({ repoRoot: REPO_ROOT });
    runtime.default_agent = loadDefaultAgent({ envPath: ENV_PATH, environment: process.env });
    return runtime;
  }
  if (action.type === "set-default-agent") {
    const saved = saveDefaultAgent(action.agent, { envPath: ENV_PATH, environment: process.env });
    runtime.default_agent = saved.default_agent;
    broadcast();
    supervisor.log("console", `已写入 .env：AGENT_RELAY_DEFAULT_AGENT=${saved.default_agent}。未写 agent 的工单将使用该值；工单显式指定时仍以工单为准。\n`);
    return { ok: true, default_agent: saved.default_agent, message: `已写入 .env：AGENT_RELAY_DEFAULT_AGENT=${saved.default_agent}` };
  }
  if (action.type === "callback-state") {
    let snapshot = await callback.state();
    if (snapshot.available === false) {
      await supervisor.startCallback();
      snapshot = await callback.state();
    }
    return snapshot;
  }
  if (action.type === "connect-callback") {
    try {
      const snapshot = await callback.state();
      if (snapshot.available === false) await supervisor.startCallback();
      return { ok: true, ...(await callback.connect(action.page_id)) };
    } catch (error) {
      return { ok: false, error: isCallbackOffline(error) ? "callback_unavailable" : String(error.message || error) };
    }
  }
  if (action.type === "shutdown") supervisor.shutdown(action.mode);
  return runtime;
});
