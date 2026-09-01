"use strict";

const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync(require.resolve("./listener"), "utf8");
const healthCheck = source.indexOf("normalizedText === HEALTH_COMMAND");
const sourceAuthentication = source.indexOf("const source =");
const botFilter = source.indexOf("if (message.bot_id)");

assert.ok(healthCheck >= 0, "listener must recognize the exact health command");
assert.match(source.slice(healthCheck - 160, healthCheck + 260), /message\.channel === CHANNEL_ID/, "health command must remain scoped to the configured channel");
assert.ok(healthCheck < botFilter, "health command must accept probes from Slack bots");
assert.ok(healthCheck < sourceAuthentication, "health command must bypass sender authentication");
assert.match(source.slice(healthCheck, healthCheck + 700), /runningTasks: runningTaskCount/, "health reply must include the active task count");
assert.match(source.slice(healthCheck, healthCheck + 700), /queuedTasks: queuedTaskCount/, "health reply must include the queued task count");

console.log("listener health command regression passed");
