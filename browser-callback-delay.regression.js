"use strict";

const assert = require("assert");
const { BROWSER_EVIDENCE_CALLBACK_DELAY_MS, shouldDelayBrowserCallback, waitForBrowserEvidenceIndexing } = require("./browser-callback-delay");

assert.strictEqual(BROWSER_EVIDENCE_CALLBACK_DELAY_MS, 30_000);
assert.strictEqual(shouldDelayBrowserCallback({ fileId: "F123" }), true);
assert.strictEqual(shouldDelayBrowserCallback(null), false);
(async () => {
  let waited = 0;
  assert.strictEqual(await waitForBrowserEvidenceIndexing({ evidenceReference: { fileId: "F123" }, wait: async (milliseconds) => { waited = milliseconds; } }), true);
  assert.strictEqual(waited, 30_000);
  assert.strictEqual(await waitForBrowserEvidenceIndexing({ evidenceReference: null, wait: async () => { throw new Error("must not wait"); } }), false);
  console.log("browser callback evidence delay regression passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
