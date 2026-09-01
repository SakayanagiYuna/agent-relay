"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { discoverCodexExecutable } = require("./codex-discovery");
const { parseLoopbackUrl, resolveBrowserExecutablePath } = require("./browser-evidence");
const { validateRelayCallbackUrl } = require("./browser-callback");

const ROOT = __dirname;
const REQUIRED_KEYS = [
  "AGENT_RELAY_WORKER_ID",
  "AGENT_RELAY_ALLOWED_USER_ID",
  "AGENT_RELAY_CHATGPT_APP_ID",
  "AGENT_RELAY_CHANNEL_ID",
  "AGENT_RELAY_ATELIER_OF_MEMORY_PATH",
  "AGENT_RELAY_PATH",
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
];
const SLACK_KEYS = ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "AGENT_RELAY_CHANNEL_ID"];
const DEPRECATED_KEYS = ["TERRA_RELAY_PATH", "TERRA_ATELIER_OF_MEMORY_PATH", "TERRA_WORKER_ID", "TERRA_CHANNEL_ID"];

function parseEnvFile(text) {
  const values = {};
  const errors = [];
  const lines = String(text || "").split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      errors.push({ line: index + 1, reason: "invalid dotenv entry" });
      continue;
    }
    const [, key, rawValue] = match;
    const assignments = [...rawValue.matchAll(/(AGENT_RELAY_[A-Za-z0-9_]+|SLACK_[A-Za-z0-9_]+|CODEX_[A-Za-z0-9_]+|TERRA_[A-Za-z0-9_]+)=/g)];
    if (assignments.length) {
      errors.push({ line: index + 1, key, reason: `assignment ${assignments[0][1]} is embedded in the value` });
    }
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return { values, errors };
}

function redact(value) {
  return String(value || "")
    .replace(/\b(?:xoxb|xapp|xoxp)-[A-Za-z0-9-]+\b/gi, "[REDACTED_TOKEN]")
    .replace(/\b(?:token|secret|password|api[_-]?key|auth)\s*[=:]\s*[^\s,)]+/gi, "[REDACTED_ASSIGNMENT]")
    .replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}

function result(status, detail) { return { status, detail }; }
function valueOf(env, fileValues, key) {
  return String(env[key] !== undefined ? env[key] : (fileValues[key] || "")).trim();
}
function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", shell: false, windowsHide: true, timeout: options.timeout || 5000, cwd: options.cwd });
}
function safeOutput(processResult) {
  return redact(processResult.stderr || processResult.stdout || processResult.error?.message || "");
}
function classifySubprocessFailure(processResult) {
  const code = processResult?.error?.code;
  if (code === "ETIMEDOUT" || processResult?.signal === "SIGTERM" && processResult?.status === null) return "timeout";
  if (code === "ENOENT") return "not-found";
  if (code === "EINVAL") return "unsupported-invocation";
  if (["EPERM", "EACCES"].includes(code)) return "permission-or-policy";
  if (processResult && processResult.status !== 0 && processResult.status !== null && !processResult.error) return "non-zero-exit";
  if (processResult?.error) return "spawn-error";
  return null;
}
function subprocessFailureDetail(processResult) {
  const kind = classifySubprocessFailure(processResult);
  if (!kind) return "";
  const labels = {
    "not-found": "executable or npm CLI was not found",
    "unsupported-invocation": "subprocess invocation is unsupported on this host",
    "permission-or-policy": "subprocess permission or local policy blocked execution",
    timeout: "subprocess timed out",
    "non-zero-exit": "child exited non-zero",
    "spawn-error": "subprocess could not be started",
  };
  const output = safeOutput(processResult);
  return `${labels[kind]}${output ? `: ${output}` : ""}`;
}
function resolveNpmInvocation({ platform = process.platform, execPath = process.execPath, env = process.env, fsModule = fs } = {}) {
  if (platform !== "win32") return { command: "npm", argsPrefix: [] };
  const nodeDir = path.dirname(execPath);
  const candidates = [path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js")];
  for (const entry of String(env.PATH || "").split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(entry, "node_modules", "npm", "bin", "npm-cli.js"));
  }
  const npmCli = candidates.find((candidate) => {
    try { return fsModule.existsSync(candidate); } catch { return false; }
  });
  if (!npmCli) return { command: execPath, argsPrefix: [], error: { code: "ENOENT", message: "npm CLI entry was not found" } };
  return { command: execPath, argsPrefix: [npmCli] };
}
function runNpm(args, { runCommand = run, platform = process.platform, execPath = process.execPath, env = process.env, fsModule = fs, ...options } = {}) {
  const invocation = resolveNpmInvocation({ platform, execPath, env, fsModule });
  if (invocation.error) return { status: null, stdout: "", stderr: "", error: invocation.error };
  return runCommand(invocation.command, [...invocation.argsPrefix, ...args], options);
}

