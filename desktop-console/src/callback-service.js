"use strict";
const { requestJson } = require("./browser-service");
async function state(request = requestJson) { return request({ path: "/api/state" }); }
function selectedPage(pages, pageId) {
  const id = Number(pageId);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return (pages || []).find((entry) => Number(entry.id) === id) || null;
}

async function connect(pageId, request = requestJson) {
  const before = await state(request);
  const pages = before.pages || [];
  const page = selectedPage(pages, pageId) || (pages.length === 1 ? pages[0] : null);
  if (!page) {
    if (!pages.length) throw new Error("callback_no_chatgpt_conversation");
    throw new Error("callback_requires_explicit_page_selection");
  }
  await request({ path: "/api/bind-arm-configure", method: "POST", body: { page_id: Number(page.id) } });
  const after = await state(request);
  if (!(after.bound && after.armed && after.callback_target_state === "ARMED")) throw new Error("callback_not_armed_after_readback");
  return after;
}
module.exports = { state, connect, selectedPage };
