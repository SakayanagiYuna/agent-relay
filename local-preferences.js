"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_AGENT = "codex";
const ALLOWED_AGENTS = Object.freeze(["codex", "grok"]);
const ENV_KEY = "AGENT_RELAY_DEFAULT_AGENT";
const DEFAULT_ENV_PATH = path.join(__dirname, ".env");
const LEGACY_PREFERENCES_PATH = path.join(__dirname, ".agent-relay", "local-preferences.json");

function isAllowedAgent(value) {
  return ALLOWED_AGENTS.includes(String(value || ""));
}

function validateDefaultAgent(value) {
  const agent = String(value || "").trim();
  if (!isAllowedAgent(agent)) throw new Error("unsupported_default_agent");
  return agent;
}

function readEnvText(envPath, fsModule) {
  if (!fsModule.existsSync(envPath)) return "";
  return fsModule.readFileSync(envPath, "utf8");
}

function readEnvKey(text, key) {
  const match = String(text || "").match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!match) return null;
  return match[1].trim().replace(/^(?:"(.*)"|'(.*)')$/, "$1$2");
}

function upsertEnvLine(original, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(original)) return original.replace(pattern, line);
  return `${original}${original && !original.endsWith("\n") ? "\n" : ""}${line}\n`;
}

function saveDefaultAgent(agent, { envPath = DEFAULT_ENV_PATH, fsModule = fs, environment } = {}) {
  const default_agent = validateDefaultAgent(agent);
  const next = upsertEnvLine(readEnvText(envPath, fsModule), ENV_KEY, default_agent);
  fsModule.writeFileSync(envPath, next, { encoding: "utf8", mode: 0o600 });
  if (environment) environment[ENV_KEY] = default_agent;
  return { default_agent };
}

function migrateLegacyPreferences({ envPath, fsModule, environment }) {
  const jsonPath = path.join(path.dirname(envPath), ".agent-relay", "local-preferences.json");
  if (!fsModule.existsSync(jsonPath)) return null;
  try {
    const parsed = JSON.parse(fsModule.readFileSync(jsonPath, "utf8"));
    if (!isAllowedAgent(parsed?.default_agent)) return null;
    return saveDefaultAgent(parsed.default_agent, { envPath, fsModule, environment }).default_agent;
  } catch {
    return null;
  }
}

function loadLocalPreferences({ envPath = DEFAULT_ENV_PATH, fsModule = fs, environment = process.env, migrateLegacy = false } = {}) {
  const fileText = readEnvText(envPath, fsModule);
  const fileAgent = readEnvKey(fileText, ENV_KEY);
  if (fileAgent == null && migrateLegacy) {
    const migrated = migrateLegacyPreferences({ envPath, fsModule, environment });
    if (migrated) return { default_agent: migrated, source: "env-file", fileStatus: "migrated" };
  }
  if (isAllowedAgent(fileAgent)) return { default_agent: fileAgent, source: "env-file", fileStatus: "ok" };
  const fileStatus = fileAgent == null ? "missing" : "invalid";
  const envAgent = String(environment[ENV_KEY] || "").trim();
  if (isAllowedAgent(envAgent)) return { default_agent: envAgent, source: "env", fileStatus };
  return { default_agent: DEFAULT_AGENT, source: "builtin", fileStatus };
}

function loadDefaultAgent(options = {}) {
  return loadLocalPreferences(options).default_agent;
}

module.exports = {
  ALLOWED_AGENTS,
  DEFAULT_AGENT,
  DEFAULT_ENV_PATH,
  ENV_KEY,
  LEGACY_PREFERENCES_PATH,
  isAllowedAgent,
  loadDefaultAgent,
  loadLocalPreferences,
  saveDefaultAgent,
  validateDefaultAgent,
};