function checkRuntime(runCommand = run, options = {}) {
  const node = runCommand(process.execPath, ["--version"]);
  const npm = runNpm(["--version"], { ...options, runCommand });
  if (node.status !== 0 || npm.status !== 0) {
    const failure = subprocessFailureDetail(node) || subprocessFailureDetail(npm);
    if (failure && classifySubprocessFailure(node) !== "non-zero-exit" && classifySubprocessFailure(npm) !== "non-zero-exit") return result("WARN", `Node/npm probe: ${failure}`);
    return result("FAIL", `Node/npm version check failed${failure ? `: ${failure}` : ""}`);
  }
  return result("PASS", `Node ${String(node.stdout).trim()}, npm ${String(npm.stdout).trim()}`);
}

function checkRepository({ env, fileValues, root = ROOT, runCommand = run, fsModule = fs } = {}) {
  const configured = [valueOf(env, fileValues, "AGENT_RELAY_PATH"), valueOf(env, fileValues, "AGENT_RELAY_ATELIER_OF_MEMORY_PATH")].filter(Boolean);
  const paths = [...new Set([root, ...configured.map((entry) => path.resolve(entry))])];
  const warnings = [];
  for (const repoPath of paths) {
    if (!fsModule.existsSync(repoPath)) return result("FAIL", `Repository path is missing: ${repoPath}`);
    const check = runCommand("git", ["-C", repoPath, "status", "--porcelain"], { cwd: repoPath });
    if (check.status !== 0 && check.error) return result("FAIL", `Git repository/trust check could not run for ${repoPath}: ${subprocessFailureDetail(check)}`);
    if (check.status !== 0) return result("FAIL", `Git repository/trust check failed for ${repoPath}${safeOutput(check) ? ` (${safeOutput(check)})` : ""}`);
    if (repoPath === root && String(check.stdout || "").trim()) warnings.push("working tree is dirty (informational)");
  }
  const branch = runCommand("git", ["-C", root, "branch", "--show-current"], { cwd: root });
  return result(warnings.length ? "WARN" : "PASS", `branch ${String(branch.stdout || "").trim() || "(detached)"}${warnings.length ? `; ${warnings.join("; ")}` : ""}`);
}

function checkSecrets({ env, fileValues, envFilePath = path.join(ROOT, ".env"), fsModule = fs } = {}) {
  const missing = REQUIRED_KEYS.filter((key) => !valueOf(env, fileValues, key));
  const deprecated = Object.keys({ ...fileValues, ...env }).filter((key) => /^TERRA_/.test(key));
  if (missing.length) return result("FAIL", `missing required configuration: ${missing.join(", ")}`);
  if (deprecated.length) return result("WARN", "deprecated TERRA_* configuration detected; migrate to AGENT_RELAY_* names");
  if (fsModule.existsSync(envFilePath)) {
    const tracked = run("git", ["ls-files", "--error-unmatch", path.relative(ROOT, envFilePath)]);
    if (tracked.status !== 0 && tracked.error && ["EPERM", "EACCES"].includes(tracked.error.code)) return result("WARN", ".env ignore/tracking probe was blocked by local permission or policy");
    if (tracked.status === 0) return result("FAIL", ".env is tracked by Git");
    const ignored = run("git", ["check-ignore", "--quiet", path.relative(ROOT, envFilePath)]);
    if (ignored.status !== 0 && ignored.error && ["EPERM", "EACCES"].includes(ignored.error.code)) return result("WARN", ".env tracking probe was blocked by local permission or policy");
    if (ignored.status !== 0) return result("FAIL", ".env is not ignored by Git");
    return result("PASS", ".env is present, ignored, and untracked");
  }
  return result("WARN", ".env is absent; process environment configuration is being used");
}

