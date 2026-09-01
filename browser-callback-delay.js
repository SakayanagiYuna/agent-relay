"use strict";

const BROWSER_EVIDENCE_CALLBACK_DELAY_MS = 30_000;

function shouldDelayBrowserCallback(evidenceReference) {
  return Boolean(evidenceReference?.fileId);
}

function waitForBrowserEvidenceIndexing({ evidenceReference, wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) } = {}) {
  if (!shouldDelayBrowserCallback(evidenceReference)) return Promise.resolve(false);
  return Promise.resolve(wait(BROWSER_EVIDENCE_CALLBACK_DELAY_MS)).then(() => true);
}

module.exports = { BROWSER_EVIDENCE_CALLBACK_DELAY_MS, shouldDelayBrowserCallback, waitForBrowserEvidenceIndexing };
