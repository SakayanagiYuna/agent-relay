"use strict";
const { validateSurfaceRect } = require("./window-dock");
const ACTIONS = new Set(["start-listener", "start-browser", "focus-browser", "callback-state", "connect-callback", "request-state", "shutdown"]);
function validateAction(value) {
  if (!value || !ACTIONS.has(value.type)) throw new Error("console_ipc_action_invalid");
  if (value.type === "shutdown" && !["when-idle", "force"].includes(value.mode)) throw new Error("console_shutdown_mode_invalid");
  if (value.type === "connect-callback" && value.page_id !== undefined && !(Number.isSafeInteger(value.page_id) && value.page_id > 0)) throw new Error("console_page_id_invalid");
  return value;
}
function runtimeState(payload) { if (!payload || payload.schema_version !== 1 || !payload.relay || !payload.queue) throw new Error("console_runtime_state_invalid"); return payload; }
module.exports = { validateAction, runtimeState, validateSurfaceRect };