async function checkSlack({ env, fileValues, slackClient, timeoutMs = 5000 } = {}) {
  const missing = SLACK_KEYS.filter((key) => !valueOf(env, fileValues, key));
  if (missing.length) return result("FAIL", `missing Slack configuration: ${missing.join(", ")}`);
  if (!slackClient) {
    try { slackClient = new (require("@slack/web-api").WebClient)(valueOf(env, fileValues, "SLACK_BOT_TOKEN")); }
    catch { return result("WARN", "Slack SDK unavailable; configuration shape passed"); }
  }
  let timer;
  try {
    await Promise.race([
      Promise.resolve(slackClient.auth.test()),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), timeoutMs); }),
    ]);
    return result("PASS", "read-only Slack auth.test passed");
  } catch (error) {
    return result("FAIL", `Slack auth.test failed: ${redact(error.message) || "redacted error"}`);
  } finally {
    clearTimeout(timer);
  }
}

function checkCodex({ env, runCommand = run, fsModule = fs } = {}) {
  let discovery;
  try {
    discovery = discoverCodexExecutable({ configuredPath: env.CODEX_BIN, env: { ...process.env, ...env }, fsModule });
  } catch (error) { return result("FAIL", redact(error.message)); }
  const version = runCommand(discovery.executablePath, ["--version"]);
  if (version.status !== 0 && version.error) return result("WARN", `Codex executable found via ${discovery.source}, but ${subprocessFailureDetail(version)}`);
  if (version.status !== 0) return result("FAIL", `unable to run Codex (${discovery.source}): ${safeOutput(version) || "version command failed"}`);
  const auth = runCommand(discovery.executablePath, ["login", "status"]);
  const authText = `${auth.stdout || ""} ${auth.stderr || ""}`.toLowerCase();
  if (auth.status !== 0 && !authText.includes("unknown command") && !authText.includes("unrecognized")) {
    return result("WARN", `Codex ${discovery.source} executable verified; authentication status unavailable`);
  }
  if (auth.status === 0 && !/(logged[ -]?in|authenticated|auth status.*(ok|valid)|already logged)/i.test(authText)) {
    return result("WARN", `Codex ${discovery.source} executable verified; authentication status was ambiguous`);
  }
  return result("PASS", `Codex ${discovery.source}: ${discovery.executablePath}; version/auth probe passed`);
}

function checkBrowser({ env, fileValues, fsModule = fs } = {}) {
  const enabled = valueOf(env, fileValues, "AGENT_RELAY_BROWSER_EVIDENCE_ENABLED") === "true";
  const callbackUrl = valueOf(env, fileValues, "AGENT_RELAY_BROWSER_CALLBACK_URL");
  if (callbackUrl) {
    try { validateRelayCallbackUrl(callbackUrl); }
    catch (error) { return result("FAIL", `invalid browser callback URL: ${redact(error.message)}`); }
  }
  if (!enabled) return result("WARN", `browser evidence disabled (informational)${callbackUrl ? "; browser callback endpoint validated" : ""}`);
  const origins = valueOf(env, fileValues, "AGENT_RELAY_BROWSER_ALLOWED_ORIGINS").split(",").map((v) => v.trim()).filter(Boolean);
  if (!origins.length) return result("FAIL", "browser evidence is enabled but allowed origins are missing");
  try { origins.forEach((origin) => { const parsed = parseLoopbackUrl(origin); if (parsed.origin !== origin.replace(/\/$/, "")) throw new Error("allowed origins must be exact loopback origins"); }); }
  catch (error) { return result("FAIL", `invalid browser origin: ${redact(error.message)}`); }
  const timeout = Number(valueOf(env, fileValues, "AGENT_RELAY_BROWSER_EVIDENCE_TIMEOUT_MS") || 15000);
  if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 60000) return result("FAIL", "browser timeout must be 1000-60000ms");
  const browserPath = valueOf(env, fileValues, "AGENT_RELAY_BROWSER_EXECUTABLE_PATH");
  if (browserPath) { try { resolveBrowserExecutablePath(browserPath); } catch { return result("FAIL", "configured browser executable is invalid or missing"); } }
  const evidenceRoot = path.resolve(valueOf(env, fileValues, "AGENT_RELAY_PATH"), ".agent-relay");
  if (evidenceRoot !== path.resolve(ROOT, ".agent-relay")) return result("FAIL", "evidence directory is not the current Agent Relay .agent-relay location");
  return result("PASS", `enabled browser paths, origins, timeout, and evidence location validated${callbackUrl ? "; browser callback endpoint validated" : ""}`);
}

