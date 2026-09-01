"use strict";

const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync(require.resolve("./listener"), "utf8");
const terminalStatus = source.indexOf("const terminalReceipt = await sendStatus({", source.indexOf("const terminalExecution = execution.stop(result.status)"));
const terminalFanout = source.indexOf("await fanoutTerminalNotifications({", terminalStatus);

assert.ok(terminalStatus >= 0, "terminal Slack status receipt must be captured");
assert.ok(terminalFanout > terminalStatus, "Browser Callback must run only after the terminal Slack status call");
assert.match(source.slice(terminalFanout, terminalFanout + 300), /slackReceipt: terminalReceipt/, "callback fan-out must receive the confirmed terminal Slack receipt");
assert.match(source, /const callbackReady = browserCallback\.endpoint && slackReceipt\?\.ts;/, "callback must be skipped when Slack did not confirm the terminal status");

console.log("listener callback ordering regression passed");
