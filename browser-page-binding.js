"use strict";

const fs = require("fs");
const path = require("path");

const PAGE_BINDING_SCHEMA_VERSION = 1;
const DEFAULT_PAGE_BINDING_PATH = path.join(process.cwd(), ".agent-relay", "browser-page-binding.json");

function pageIdentityFromUrl(rawUrl, title = "") {
  let url;
  try { url = new URL(String(rawUrl || "")); } catch { throw new Error("browser_page_identity_url_invalid"); }
  if (url.protocol !== "https:" || !["chatgpt.com", "www.chatgpt.com", "chat.openai.com"].includes(url.hostname) || url.username || url.password) throw new Error("browser_page_binding_origin_not_allowed");
  return Object.freeze({ origin: url.origin, pathname: url.pathname, title: String(title || "") });
}

function validatePageIdentity(identity) {
  if (!identity || typeof identity !== "object" || typeof identity.title !== "string") throw new Error("browser_page_identity_invalid");
  return pageIdentityFromUrl(`${identity.origin}${identity.pathname}`, identity.title);
}

function sameConversationPage(left, right) {
  return Boolean(left && right && left.origin === right.origin && left.pathname === right.pathname);
}

class BrowserPageBindingStore {
  constructor({ filePath = DEFAULT_PAGE_BINDING_PATH, fsModule = fs, now = () => new Date().toISOString() } = {}) {
    this.filePath = filePath;
    this.fs = fsModule;
    this.now = now;
    this.bindings = new Map();
    this.load();
  }

  load() {
    if (!this.fs.existsSync(this.filePath)) return;
    let document;
    try { document = JSON.parse(this.fs.readFileSync(this.filePath, "utf8")); } catch { throw new Error("browser_page_binding_file_invalid"); }
    if (!document || document.schema_version !== PAGE_BINDING_SCHEMA_VERSION || !Array.isArray(document.bindings)) throw new Error("browser_page_binding_schema_invalid");
    for (const binding of document.bindings) {
      const profilePath = path.resolve(String(binding.profile_path || ""));
      if (!path.isAbsolute(profilePath) || this.bindings.has(profilePath)) throw new Error("browser_page_binding_invalid");
      this.bindings.set(profilePath, Object.freeze({ profile_path: profilePath, identity: validatePageIdentity(binding.identity), saved_at: String(binding.saved_at || "") || (() => { throw new Error("browser_page_binding_invalid"); })() }));
    }
  }

  persist() {
    this.fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    this.fs.writeFileSync(temporaryPath, `${JSON.stringify({ schema_version: PAGE_BINDING_SCHEMA_VERSION, bindings: this.list() }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    this.fs.renameSync(temporaryPath, this.filePath);
  }

  list() { return [...this.bindings.values()].map((binding) => ({ profile_path: binding.profile_path, identity: { ...binding.identity }, saved_at: binding.saved_at })); }
  get(profilePath) { const binding = this.bindings.get(path.resolve(profilePath)); return binding ? { profile_path: binding.profile_path, identity: { ...binding.identity }, saved_at: binding.saved_at } : null; }
  save({ profilePath, identity }) {
    const normalizedProfilePath = path.resolve(String(profilePath || ""));
    if (!path.isAbsolute(normalizedProfilePath)) throw new Error("browser_profile_path_invalid");
    const binding = Object.freeze({ profile_path: normalizedProfilePath, identity: validatePageIdentity(identity), saved_at: this.now() });
    this.bindings.set(normalizedProfilePath, binding);
    this.persist();
    return { profile_path: binding.profile_path, identity: { ...binding.identity }, saved_at: binding.saved_at };
  }
}

async function pagesMatchingBinding(context, identity) {
  const matches = [];
  for (const page of context.pages()) {
    let title = "";
    try { if (typeof page.title === "function") title = await page.title(); } catch { title = ""; }
    try {
      const candidate = pageIdentityFromUrl(page.url(), title);
      if (sameConversationPage(candidate, identity)) matches.push({ page, identity: candidate });
    } catch { /* A non-allowlisted page cannot satisfy a saved binding. */ }
  }
  return matches;
}

module.exports = { BrowserPageBindingStore, DEFAULT_PAGE_BINDING_PATH, PAGE_BINDING_SCHEMA_VERSION, pageIdentityFromUrl, pagesMatchingBinding, sameConversationPage, validatePageIdentity };
