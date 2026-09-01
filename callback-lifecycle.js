"use strict";

const { buildTerminalCallbackPayload } = require("./callback-event");

async function deliverTerminalCallback({ taskId, status, callbackTargetId, slackStatusTs, slackChannelId, evidenceReference, deliver } = {}) {
  if (typeof deliver !== "function") throw new Error("callback_delivery_function_invalid");
  const payload = buildTerminalCallbackPayload({ taskId, status, callbackTargetId, slackStatusTs, slackChannelId, evidenceReference });
  await deliver(payload);
  return payload;
}

module.exports = { deliverTerminalCallback };
