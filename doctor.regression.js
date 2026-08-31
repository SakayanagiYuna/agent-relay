"use strict";

const assert = require("assert");
const path = require("path");
const {
  parseEnvFile,
  redact,
  classifySubprocessFailure,
  resolveNpmInvocation,
  runNpm,
  checkRuntime,
  checkTests,
  checkSecrets,
  checkCodex,
  runDoctor,
} = require("./doctor");

const malformed = parseEnvFile("AGENT_RELAY_PATH=C:\\relay SLACK_BOT_TOKEN=xoxb-secret\n");
assert.strictEqual(malformed.errors.length, 1, "detects concatenated dotenv assignments");
assert.match(malformed.errors[0].reason, /SLACK_BOT_TOKEN/);
assert.doesNotMatch(redact("Slack rejected xoxb-super-secret-token"), /super-secret/);
assert.match(redact("Slack rejected xoxb-super-secret-token"), /REDACTED_TOKEN/);
assert.strictEqual(classifySubprocessFailure({ error: { code: "ENOENT" }, status: null }), "not-found");
assert.strictEqual(classifySubprocessFailure({ error: { code: "EINVAL" }, status: null }), "unsupported-invocation");
assert.strictEqual(classifySubprocessFailure({ error: { code: "EACCES" }, status: null }), "permission-or-policy");
assert.strictEqual(classifySubprocessFailure({ error: { code: "ETIMEDOUT" }, status: null }), "timeout");
assert.strictEqual(classifySubprocessFailure({ status: 7, stderr: "bad" }), "non-zero-exit");
assert.doesNotMatch(redact("failed token=xoxb-private-value password=hunter2"), /private-value|hunter2/);

const windowsExecPath = path.join("/node", "node.exe");
const windowsNpmCli = path.join("/node", "node_modules", "npm", "bin", "npm-cli.js");
const windowsFs = { existsSync: (candidate) => candidate === windowsNpmCli };
const windowsInvocation = resolveNpmInvocation({ platform: "win32", execPath: windowsExecPath, env: { PATH: "" }, fsModule: windowsFs });
assert.strictEqual(windowsInvocation.command, windowsExecPath);
assert.deepStrictEqual(windowsInvocation.argsPrefix, [windowsNpmCli]);
assert.doesNotMatch(windowsInvocation.command, /npm\.cmd$/i, "Windows Doctor must not spawn the npm shim");
const observedNpm = [];
const fakeWindowsRun = (command, args, options) => {
  observedNpm.push({ command, args, options });
  return { status: 0, stdout: "11.17.0", stderr: "" };
};
runNpm(["--version"], { platform: "win32", execPath: windowsExecPath, env: { PATH: "" }, fsModule: windowsFs, runCommand: fakeWindowsRun });
assert.deepStrictEqual(observedNpm[0].args, [windowsNpmCli, "--version"]);
assert.strictEqual(resolveNpmInvocation({ platform: "win32", execPath: windowsExecPath, env: { PATH: "" }, fsModule: { existsSync: () => false } }).error.code, "ENOENT");

const fakeNpmRun = (_command, args) => ({ status: 0, stdout: args[0].endsWith("npm-cli.js") ? "11.17.0" : "v24.19.0", stderr: "" });
assert.strictEqual(checkRuntime(fakeNpmRun, { platform: "win32", execPath: windowsExecPath, env: { PATH: "" }, fsModule: windowsFs }).status, "PASS");
assert.strictEqual(checkTests({ runCommand: fakeNpmRun, platform: "win32", execPath: windowsExecPath, env: { PATH: "" }, fsModule: windowsFs }).status, "PASS");
assert.match(checkRuntime(() => ({ status: null, error: { code: "EINVAL" } }), { platform: "win32", execPath: windowsExecPath, env: { PATH: "" }, fsModule: { existsSync: () => false } }).detail, /unsupported|not found/);
assert.match(checkTests({ runCommand: () => ({ status: null, error: { code: "ETIMEDOUT" } }), platform: "win32", execPath: windowsExecPath, env: { PATH: "" }, fsModule: windowsFs }).detail, /timed out/);

const complete = {
  AGENT_RELAY_WORKER_ID: "worker",
  AGENT_RELAY_ALLOWED_USER_ID: "U123",
  AGENT_RELAY_CHATGPT_APP_ID: "A123",
  AGENT_RELAY_CHANNEL_ID: "C123",
  AGENT_RELAY_ATELIER_OF_MEMORY_PATH: "C:\\atelier",
  AGENT_RELAY_PATH: "C:\\relay",
  SLACK_BOT_TOKEN: "xoxb-secret",
  SLACK_APP_TOKEN: "xapp-secret",
};
assert.strictEqual(checkSecrets({ env: complete, fileValues: {}, envFilePath: path.join("C:\\missing", ".env"), fsModule: { existsSync: () => false } }).status, "WARN");
assert.strictEqual(checkSecrets({ env: { ...complete, AGENT_RELAY_CHANNEL_ID: "" }, fileValues: {}, envFilePath: path.join("C:\\missing", ".env"), fsModule: { existsSync: () => false } }).status, "FAIL");

const codexPath = path.resolve("C:\\tools\\codex.exe");
const codexResult = checkCodex({
  env: { CODEX_BIN: codexPath },
  fsModule: { statSync: () => ({ isFile: () => true }) },
  runCommand: (_command, args) => ({ status: 0, stdout: args[0] === "--version" ? "codex 1" : "authenticated", stderr: "" }),
});
assert.strictEqual(codexResult.status, "PASS", "Doctor uses the shared Codex discovery override");
assert.match(codexResult.detail, /override/);

(async () => {
  const output = [];
  const result = await runDoctor({
    root: process.cwd(),
    env: { ...complete, CODEX_BIN: path.resolve("C:\\tools\\codex.exe") },
    skipTests: true,
    slackClient: { auth: { test: async () => ({ ok: true }) } },
    fsModule: {
      existsSync: (candidate) => !String(candidate).endsWith(`${path.sep}.env`) && !String(candidate).endsWith("\\.env"),
      statSync: () => ({ isFile: () => true }),
      readFileSync: () => "",
    },
    runCommand: (_command, args) => {
      if (args.includes("--version")) return { status: 0, stdout: "v20", stderr: "" };
      if (args.includes("--show-current")) return { status: 0, stdout: "master", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    },
    out: (line) => output.push(line),
  });
  assert.strictEqual(result.ready, true);
  assert.strictEqual(result.exitCode, 0);
  assert.match(output.at(-1), /READY_FOR_RELAY: YES/);
  const failedOutput = [];
  const failed = await runDoctor({
    root: process.cwd(), env: {}, skipTests: true,
    fsModule: { existsSync: () => false },
    runCommand: () => ({ status: 0, stdout: "v20", stderr: "" }),
    out: (line) => failedOutput.push(line),
  });
  assert.strictEqual(failed.ready, false, "readiness-critical failures make Doctor fail");
  assert.strictEqual(failed.exitCode, 1, "Doctor returns a non-zero exit code when not ready");
  assert.match(failedOutput.at(-1), /READY_FOR_RELAY: NO/);
  console.log("doctor regression checks passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
