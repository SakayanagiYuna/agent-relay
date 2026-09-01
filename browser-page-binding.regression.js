"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { BrowserPageBindingStore, pageIdentityFromUrl } = require("./browser-page-binding");
const { createRelayManagedBrowser } = require("./browser-callback");

function page(url, title = "Agent Relay") {
  return { currentUrl: url, url() { return this.currentUrl; }, async title() { return title; }, async goto(nextUrl) { this.currentUrl = nextUrl; } };
}

function chromiumFor(pages) {
  return { async launchPersistentContext() { return { pages: () => pages, newPage: async () => { const next = page("about:blank", ""); pages.push(next); return next; }, close: async () => {} }; } };
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-relay-page-binding-"));
  try {
    const profilePath = path.join(root, "profile");
    const store = new BrowserPageBindingStore({ filePath: path.join(root, "binding.json"), now: () => "2026-09-01T00:00:00.000Z" });
    const identity = pageIdentityFromUrl("https://chatgpt.com/c/target?temporary=1", "Agent Relay");
    assert.deepStrictEqual(identity, { origin: "https://chatgpt.com", pathname: "/c/target", title: "Agent Relay" });
    assert.throws(() => pageIdentityFromUrl("https://example.com/c/target", "bad"), /origin_not_allowed/);
    store.save({ profilePath, identity });
    assert.deepStrictEqual(store.get(profilePath).identity, identity, "the saved binding contains origin, pathname, and diagnostic title");

    const restoredPage = page("https://chatgpt.com/c/target", "Agent Relay");
    const restored = await createRelayManagedBrowser({ chromium: chromiumFor([restoredPage]), profilePath, pageBindingStore: store, lifecycleLog: () => {} });
    try {
      assert.strictEqual(restored.pageBinding.status, "RESTORED");
      assert.strictEqual(restored.pageBinding.page, restoredPage);
      assert.strictEqual(restoredPage.currentUrl, "https://chatgpt.com/c/target", "a restored binding never navigates to start_url");
    } finally { await restored.close(); }

    const missing = await createRelayManagedBrowser({ chromium: chromiumFor([page("https://chatgpt.com/", "ChatGPT")]), profilePath, pageBindingStore: store, lifecycleLog: () => {} });
    try { assert.strictEqual(missing.pageBinding.status, "REBIND_REQUIRED", "a missing page requires an explicit rebind"); }
    finally { await missing.close(); }

    const duplicate = await createRelayManagedBrowser({ chromium: chromiumFor([page("https://chatgpt.com/c/target", "Agent Relay"), page("https://chatgpt.com/c/target", "Agent Relay")]), profilePath, pageBindingStore: store, lifecycleLog: () => {} });
    try { assert.strictEqual(duplicate.pageBinding.status, "AMBIGUOUS", "duplicate matching pages are never selected automatically"); }
    finally { await duplicate.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().then(() => console.log("browser page binding regression passed")).catch((error) => { console.error(error); process.exitCode = 1; });