function checkTests({ runCommand = run, root = ROOT, ...options } = {}) {
  const test = runNpm(["test"], { ...options, runCommand, cwd: root, timeout: 120000 });
  if (test.status !== 0 && test.error) return result("WARN", `npm test: ${subprocessFailureDetail(test)}`);
  return test.status === 0 ? result("PASS", "npm test passed") : result("FAIL", "npm test failed (see test output for details)");
}

async function runDoctor({ env = process.env, root = ROOT, runCommand = run, fsModule = fs, slackClient, skipTests = false, out = console.log } = {}) {
  const envFilePath = path.join(root, ".env");
  let fileValues = {};
  let dotenvErrors = [];
  if (fsModule.existsSync(envFilePath)) {
    const parsed = parseEnvFile(fsModule.readFileSync(envFilePath, "utf8")); fileValues = parsed.values; dotenvErrors = parsed.errors;
  }
  const checks = [];
  checks.push(["Runtime", checkRuntime(runCommand, { platform: process.platform, execPath: process.execPath, env, fsModule })]);
  checks.push(["Repository", checkRepository({ env, fileValues, root, runCommand, fsModule })]);
  const secrets = checkSecrets({ env, fileValues, envFilePath, fsModule });
  if (dotenvErrors.length && secrets.status !== "FAIL") checks.push(["Secrets", result("FAIL", `malformed .env assignment on line ${dotenvErrors[0].line}`)]);
  else checks.push(["Secrets", secrets]);
  checks.push(["Slack", await checkSlack({ env, fileValues, slackClient })]);
  checks.push(["Codex", checkCodex({ env, runCommand, fsModule })]);
  checks.push(["Browser", checkBrowser({ env, fileValues, fsModule })]);
  if (!skipTests) checks.push(["Tests", checkTests({ runCommand, root, platform: process.platform, execPath: process.execPath, env, fsModule })]);
  let failed = false;
  out("Agent Relay Doctor");
  for (const [name, check] of checks) { failed ||= check.status === "FAIL"; out(`${check.status === "PASS" ? "✓" : check.status === "WARN" ? "!" : "✗"} ${name} [${check.status}]${check.detail ? ` — ${check.detail}` : ""}`); }
  out(`READY_FOR_RELAY: ${failed ? "NO" : "YES"}`);
  return { checks, ready: !failed, exitCode: failed ? 1 : 0 };
}

if (require.main === module) {
  const skipTests = process.argv.includes("--skip-tests");
  runDoctor({ skipTests }).then(({ exitCode }) => { process.exitCode = exitCode; }).catch((error) => { console.error(`Doctor failed safely: ${redact(error.message)}`); process.exitCode = 1; });
}

module.exports = { parseEnvFile, redact, classifySubprocessFailure, resolveNpmInvocation, runNpm, checkRuntime, checkRepository, checkSecrets, checkSlack, checkCodex, checkBrowser, checkTests, runDoctor };
