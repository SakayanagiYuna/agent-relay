"use strict";
const path = require("path");
const { app, BrowserWindow, ipcMain, dialog, screen } = require("electron");
const { ProcessSupervisor } = require("./process-supervisor");
const { validateAction } = require("./ipc-contract");
const callback = require("./callback-service");
const { browserStatus } = require("./browser-service");
const { needsProtection, ShutdownCoordinator } = require("./shutdown-coordinator");
const { BrowserDock, validateSurfaceRect } = require("./window-dock");

const REPO_ROOT = path.resolve(__dirname, "../..");
app.setPath("userData", path.join(REPO_ROOT, ".agent-relay", "console-userdata"));
let window;
let surfaceRect = null;
const dock = new BrowserDock();
let runtime = {
  schema_version: 1,
  relay: { state: "STOPPED", worker_id: null, started_at: null },
  queue: { running: 0, queued: 0 },
  task: null,
  browser_evidence: { state: "IDLE", task_id: null },
  last_terminal: null,
  components: {},
};

const broadcast = () => {
  if (window && !window.isDestroyed()) window.webContents.send("relay-console:state", runtime);
};

function layoutDock(options = {}) {
  if (!window || window.isDestroyed() || window.isMinimized() || !surfaceRect || !dock.attached) return;
  try { dock.layout(window, surfaceRect, screen, options); } catch (error) {
    supervisor.log("console", `浏览器停靠失败：${String(error.message || error).slice(0, 180)}\n`);
  }
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
  onState: (state) => { runtime = { ...runtime, ...state }; broadcast(); coordinator.observe(runtime); },
  onComponent: (entry) => {
    runtime.components[entry.component] = entry;
    if (entry.component === "browser-runtime" && ["EXITED", "FAILED"].includes(entry.state)) {
      dock.detach();
      runtime.browser = { state: "STOPPED", profile: runtime.browser?.profile || null };
      supervisor.log("console", "Relay Chrome 已退出。点击「启动浏览器」可重新打开并恢复登录态。\n");
    }
    broadcast();
  },
  onLog: (entry) => { if (window && !window.isDestroyed()) window.webContents.send("relay-console:log", entry); },
  closeBrowserFn: async () => { dock.requestClose(); },
});

const coordinator = new ShutdownCoordinator({
  stop: async (mode) => {
    await supervisor.shutdown(mode);
    app.exit();
  },
  hide: () => window?.hide(),
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
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.loadFile(path.join(__dirname, "renderer", "index.html"));
  window.webContents.once("did-finish-load", () => {
    supervisor.startListener().catch(() => {});
    startBrowserAndDock().then(() => supervisor.startCallback()).catch(() => {});
  });
  window.on("resize", () => layoutDock());
  window.on("will-resize", () => layoutDock());
  window.on("move", () => layoutDock());
  window.on("will-move", () => layoutDock());
  window.on("focus", () => dock.raise());
  window.on("minimize", () => dock.hide());
  window.on("restore", () => { dock.show(); layoutDock(); dock.raise(); });
  window.on("show", () => { dock.show(); layoutDock(); dock.raise(); });
  window.on("hide", () => dock.hide());
  screen.on("display-metrics-changed", () => layoutDock());
  window.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      requestClose();
    }
  });
  app.on("second-instance", () => { window.show(); window.focus(); });
});

ipcMain.on("relay-console:surface", (_event, value) => {
  try {
    surfaceRect = validateSurfaceRect(value);
    layoutDock();
  } catch {
    // Ignore malformed renderer bounds; layout keeps the last valid rect.
  }
});

ipcMain.handle("relay-console:action", async (_event, value) => {
  const action = validateAction(value);
  if (action.type === "start-listener") return supervisor.startListener();
  if (action.type === "start-browser") return startBrowserAndDock();
  if (action.type === "focus-browser") return dock.focus();
  if (action.type === "request-state") {
    runtime.browser = await browserStatus({ repoRoot: REPO_ROOT });
    return runtime;
  }
  if (action.type === "callback-state") return callback.state();
  if (action.type === "connect-callback") {
    try {
      return { ok: true, ...(await callback.connect(action.page_id)) };
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    }
  }
  if (action.type === "shutdown") supervisor.shutdown(action.mode);
  return runtime;
});
