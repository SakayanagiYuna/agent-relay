"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("relayConsole", {
  action: (action) => ipcRenderer.invoke("relay-console:action", action),
  reportSurface: (rect) => ipcRenderer.send("relay-console:surface", rect),
  onState: (listener) => { ipcRenderer.on("relay-console:state", (_event, state) => listener(state)); },
  onLog: (listener) => { ipcRenderer.on("relay-console:log", (_event, entry) => listener(entry)); },
});
