"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("relayConsole", {
  action: (action) => ipcRenderer.invoke("relay-console:action", action),
  reportSurface: (rect) => ipcRenderer.send("relay-console:surface", rect),
  note: (text) => ipcRenderer.send("relay-console:diagnostic", String(text || "")),
  setTerminalCollapsed: (collapsed) => ipcRenderer.send("relay-console:terminal-collapsed", Boolean(collapsed)),
  onState: (listener) => { ipcRenderer.on("relay-console:state", (_event, state) => listener(state)); },
  onLog: (listener) => { ipcRenderer.on("relay-console:log", (_event, entry) => listener(entry)); },
  onDiagnostic: (listener) => { ipcRenderer.on("relay-console:diagnostic", (_event, text) => listener(text)); },
  onTerminalCollapsed: (listener) => { ipcRenderer.on("relay-console:terminal-collapsed", (_event, collapsed) => listener(collapsed)); },
});
