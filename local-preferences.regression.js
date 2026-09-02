"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ENV_KEY, loadDefaultAgent, loadLocalPreferences, saveDefaultAgent, validateDefaultAgent } = require("./local-preferences");

assert.throws(() => validateDefaultAgent("claude"), /unsupported_default_agent/);
assert.strictEqual(validateDefaultAgent("grok"), "grok");

const missing = loadLocalPreferences({
  envPath: path.join(os.tmpdir(), `agent-relay-missing-env-${process.pid}`),
  fsModule: { existsSync: () => false },
  environment: {},
});
assert.deepStrictEqual(missing, { default_agent: "codex", source: "builtin", fileStatus: "missing" });

const fromEnv = loadLocalPreferences({
  envPath: path.join(os.tmpdir(), `agent-relay-missing-env-${process.pid}`),
  fsModule: { existsSync: () => false },
  environment: { [ENV_KEY]: "grok" },
});
assert.deepStrictEqual(fromEnv, { default_agent: "grok", source: "env", fileStatus: "missing" });

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-relay-env-"));
const envPath = path.join(directory, ".env");
fs.writeFileSync(envPath, "SLACK_BOT_TOKEN=xoxb-secret\nAGENT_RELAY_WORKER_ID=worker-1\n");
const environment = {};
assert.deepStrictEqual(saveDefaultAgent("grok", { envPath, environment }), { default_agent: "grok" });
assert.strictEqual(environment[ENV_KEY], "grok");
const saved = fs.readFileSync(envPath, "utf8");
assert.match(saved, /^AGENT_RELAY_DEFAULT_AGENT=grok$/m);
assert.match(saved, /^SLACK_BOT_TOKEN=xoxb-secret$/m);
assert.strictEqual(loadDefaultAgent({ envPath, environment: { [ENV_KEY]: "codex" } }), "grok");
assert.strictEqual(loadLocalPreferences({ envPath, environment: {} }).source, "env-file");

saveDefaultAgent("codex", { envPath, environment });
assert.match(fs.readFileSync(envPath, "utf8"), /^AGENT_RELAY_DEFAULT_AGENT=codex$/m);
assert.doesNotMatch(fs.readFileSync(envPath, "utf8"), /AGENT_RELAY_DEFAULT_AGENT=grok/);

fs.writeFileSync(envPath, `${ENV_KEY}="grok"\n`);
assert.strictEqual(loadDefaultAgent({ envPath, environment: {} }), "grok");

fs.writeFileSync(envPath, `${ENV_KEY}=claude\n`);
const invalid = loadLocalPreferences({ envPath, environment: { [ENV_KEY]: "grok" } });
assert.strictEqual(invalid.fileStatus, "invalid");
assert.strictEqual(invalid.default_agent, "grok");
assert.strictEqual(invalid.source, "env");

const jsonPath = path.join(directory, ".agent-relay", "local-preferences.json");
fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
fs.writeFileSync(jsonPath, JSON.stringify({ schema_version: 1, default_agent: "grok" }));
fs.writeFileSync(envPath, "AGENT_RELAY_WORKER_ID=worker-1\n");
const migrated = loadLocalPreferences({ envPath, environment: {}, migrateLegacy: true });
assert.strictEqual(migrated.default_agent, "grok");
assert.strictEqual(migrated.source, "env-file");
assert.match(fs.readFileSync(envPath, "utf8"), /^AGENT_RELAY_DEFAULT_AGENT=grok$/m);

fs.rmSync(directory, { recursive: true, force: true });
console.log("local-preferences regression: passed");
