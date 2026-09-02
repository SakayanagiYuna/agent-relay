"use strict";
const $ = (id) => document.getElementById(id);
let latest = null;
let surfaceReportFrame = 0;

function elapsed(ms) {
  const seconds = Math.floor((ms || 0) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}m${String(seconds % 60).padStart(2, "0")}s`;
}

function setState(id, state) {
  const element = $(id);
  if (element) element.dataset.state = state || "UNKNOWN";
}

function reportSurface() {
  const host = $("browserHost");
  if (!host || !window.relayConsole?.reportSurface) return;
  const rect = host.getBoundingClientRect();
  window.relayConsole.reportSurface({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
}

function scheduleSurfaceReport() {
  if (surfaceReportFrame) return;
  surfaceReportFrame = requestAnimationFrame(() => {
    surfaceReportFrame = 0;
    reportSurface();
  });
}

function render(state) {
  latest = state;
  const relayState = state.relay?.state || "UNKNOWN";
  const browserState = state.browser?.state || "UNKNOWN";
  $("relay").textContent = relayState;
  $("browser").textContent = browserState;
  setState("relayStatus", relayState);
  setState("browserStatus", browserState);
  $("queue").textContent = `运行中 ${state.queue.running} · 排队中 ${state.queue.queued}`;
  $("worker").textContent = state.relay.worker_id || "工作节点不可用";
  $("evidence").textContent = state.browser_evidence.state;
  setState("evidence", state.browser_evidence.state);
  const task = state.task;
  $("task").textContent = task
    ? `${task.task_id} · ${task.agent} · ${task.status} · ${elapsed(task.elapsed_ms)} · ${task.repo}${task.activity ? ` · ${task.activity}` : ""}`
    : "当前没有任务";
  $("task").classList.toggle("empty", !task);
  setState("task", task?.status || "IDLE");
  $("activity").textContent = task?.activity || (task ? "任务执行中" : "无活动");
  $("terminal").textContent = state.last_terminal ? `${state.last_terminal.task_id} · ${state.last_terminal.status}` : "暂无终态";
  const connected = browserState === "CONNECTED";
  $("browserHost").classList.toggle("connected", connected);
  $("browserPanelState").textContent = connected ? "CONNECTED" : browserState;
  setState("browserPanelState", browserState);
  $("browserDetail").textContent = connected
    ? `已停靠 · profile ${state.browser.profile || "Relay managed"}`
    : "浏览器未运行。点击启动浏览器，将复用 chrome-profile 登录态并停靠到此区域。";
  const startLabel = connected ? "浏览器运行中" : "启动浏览器";
  $("restartBrowser").textContent = startLabel;
  $("restartBrowser").disabled = connected;
  $("headerStartBrowser").textContent = startLabel;
  $("headerStartBrowser").disabled = connected;
  if (state.default_agent && $("defaultAgent")) $("defaultAgent").value = state.default_agent;
  reportSurface();
}

function fillPageOptions(pages) {
  const select = $("pages");
  const previous = select.value;
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = pages.length ? "请选择一个 ChatGPT conversation" : "没有可绑定的对话，请先在 Relay Chrome 打开 ChatGPT conversation";
  select.append(placeholder);
  for (const page of pages) {
    const option = document.createElement("option");
    option.value = String(page.id);
    option.textContent = page.title || page.url;
    select.append(option);
  }
  if (previous && [...select.options].some((option) => option.value === previous)) select.value = previous;
}

function selectedPageId() {
  const raw = $("pages").value;
  if (!raw) return null;
  const pageId = Number(raw);
  return Number.isSafeInteger(pageId) && pageId > 0 ? pageId : null;
}

function actionErrorMessage(error) {
  const text = String(error?.message || error).replace(/^Error invoking remote method '[^']+': Error:\s*/, "");
  if (text === "callback_requires_explicit_page_selection") return "请先在列表中明确选择一个 ChatGPT conversation。";
  if (text === "callback_no_chatgpt_conversation") return "没有可绑定的 ChatGPT 对话。请确认中间 Relay Chrome 已打开 chatgpt.com 的 conversation。";
  if (text === "console_page_id_invalid") return "请先明确选择一个 conversation。";
  if (text === "callback_not_armed_after_readback") return "Bind 后回读未确认 ARMED，未写入成功状态。";
  if (text === "callback_unavailable" || /ECONNREFUSED/.test(text)) return "回调控制器未连接。请先启动浏览器，等待 Callback 就绪后再选对话。";
  return text;
}

async function refreshCallback() {
  try {
    const state = await window.relayConsole.action({ type: "request-state" });
    render(state);
    const callbackState = await window.relayConsole.action({ type: "callback-state" });
    if (callbackState?.available === false || callbackState?.error === "callback_unavailable") {
      fillPageOptions([]);
      $("callback").textContent = "未连接";
      setState("callbackStatus", "DISCONNECTED");
      $("callbackMessage").textContent = "回调控制器未连接。请先启动浏览器，等待 Callback 就绪后再选对话。";
      return;
    }
    fillPageOptions(callbackState.pages || []);
    const callbackStateLabel = callbackState.armed ? "ARMED" : callbackState.bound ? "BOUND" : "DISCONNECTED";
    $("callback").textContent = callbackStateLabel;
    setState("callbackStatus", callbackStateLabel);
    if (!(callbackState.pages || []).length) {
      $("callbackMessage").textContent = "没有可绑定的 ChatGPT 对话。请确认中间 Relay Chrome 已打开 chatgpt.com 的 conversation，再点 Connect Callback。";
    }
  } catch {
    fillPageOptions([]);
    $("callback").textContent = "未连接";
    setState("callbackStatus", "DISCONNECTED");
    $("callbackMessage").textContent = "回调控制器未连接。请先启动浏览器，等待 Callback 就绪后再选对话。";
  }
}

document.querySelectorAll("[data-action]").forEach((button) => {
  button.onclick = async () => {
    const result = await window.relayConsole.action({ type: button.dataset.action });
    if (result?.message) window.relayConsole.note(result.message);
    refreshCallback();
  };
});

$("defaultAgent").onchange = async () => {
  const agent = $("defaultAgent").value;
  try {
    const result = await window.relayConsole.action({ type: "set-default-agent", agent });
    if (result?.default_agent) $("defaultAgent").value = result.default_agent;
    $("defaultAgentMessage").textContent = result?.message || `本机默认 agent 已设为 ${agent}。`;
    if (result?.message) window.relayConsole.note(result.message);
  } catch (error) {
    $("defaultAgentMessage").textContent = `未能保存默认 agent：${actionErrorMessage(error)}`;
  }
};

$("connect").onclick = async () => {
  $("callbackMessage").textContent = "正在刷新对话并连接…";
  try {
    const callbackState = await window.relayConsole.action({ type: "callback-state" });
    if (callbackState?.available === false || callbackState?.error === "callback_unavailable") {
      $("callbackMessage").textContent = actionErrorMessage({ message: "callback_unavailable" });
      return;
    }
    const pages = callbackState.pages || [];
    fillPageOptions(pages);
    const uniqueId = pages.length === 1 ? Number(pages[0].id) : null;
    const page_id = selectedPageId() || (Number.isSafeInteger(uniqueId) && uniqueId > 0 ? uniqueId : null);
    if (!pages.length) {
      $("callbackMessage").textContent = "没有可绑定的 ChatGPT 对话。请确认中间 Relay Chrome 已打开 chatgpt.com 的 conversation（含项目对话），再点一次 Connect Callback。";
      return;
    }
    if (!page_id) {
      $("callbackMessage").textContent = `发现 ${pages.length} 个对话，请在列表中明确选择一个，再点 Connect Callback。`;
      return;
    }
    $("pages").value = String(page_id);
    const result = await window.relayConsole.action({ type: "connect-callback", page_id });
    if (result?.ok === false) {
      $("callbackMessage").textContent = `连接失败：${actionErrorMessage({ message: result.error })}`;
      return;
    }
    $("callbackMessage").textContent = "已刷新、Bind 并经回读确认 ARMED。";
    refreshCallback();
  } catch (error) {
    $("callbackMessage").textContent = `连接失败：${actionErrorMessage(error)}`;
  }
};

function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  const toggle = $("toggleSidebar");
  const label = collapsed ? "展开侧栏" : "收起侧栏";
  toggle.querySelector(".sr-only").textContent = label;
  toggle.title = label;
  toggle.setAttribute("aria-expanded", String(!collapsed));
  try { localStorage.setItem("agent-relay-console-sidebar", collapsed ? "collapsed" : "expanded"); } catch {}
  reportSurface();
}

$("toggleSidebar").onclick = () => setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"));
document.querySelector('a[href="#diagnostics"]')?.addEventListener("click", (event) => {
  event.preventDefault();
  window.relayConsole.setTerminalCollapsed(false);
});
try { if (localStorage.getItem("agent-relay-console-sidebar") === "collapsed") setSidebarCollapsed(true); } catch {}

window.relayConsole.onState(render);
new ResizeObserver(scheduleSurfaceReport).observe($("browserHost"));
const scrollHost = document.querySelector(".surface") || document.querySelector(".workspace");
scrollHost?.addEventListener("scroll", scheduleSurfaceReport, { passive: true });
scrollHost?.addEventListener("scrollend", reportSurface);
window.addEventListener("scroll", scheduleSurfaceReport, { passive: true });
window.addEventListener("scrollend", reportSurface);
window.addEventListener("resize", reportSurface);
refreshCallback();
reportSurface();
