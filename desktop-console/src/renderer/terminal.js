"use strict";
const $ = (id) => document.getElementById(id);

function applyCollapsed(collapsed) {
  document.body.classList.toggle("terminal-collapsed", collapsed);
  const toggle = $("toggleTerminal");
  const label = collapsed ? "展开终端" : "收起终端";
  toggle.querySelector(".sr-only").textContent = label;
  toggle.title = label;
  toggle.setAttribute("aria-expanded", String(!collapsed));
}

function setCollapsed(collapsed) {
  applyCollapsed(collapsed);
  try { localStorage.setItem("agent-relay-console-terminal", collapsed ? "collapsed" : "expanded"); } catch {}
  window.relayConsole.setTerminalCollapsed(collapsed);
}

$("toggleTerminal").onclick = () => setCollapsed(!document.body.classList.contains("terminal-collapsed"));

document.querySelectorAll("[data-action]").forEach((button) => {
  button.onclick = async () => {
    const result = await window.relayConsole.action({ type: button.dataset.action });
    if (result?.message) $("diagnostic").textContent = result.message;
  };
});

window.relayConsole.onTerminalCollapsed((collapsed) => {
  applyCollapsed(Boolean(collapsed));
  try { localStorage.setItem("agent-relay-console-terminal", collapsed ? "collapsed" : "expanded"); } catch {}
});
window.relayConsole.onDiagnostic((text) => { $("diagnostic").textContent = String(text || ""); });
window.relayConsole.onLog((entry) => {
  const output = $("consoleLog");
  const prior = output.textContent === "等待操作。点击启动按钮后将在此显示脱敏日志。" ? "" : output.textContent;
  output.textContent = `${prior}[${entry.component}] ${entry.text}`.slice(-12000);
  output.scrollTop = output.scrollHeight;
});

try {
  setCollapsed(localStorage.getItem("agent-relay-console-terminal") === "collapsed");
} catch {
  setCollapsed(false);
}
