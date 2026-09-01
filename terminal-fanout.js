"use strict";

const { buildTerminalEvent } = require("./callback-event");

async function fanoutTerminalEvent({ taskId, status, elapsedSec, deliverBrowser, notifyHuman, diagnostic = () => {} } = {}) {
  const event = buildTerminalEvent({ taskId, status, elapsedSec });
  const branches = await Promise.allSettled([
    typeof deliverBrowser === "function" ? deliverBrowser(event) : Promise.resolve({ skipped: true }),
    typeof notifyHuman === "function" ? notifyHuman(event) : Promise.resolve({ skipped: true }),
  ]);
  const [browser, human] = branches;
  if (browser.status === "rejected") diagnostic("BROWSER_CALLBACK_FAILED", browser.reason, event);
  if (human.status === "rejected") diagnostic("HUMAN_NOTIFY_FAILED", human.reason, event);
  return { event, browser, human };
}

module.exports = { fanoutTerminalEvent };
