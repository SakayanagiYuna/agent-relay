"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const CALLBACK_TARGET_STATES = Object.freeze(["REGISTERED", "ARMED", "DISARMED", "EXPIRED"]);
const CALLBACK_TARGET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const BROWSER_CONTEXT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const REGISTRY_SCHEMA_VERSION = 1;

function validateCallbackTargetId(value) {
  const targetId = String(value || "");
  if (!CALLBACK_TARGET_ID_PATTERN.test(targetId)) throw new Error("callback_target_id_invalid");
  return targetId;
}

function validateBrowserContextId(value) {
  const contextId = String(value || "");
  if (!BROWSER_CONTEXT_ID_PATTERN.test(contextId)) throw new Error("browser_context_id_invalid");
  return contextId;
}

function validatePlatform(value) {
  const platform = String(value || "");
  if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(platform)) throw new Error("callback_target_platform_invalid");
  return platform;
}

function validateConversationIdentity(value) {
  const identity = String(value || "");
  if (!identity || identity.length > 2048) throw new Error("callback_target_conversation_identity_invalid");
  return identity;
}

function validateCallbackTargetState(value) {
  if (!CALLBACK_TARGET_STATES.includes(value)) throw new Error("callback_target_state_invalid");
  return value;
}

class CallbackTargetRegistry {
  constructor({ filePath = path.join(process.cwd(), ".agent-relay", "callback-registry.json"), fsModule = fs, now = () => new Date().toISOString(), randomUUID = crypto.randomUUID } = {}) {
    this.filePath = filePath;
    this.fs = fsModule;
    this.now = now;
    this.randomUUID = randomUUID;
    this.targets = new Map();
    this.load();
  }

  load() {
    if (!this.fs.existsSync(this.filePath)) return;
    let document;
    try { document = JSON.parse(this.fs.readFileSync(this.filePath, "utf8")); }
    catch { throw new Error("callback_registry_file_invalid"); }
    if (!document || document.schema_version !== REGISTRY_SCHEMA_VERSION || !Array.isArray(document.targets)) throw new Error("callback_registry_schema_invalid");
    for (const target of document.targets) {
      const normalized = this.normalize(target);
      if (this.targets.has(normalized.callback_target_id)) throw new Error("callback_registry_duplicate_target_id");
      this.targets.set(normalized.callback_target_id, normalized);
    }
  }

  normalize(target) {
    return Object.freeze({
      callback_target_id: validateCallbackTargetId(target.callback_target_id),
      platform: validatePlatform(target.platform),
      conversation_identity: validateConversationIdentity(target.conversation_identity),
      browser_context_id: target.browser_context_id ? validateBrowserContextId(target.browser_context_id) : null,
      created_at: String(target.created_at || "") || (() => { throw new Error("callback_target_created_at_invalid"); })(),
      state: validateCallbackTargetState(target.state),
    });
  }

  persist() {
    const directory = path.dirname(this.filePath);
    this.fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    this.fs.writeFileSync(temporaryPath, `${JSON.stringify({ schema_version: REGISTRY_SCHEMA_VERSION, targets: this.list() }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    this.fs.renameSync(temporaryPath, this.filePath);
  }

  list() { return [...this.targets.values()].map((target) => ({ ...target })); }

  register({ callback_target_id: requestedId, platform, conversation_identity: conversationIdentity, browser_context_id: browserContextId }) {
    const callbackTargetId = requestedId ? validateCallbackTargetId(requestedId) : `target-${this.randomUUID()}`;
    if (this.targets.has(callbackTargetId)) throw new Error("callback_target_id_exists");
    const target = this.normalize({ callback_target_id: callbackTargetId, platform, conversation_identity: conversationIdentity, browser_context_id: browserContextId, created_at: this.now(), state: "REGISTERED" });
    this.targets.set(target.callback_target_id, target);
    this.persist();
    return { ...target };
  }

  resolve(callbackTargetId) {
    const target = this.targets.get(validateCallbackTargetId(callbackTargetId));
    return target ? { ...target } : null;
  }

  setState(callbackTargetId, state) {
    const target = this.resolve(callbackTargetId);
    if (!target) throw new Error("callback_target_not_found");
    const next = this.normalize({ ...target, state });
    this.targets.set(next.callback_target_id, next);
    this.persist();
    return { ...next };
  }
}

module.exports = { BROWSER_CONTEXT_ID_PATTERN, CALLBACK_TARGET_ID_PATTERN, CALLBACK_TARGET_STATES, CallbackTargetRegistry, REGISTRY_SCHEMA_VERSION, validateBrowserContextId, validateCallbackTargetId, validateCallbackTargetState, validateConversationIdentity, validatePlatform };
