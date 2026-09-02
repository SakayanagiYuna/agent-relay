"use strict";
const { requestJson } = require("./browser-service");

function isCallbackOffline(error) {
  const text = String(error?.code || error?.message || error);
  return /ECONNREFUSED|loopback_timeout|loopback_offline/.test(text);
}

async function state(request = requestJson) {
  try {
    return { available: true, ...(await request({ path: "/api/state" })) };
  } catch (error) {
    if (isCallbackOffline(error)) {
      return { available: false, pages: [], bound: false, armed: false, error: "callback_unavailable" };
    }
    throw error;
  }
}

function selectedPage(pages, pageId) {
  const id = Number(pageId);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return (pages || []).find((entry) => Number(entry.id) === id) || null;
}

async function connect(pageId, request = requestJson) {
  const before = await state(request);
  if (before.available === false) throw new Error("callback_unavailable");
  const pages = before.pages || [];
  const page = selectedPage(pages, pageId) || (pages.length === 1 ? pages[0] : null);
  if (!page) {
    if (!pages.length) throw new Error("callback_no_chatgpt_conversation");
    throw new Error("callback_requires_explicit_page_selection");
  }
  await request({ path: "/api/bind-arm-configure", method: "POST", body: { page_id: Number(page.id) } });
  const after = await state(request);
  if (after.available === false) throw new Error("callback_unavailable");
  if (!(after.bound && after.armed && after.callback_target_state === "ARMED")) throw new Error("callback_not_armed_after_readback");
  return after;
}
module.exports = { state, connect, selectedPage, isCallbackOffline };
