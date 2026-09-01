"use strict";

const http = require("http");

function requestJson({ method, path, body = null, port = 8787 }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const request = http.request({ host: "127.0.0.1", port, path, method, headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : undefined }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => {
        let parsed;
        try { parsed = JSON.parse(raw); } catch { return reject(new Error("browser_callback_invalid_response")); }
        if (response.statusCode >= 400) return reject(new Error(parsed.error || "browser_callback_request_failed"));
        resolve(parsed);
      });
    });
    request.on("error", () => reject(new Error("browser_callback_not_running")));
    if (payload) request.write(payload);
    request.end();
  });
}

async function bindArmConfigure({ pageId = null, port = 8787 } = {}) {
  const state = await requestJson({ method: "GET", path: "/api/state", port });
  const candidates = pageId === null ? state.pages : state.pages.filter((page) => page.id === pageId);
  if (candidates.length !== 1) throw new Error(candidates.length ? "bind_requires_explicit_chatgpt_page" : "no_chatgpt_conversation_page");
  return requestJson({ method: "POST", path: "/api/bind-arm-configure", body: { page_id: candidates[0].id }, port });
}

if (require.main === module) {
  const pageId = process.argv[2] === undefined ? null : Number(process.argv[2]);
  bindArmConfigure({ pageId }).then((result) => console.log(result.message)).catch((error) => { console.error(`[ERROR] ${error.message}`); process.exitCode = 1; });
}

module.exports = { bindArmConfigure, requestJson };
