"use strict";
const fs = require("fs");
const path = require("path");
function setBrowserCallbackTarget({ targetId, envPath = path.join(__dirname, ".env"), fsModule = fs } = {}) {
  if (!/^target-[A-Za-z0-9-]{1,64}$/.test(String(targetId || ""))) throw new Error("callback_target_id_invalid");
  const callbackLine = "AGENT_RELAY_BROWSER_CALLBACK_URL=http://127.0.0.1:8787/api/callback"; const line = `AGENT_RELAY_BROWSER_CALLBACK_TARGET_ID=${targetId}`; const runtimeLines = ["AGENT_RELAY_BROWSER_EXECUTABLE_PATH=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", `AGENT_RELAY_BROWSER_PROFILE_PATH=${path.join(__dirname, ".agent-relay", "chrome-profile")}`, "AGENT_RELAY_BROWSER_CDP_PORT=9333"];
  const original = fsModule.existsSync(envPath) ? fsModule.readFileSync(envPath, "utf8") : "";
  let next = /^AGENT_RELAY_BROWSER_CALLBACK_URL=.*$/m.test(original) ? original.replace(/^AGENT_RELAY_BROWSER_CALLBACK_URL=.*$/m, callbackLine) : `${original}${original && !original.endsWith("\n") ? "\n" : ""}${callbackLine}\n`; next = /^AGENT_RELAY_BROWSER_CALLBACK_TARGET_ID=.*$/m.test(next) ? next.replace(/^AGENT_RELAY_BROWSER_CALLBACK_TARGET_ID=.*$/m, line) : `${next}${line}\n`;
  for (const runtimeLine of runtimeLines) { const key = runtimeLine.split("=", 1)[0]; next = new RegExp(`^${key}=.*$`, "m").test(next) ? next.replace(new RegExp(`^${key}=.*$`, "m"), runtimeLine) : `${next}${runtimeLine}\n`; } fsModule.writeFileSync(envPath, next, { encoding: "utf8", mode: 0o600 });
  return { envPath, targetId };
}
if (require.main === module) { try { const result = setBrowserCallbackTarget({ targetId: process.argv[2] }); console.log(`[CONFIG] browser callback target saved: ${result.targetId}`); } catch (error) { console.error(`[ERROR] ${error.message}`); process.exitCode = 1; } }
module.exports = { setBrowserCallbackTarget };
