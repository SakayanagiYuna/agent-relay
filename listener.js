const { App } = require("@slack/bolt");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const {
  captureBrowserEvidence,
  isSlackFilesScopeError,
  parseLoopbackUrl,
  redactText: redactBrowserText,
  resolveBrowserExecutablePath,
} = require("./browser-evidence");
const { validateRelayCallbackUrl } = require("./browser-callback");
const { normalizeSlackText, parseCodexTask } = require("./task-parser");
const { buildContext } = require("./context-builder");
const { resolveCodexExecutable } = require("./codex-discovery");
const { buildCompletionSummary, buildHeartbeatText, createExecutionHeartbeat } = require("./execution-heartbeat");

// ============================================================
// Agent Relay V5.5
//
// Slack CODEX_TASK
//   ↓
// auth / normalize / parse / route / dedup
//   ↓
// single-task queue
//   ↓
// CODEX_STATUS START
//   ↓
// Real Codex Worker
//   ↓
// Codex JSONL parser
//   ↓
// CODEX_STATUS DONE / BLOCKED / FAILED
//
// V5.5:
// - Default sandbox is workspace-write.
// - DONE only returns useful Codex agent output.
// - WebSocket reconnect / HTTP fallback noise is NOT included
//   in successful Slack summaries.
// - Diagnostic stderr is retained for FAILED / BLOCKED only.
// - Local terminal shows concise, human-readable Codex progress.
// - AGENT_RELAY_LOG_LEVEL=debug also shows redacted raw Codex events locally.
// - Tasks are serialized: only one Codex lifecycle executes at a time.
//
// SECURITY BOUNDARIES:
// - Slack never controls cwd, executable, shell, or CLI options.
// - Repo path is resolved only from PROJECTS allowlist.
// - shell:false; prompt is delivered over stdin.
// - No deploy / publish / push / remote modification, except explicit Slack evidence artifacts.
// - No sandbox bypass or danger-full-access.
// ============================================================


// Load an optional, local-only .env file before reading configuration. Values
// already provided by the process environment always take precedence.
function loadLocalEnvFile() {
  const envFile = path.join(__dirname, ".env");

  if (!fs.existsSync(envFile)) {
    return;
  }

  const lines = fs.readFileSync(envFile, "utf8").split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

    if (!match) {
      throw new Error(`Invalid .env entry on line ${index + 1}`);
    }

    const [, key, rawValue] = match;
    let value = rawValue.trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadLocalEnvFile();


function requireConfig(name) {
  const value = String(process.env[name] || "").trim();

  if (!value) {
    throw new Error(`Missing required configuration: ${name}`);
  }

  return value;
}


function requireWorkerId() {
  const value = requireConfig("AGENT_RELAY_WORKER_ID");

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
    throw new Error(
      "Invalid AGENT_RELAY_WORKER_ID: use 1-64 letters, numbers, dots, underscores, or hyphens"
    );
  }

  return value;
}


function requireSlackToken(name, prefix) {
  const value = requireConfig(name);

  if (!new RegExp(`^${prefix}-[A-Za-z0-9-]+$`).test(value)) {
    throw new Error(`Invalid ${name}: expected a ${prefix}- token`);
  }

  return value;
}


function requireSlackId(name) {
  const value = requireConfig(name);

  if (!/^[A-Z][A-Z0-9]+$/.test(value)) {
    throw new Error(`Invalid ${name}: expected a Slack identifier`);
  }

  return value;
}


function requireLocalPath(name) {
  const value = requireConfig(name);

  if (!path.isAbsolute(value)) {
    throw new Error(`Invalid ${name}: expected an absolute local path`);
  }

  return path.resolve(value);
}


// ------------------------------------------------------------
// Slack configuration
// ------------------------------------------------------------

const SLACK_BOT_TOKEN = requireSlackToken("SLACK_BOT_TOKEN", "xoxb");
const SLACK_APP_TOKEN = requireSlackToken("SLACK_APP_TOKEN", "xapp");


// ------------------------------------------------------------
// Worker identity
// ------------------------------------------------------------

const WORKER_ID = requireWorkerId();


// ------------------------------------------------------------
// Authorized Slack identities
// ------------------------------------------------------------

const ALLOWED_USER_ID = requireSlackId("AGENT_RELAY_ALLOWED_USER_ID");

// ChatGPT delegated Slack message app_id
const CHATGPT_APP_ID = requireSlackId("AGENT_RELAY_CHATGPT_APP_ID");

const CHANNEL_ID = requireSlackId("AGENT_RELAY_CHANNEL_ID");
const ATELIER_OF_MEMORY_PATH = requireLocalPath(
  "AGENT_RELAY_ATELIER_OF_MEMORY_PATH"
);
const RELAY_PATH = requireLocalPath("AGENT_RELAY_PATH");

const BROWSER_EVIDENCE_ENABLED = process.env.AGENT_RELAY_BROWSER_EVIDENCE_ENABLED === "true";
if (process.env.AGENT_RELAY_BROWSER_EVIDENCE_ENABLED !== undefined && !["true", "false"].includes(process.env.AGENT_RELAY_BROWSER_EVIDENCE_ENABLED)) {
  throw new Error("Invalid AGENT_RELAY_BROWSER_EVIDENCE_ENABLED: expected true or false");
}
const BROWSER_EVIDENCE_TIMEOUT_MS = Number(process.env.AGENT_RELAY_BROWSER_EVIDENCE_TIMEOUT_MS || 15_000);
if (!Number.isSafeInteger(BROWSER_EVIDENCE_TIMEOUT_MS) || BROWSER_EVIDENCE_TIMEOUT_MS < 1_000 || BROWSER_EVIDENCE_TIMEOUT_MS > 60_000) {
  throw new Error("Invalid AGENT_RELAY_BROWSER_EVIDENCE_TIMEOUT_MS: expected 1000-60000");
}
const BROWSER_ALLOWED_ORIGINS = String(process.env.AGENT_RELAY_BROWSER_ALLOWED_ORIGINS || "")
  .split(",").map((value) => value.trim()).filter(Boolean);
const BROWSER_EXECUTABLE_PATH = process.env.AGENT_RELAY_BROWSER_EXECUTABLE_PATH
  ? resolveBrowserExecutablePath(requireLocalPath("AGENT_RELAY_BROWSER_EXECUTABLE_PATH"))
  : "";
const BROWSER_CALLBACK_URL = process.env.AGENT_RELAY_BROWSER_CALLBACK_URL
  ? validateRelayCallbackUrl(process.env.AGENT_RELAY_BROWSER_CALLBACK_URL)
  : "";

if (BROWSER_EVIDENCE_ENABLED) {
  if (BROWSER_ALLOWED_ORIGINS.length === 0) throw new Error("Missing required configuration: AGENT_RELAY_BROWSER_ALLOWED_ORIGINS");
  for (const origin of BROWSER_ALLOWED_ORIGINS) {
    const parsed = parseLoopbackUrl(origin);
    if (parsed.origin !== origin.replace(/\/$/, "")) throw new Error("Invalid AGENT_RELAY_BROWSER_ALLOWED_ORIGINS: use origins only");
  }
}


// ------------------------------------------------------------
// Project registry
//
// Slack is NEVER allowed to supply an arbitrary local path.
// target_repo is resolved only through this allowlist.
// ------------------------------------------------------------

const PROJECTS = {
  [CHANNEL_ID]: {
    project_id: "baiyuan",
    workspace_id: "baiyuan",

    repos: {
      "atelier-of-memory": {
        local_path: ATELIER_OF_MEMORY_PATH,
      },
      "agent-relay": {
        local_path: RELAY_PATH,
      },
    },
  },
};


// ------------------------------------------------------------
// Codex configuration
// ------------------------------------------------------------

// V5.2 default.
//
// We now allow writes INSIDE the configured repository workspace.
// The allowlist + Codex sandbox remain the authority boundary.
const CODEX_SANDBOX_MODE =
  process.env.CODEX_SANDBOX_MODE || "workspace-write";

const ALLOWED_CODEX_SANDBOX_MODES = new Set([
  "read-only",
  "workspace-write",
]);

if (!ALLOWED_CODEX_SANDBOX_MODES.has(CODEX_SANDBOX_MODE)) {
  throw new Error(
    `Unsafe/unsupported CODEX_SANDBOX_MODE: ${CODEX_SANDBOX_MODE}`
  );
}


// Codex Doctor verified this backend as healthy on supported Windows workers.
const CODEX_WINDOWS_SANDBOX = "unelevated";


// One task maximum runtime.
const CODEX_TIMEOUT_MS = Number(
  process.env.CODEX_TIMEOUT_MS || 10 * 60 * 1000
);

if (!Number.isSafeInteger(CODEX_TIMEOUT_MS) || CODEX_TIMEOUT_MS <= 0) {
  throw new Error(
    "Invalid CODEX_TIMEOUT_MS: expected a positive whole number of milliseconds"
  );
}


// Maximum captured process output retained in memory.
const MAX_CAPTURE_CHARS = 250_000;


// Slack summary limit.
const MAX_SLACK_SUMMARY_CHARS = 3000;


// Local Codex observability is intentionally terminal-only. Slack continues to
// receive lifecycle statuses only, never intermediate progress events.
const ALLOWED_AGENT_RELAY_LOG_LEVELS = new Set([
  "normal",
  "debug",
]);

const AGENT_RELAY_LOG_LEVEL =
  process.env.AGENT_RELAY_LOG_LEVEL === undefined
    ? "normal"
    : String(process.env.AGENT_RELAY_LOG_LEVEL).trim().toLowerCase();

if (!ALLOWED_AGENT_RELAY_LOG_LEVELS.has(AGENT_RELAY_LOG_LEVEL)) {
  throw new Error(
    `Unsafe/unsupported AGENT_RELAY_LOG_LEVEL: ${process.env.AGENT_RELAY_LOG_LEVEL}`
  );
}

const DEBUG_CODEX_JSON =
  AGENT_RELAY_LOG_LEVEL === "debug";

const MAX_PROGRESS_CHARS = 360;


// ------------------------------------------------------------
// Codex executable
//
// We deliberately invoke the native codex.exe directly.
//
// NO:
//   shell: true
//   cmd.exe /c
//   powershell -Command
//
// Slack task content must never pass through a shell parser.
// ------------------------------------------------------------

const CODEX_BIN = resolveCodexExecutable({ configuredPath: process.env.CODEX_BIN });


// ------------------------------------------------------------
// Persistent dedup
// ------------------------------------------------------------

const STATE_DIR = path.join(__dirname, "state");

const SEEN_TASKS_FILE = path.join(
  STATE_DIR,
  "seen-tasks.json"
);

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, {
    recursive: true,
  });
}

function loadSeenTasks() {
  ensureStateDir();

  if (!fs.existsSync(SEEN_TASKS_FILE)) {
    return new Set();
  }

  try {
    const raw = fs.readFileSync(
      SEEN_TASKS_FILE,
      "utf8"
    );

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return new Set();
    }

    return new Set(parsed);
  } catch (error) {
    console.error(
      "⚠ Failed to load seen-tasks.json:",
      error.message
    );

    return new Set();
  }
}

function persistSeenTasks(seenTasks) {
  ensureStateDir();

  const tempFile =
    `${SEEN_TASKS_FILE}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(
      Array.from(seenTasks),
      null,
      2
    ),
    "utf8"
  );

  fs.renameSync(
    tempFile,
    SEEN_TASKS_FILE
  );
}

const seenTasks = loadSeenTasks();


// ------------------------------------------------------------
// Single-task execution queue
//
// Slack events may arrive concurrently.
// V5.2 serializes Codex lifecycles so two write-capable tasks never
// operate on the same worker at the same time.
// ------------------------------------------------------------

let taskQueueTail = Promise.resolve();
let queuedTaskCount = 0;

function enqueueTask(taskId, fn) {
  queuedTaskCount += 1;

  console.log(
    `[QUEUE] task_id=${taskId} waiting=${queuedTaskCount}`
  );

  const run = taskQueueTail.then(
    async () => {
      queuedTaskCount -= 1;

      console.log(
        `[DEQUEUE] task_id=${taskId} remaining=${queuedTaskCount}`
      );

      return fn();
    },
    async () => {
      queuedTaskCount -= 1;

      console.log(
        `[DEQUEUE] task_id=${taskId} remaining=${queuedTaskCount}`
      );

      return fn();
    }
  );

  taskQueueTail = run.catch(() => {});

  return run;
}


// ------------------------------------------------------------
// Slack app
// ------------------------------------------------------------

const app = new App({
  token: SLACK_BOT_TOKEN,
  appToken: SLACK_APP_TOKEN,
  socketMode: true,
});


// ------------------------------------------------------------
// Generic utilities
// ------------------------------------------------------------

function clampText(text, maxChars) {
  const value = String(text || "");

  if (value.length <= maxChars) {
    return value;
  }

  return (
    value.slice(0, maxChars) +
    "\n…[truncated]"
  );
}

function appendCaptured(current, chunk) {
  const next =
    current + String(chunk || "");

  if (
    next.length <=
    MAX_CAPTURE_CHARS
  ) {
    return next;
  }

  return next.slice(
    next.length -
      MAX_CAPTURE_CHARS
  );
}


// ------------------------------------------------------------
// Source authentication
// ------------------------------------------------------------

function classifySource(message) {
  const isFromChatGPT =
    message.user === ALLOWED_USER_ID &&
    message.app_id === CHATGPT_APP_ID;

  const isFromAllowedUser =
    message.user === ALLOWED_USER_ID &&
    !message.app_id;

  if (isFromChatGPT) {
    return "chatgpt";
  }

  if (isFromAllowedUser) {
    return "allowed-user";
  }

  return null;
}


// ------------------------------------------------------------
// Routing
//
// Route validation MUST happen before dedup.
// ------------------------------------------------------------

function resolveRoute(
  channelId,
  task
) {
  const project =
    PROJECTS[channelId];

  if (!project) {
    throw new Error(
      "channel_not_configured"
    );
  }

  if (
    task.target_worker !==
    WORKER_ID
  ) {
    throw new Error(
      "worker_mismatch"
    );
  }

  if (
    task.target_workspace !==
    project.workspace_id
  ) {
    throw new Error(
      "workspace_mismatch"
    );
  }

  const repo =
    project.repos[
      task.target_repo
    ];

  if (!repo) {
    throw new Error(
      "repo_not_allowed"
    );
  }

  const resolvedPath =
    path.resolve(
      repo.local_path
    );

  return {
    project_id:
      project.project_id,

    workspace_id:
      project.workspace_id,

    repo_id:
      task.target_repo,

    local_path:
      resolvedPath,
  };
}


// ------------------------------------------------------------
// Slack CODEX_STATUS
// ------------------------------------------------------------

function buildStatusText({
  status,
  task,
  route,
  summary,
}) {
  const lines = [
    "CODEX_STATUS",
    "schema_version: 1",
    `task_id: ${task.task_id}`,
    `status: ${status}`,
    `worker: ${WORKER_ID}`,
    `workspace: ${route.workspace_id}`,
    `repo: ${route.repo_id}`,
  ];

  if (summary) {
    lines.push(
      "summary: |"
    );

    const safeSummary =
      clampText(
        summary,
        MAX_SLACK_SUMMARY_CHARS
      );

    for (
      const line of safeSummary.split(
        /\r?\n/
      )
    ) {
      lines.push(
        `  ${line}`
      );
    }
  }

  return lines.join("\n");
}

async function sendStatus({
  channelId,
  status,
  task,
  route,
  summary,
}) {
  const text =
    buildStatusText({
      status,
      task,
      route,
      summary,
    });

  const result =
    await app.client.chat.postMessage({
      channel: channelId,
      text,
    });

  console.log(
    `[STATUS] task_id=${task.task_id} CODEX_STATUS ${status} sent`
  );

  console.log(
    `task_id=${task.task_id} status_ts=${result.ts}`
  );

  return result;
}

async function sendHeartbeat({ channelId, task, execution }) {
  await app.client.chat.postMessage({
    channel: channelId,
    text: buildHeartbeatText({
      taskId: task.task_id,
      workerId: WORKER_ID,
      elapsedMs: execution.elapsed_ms,
    }),
  });
  console.log(`[HEARTBEAT] task_id=${task.task_id} status=RUNNING elapsed_ms=${execution.elapsed_ms}`);
}

function postBrowserCallback({ taskId, status, endpoint = BROWSER_CALLBACK_URL, requestFn = http.request }) {
  if (!endpoint) return Promise.resolve({ skipped: true });
  const target = new URL(endpoint);
  const body = JSON.stringify({ task_id: taskId, status });
  return new Promise((resolve, reject) => {
    const request = requestFn({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 80,
      path: target.pathname,
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      timeout: 5000,
    }, (response) => {
      response.resume();
      response.on("end", () => {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve({ delivered: true });
        else reject(new Error(`browser_callback_http_${response.statusCode}`));
      });
    });
    request.once("timeout", () => request.destroy(new Error("browser_callback_timeout")));
    request.once("error", reject);
    request.end(body);
  });
}

async function notifyBrowserCallback({ task, status }) {
  if (!BROWSER_CALLBACK_URL) return;
  try {
    await postBrowserCallback({ taskId: task.task_id, status });
    console.log(`[CALLBACK] task_id=${task.task_id} status=${status} delivered`);
  } catch (error) {
    // Slack CODEX_STATUS has already been delivered and remains the sole lifecycle record.
    console.error(`[CALLBACK] task_id=${task.task_id} status=${status} not delivered: ${error.message}`);
  }
}

async function uploadBrowserEvidence({ channelId, task, evidence }) {
  const metadata = [
    "Agent Relay browser evidence artifact",
    `task_id: ${task.task_id}`,
    `url: ${evidence.url}`,
    `viewport: ${evidence.viewport.name} (${evidence.viewport.width}x${evidence.viewport.height})`,
    `console_error_count: ${evidence.consoleErrorCount}`,
  ].join("\n");

  const result = await app.client.files.uploadV2({
    channel_id: channelId,
    file: evidence.screenshotPath,
    filename: evidence.filename,
    title: `Browser evidence ${task.task_id} ${evidence.viewport.name}`,
    initial_comment: metadata,
  });
  const fileId = result?.files?.[0]?.id || result?.file?.id || "unavailable";
  console.log(`[EVIDENCE] task_id=${task.task_id} uploaded filename=${evidence.filename} file_id=${fileId}`);
  return fileId;
}

async function runBrowserEvidence({ channelId, task, route }) {
  if (!task.browser_evidence) return null;
  if (!BROWSER_EVIDENCE_ENABLED) throw new Error("browser_evidence_disabled_by_local_configuration");

  // This runs in the long-lived Relay listener after the Codex child has
  // closed and executeCodexTask() has resolved. Do not move it into the
  // worker prompt or the child process: Playwright must never inherit the
  // Codex execution sandbox.
  console.log(`[EVIDENCE] task_id=${task.task_id} host_pid=${process.pid} Relay host capture starting`);
  const evidence = await captureBrowserEvidence({
    taskId: task.task_id,
    route,
    request: task.browser_evidence,
    config: {
      allowedOrigins: BROWSER_ALLOWED_ORIGINS,
      executablePath: BROWSER_EXECUTABLE_PATH || undefined,
      timeoutMs: BROWSER_EVIDENCE_TIMEOUT_MS,
    },
  });
  const fileId = await uploadBrowserEvidence({ channelId, task, evidence });
  const errors = evidence.consoleErrors.length
    ? ` Console errors (bounded): ${evidence.consoleErrors.join(" | ")}`
    : "";
  return `Browser evidence uploaded: ${evidence.filename} (file_id: ${fileId}; ${evidence.viewport.name} ${evidence.viewport.width}x${evidence.viewport.height}; ${evidence.url}; console errors: ${evidence.consoleErrorCount}).${errors}`;
}


// ------------------------------------------------------------
// Codex JSON helpers
// ------------------------------------------------------------

function tryParseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}


// ------------------------------------------------------------
// Local Codex progress
//
// These messages are derived only from events Codex actually emits. They are
// deliberately not sent through sendStatus(), which keeps Slack lifecycle-only.
// ------------------------------------------------------------

function redactProgressText(value) {
  return String(value || "")
    .replace(/\bxox[abprs]-[A-Za-z0-9-]+\b/gi, "[REDACTED_SLACK_TOKEN]")
    .replace(/\b(xapp|xoxb|xoxp|xoxa)-[^\s"']+/gi, "[REDACTED_SLACK_TOKEN]")
    .replace(
      /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY)[A-Z0-9_]*)\s*([:=])\s*([^\s,}\]]+)/g,
      "$1$2[REDACTED]"
    )
    // Environment-file output can contain arbitrary credentials. Keep the
    // event observable without exposing its contents.
    .replace(
      /(^|\n|\\n)\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*.*?(?=\n|\\n|"|$)/g,
      "$1[REDACTED_ENV_VALUE]"
    );
}

function formatProgressText(value) {
  const normalized = redactProgressText(value)
    .replace(/\s+/g, " ")
    .trim();

  return normalized
    ? clampText(normalized, MAX_PROGRESS_CHARS)
    : "";
}

function progressItemText(event) {
  const item = event?.item;

  if (!item || typeof item !== "object") {
    const eventType = String(event?.type || "").toLowerCase();

    if (eventType === "turn.started") {
      return "Codex turn started";
    }

    if (eventType === "turn.completed") {
      return "Codex turn completed";
    }

    return "";
  }

  const itemType = String(item.type || "").toLowerCase();
  const eventType = String(event.type || "").toLowerCase();
  const isStarted = eventType.endsWith(".started");

  if (itemType === "command_execution" || itemType === "command") {
    const command = formatProgressText(item.command || item.input || "");

    if (isStarted) {
      return command ? `Running: ${command}` : "Running command";
    }

    const exitCode = item.exit_code ?? item.exitCode;
    return exitCode === undefined || exitCode === null
      ? "Command completed"
      : `Command completed (exit_code=${exitCode})`;
  }

  if (itemType === "file_change" || itemType === "file_changes") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const paths = changes
      .map((change) => formatProgressText(change?.path || change?.file || ""))
      .filter(Boolean)
      .slice(0, 4);
    const suffix = paths.length > 0 ? `: ${paths.join(", ")}` : "";
    return `Editing files (${changes.length || "unknown"})${suffix}`;
  }

  if (itemType === "reasoning") {
    const text = formatProgressText(item.text || item.summary || "");
    return text ? `Reasoning: ${text}` : "Reasoning step completed";
  }

  if (
    itemType === "agent_message" ||
    itemType === "assistant_message" ||
    itemType === "message"
  ) {
    const text = formatProgressText(extractAgentMessage(event));
    return text ? `Agent: ${text}` : "Agent message";
  }

  if (itemType === "web_search" || itemType === "web_search_call") {
    const query = formatProgressText(item.query || item.input || "");
    return query ? `Searching: ${query}` : "Searching";
  }

  return "";
}

function printCodexProgress(taskId, event) {
  const progress = progressItemText(event);

  if (progress) {
    console.log(`[PROGRESS] task_id=${taskId} ${progress}`);
  }
}

function debugCodexEvent(event) {
  // Raw events are for local diagnosis only, but still redact token-shaped and
  // environment-assignment values before they reach the terminal.
  console.log(
    "CODEX_JSON:",
    redactProgressText(JSON.stringify(event))
  );
}


// ------------------------------------------------------------
// V5.1:
// Extract actual agent answer.
//
// We intentionally prefer completed Codex agent-message items.
//
// This prevents connection diagnostics such as:
//
// Reconnecting...
// 403 Forbidden
// Falling back from WebSockets...
//
// from becoming a successful Slack DONE summary.
// ------------------------------------------------------------

function extractAgentMessage(event) {
  if (
    !event ||
    typeof event !== "object"
  ) {
    return null;
  }

  const item =
    event.item;

  if (
    item &&
    typeof item === "object"
  ) {
    const itemType =
      String(
        item.type || ""
      ).toLowerCase();

    const likelyAgentMessage =
      itemType === "agent_message" ||
      itemType === "assistant_message" ||
      itemType === "message";

    if (likelyAgentMessage) {
      const candidates = [
        item.text,
        item.message,
        item.output_text,
      ];

      for (
        const value of candidates
      ) {
        if (
          typeof value === "string" &&
          value.trim()
        ) {
          return value.trim();
        }
      }

      if (
        Array.isArray(item.content)
      ) {
        const contentTexts =
          item.content
            .map((part) => {
              if (
                typeof part === "string"
              ) {
                return part;
              }

              if (
                !part ||
                typeof part !== "object"
              ) {
                return "";
              }

              return (
                part.text ||
                part.output_text ||
                ""
              );
            })
            .filter(Boolean);

        if (
          contentTexts.length > 0
        ) {
          return contentTexts
            .join("\n")
            .trim();
        }
      }
    }
  }

  // Defensive fallback for possible future/alternate JSONL shapes.
  const eventType =
    String(
      event.type || ""
    ).toLowerCase();

  const agentishEvent =
    eventType.includes("agent") ||
    eventType.includes("assistant");

  if (agentishEvent) {
    const candidates = [
      event.text,
      event.message,
      event.output_text,
    ];

    for (
      const value of candidates
    ) {
      if (
        typeof value === "string" &&
        value.trim()
      ) {
        return value.trim();
      }
    }
  }

  return null;
}


// ------------------------------------------------------------
// Extract general useful diagnostics.
//
// Used for FAILED / BLOCKED,
// NOT for successful DONE response.
// ------------------------------------------------------------

function extractDiagnosticText(event) {
  if (
    !event ||
    typeof event !== "object"
  ) {
    return null;
  }

  const candidates = [
    event.error?.message,
    event.message,
    event.text,
    event.output_text,
    event.item?.error?.message,
  ];

  for (
    const value of candidates
  ) {
    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  return null;
}


// ------------------------------------------------------------
// Remove transport-only noise from user-facing diagnostics.
//
// We retain meaningful errors but remove repetitive reconnect
// spam and HTML fragments.
// ------------------------------------------------------------

function sanitizeDiagnosticText(text) {
  if (!text) {
    return "";
  }

  const lines =
    String(text)
      .split(/\r?\n/);

  const cleaned = [];

  let insideHtml = false;

  for (
    const rawLine of lines
  ) {
    const line =
      rawLine.trim();

    if (!line) {
      continue;
    }

    const lower =
      line.toLowerCase();

    if (
      lower.startsWith(
        "reconnecting..."
      )
    ) {
      continue;
    }

    if (
      lower.startsWith(
        "falling back from websockets"
      )
    ) {
      continue;
    }

    if (
      lower === "<html>" ||
      lower.startsWith("<html ")
    ) {
      insideHtml = true;
      continue;
    }

    if (
      lower === "</html>"
    ) {
      insideHtml = false;
      continue;
    }

    if (insideHtml) {
      continue;
    }

    if (
      lower.startsWith("<head") ||
      lower.startsWith("</head") ||
      lower.startsWith("<style") ||
      lower.startsWith("</style") ||
      lower.startsWith("<body") ||
      lower.startsWith("</body")
    ) {
      continue;
    }

    cleaned.push(rawLine);
  }

  return cleaned
    .join("\n")
    .trim();
}


// ------------------------------------------------------------
// Decide whether a failed Codex run is really BLOCKED.
//
// Keep conservative:
// a non-zero exit only becomes BLOCKED when there is clear
// permission/sandbox/approval evidence.
// ------------------------------------------------------------

function looksLikeApprovalBlock(text) {
  const value =
    String(text || "")
      .toLowerCase();

  const markers = [
    "requires approval",
    "request approval",
    "approval required",
    "permission denied",
    "not permitted",
    "operation not permitted",
    "sandbox denied",
    "sandbox restriction",
    "read-only filesystem",
    "read only filesystem",
    "readonly filesystem",
    "write access is not allowed",
    "requires permission",
  ];

  return markers.some(
    (marker) =>
      value.includes(marker)
  );
}


// ------------------------------------------------------------
// Real Codex Worker
// ------------------------------------------------------------

async function executeCodexTask({
  task,
  route,
}) {
  if (
    process.platform === "win32" &&
    !fs.existsSync(CODEX_BIN)
  ) {
    throw new Error(
      `Codex native executable not found: ${CODEX_BIN}`
    );
  }

  if (
    !fs.existsSync(
      route.local_path
    )
  ) {
    throw new Error(
      `Repo path does not exist: ${route.local_path}`
    );
  }

  // IMPORTANT:
  //
  // Slack instruction is NOT a CLI argument.
  //
  // Final "-" means:
  // Codex reads prompt from stdin.
  //
  // Therefore task text cannot become shell syntax.
  const args = [
    "-c",
    `windows.sandbox="${CODEX_WINDOWS_SANDBOX}"`,

    "--ask-for-approval",
    "on-request",

    "exec",

    "--sandbox",
    CODEX_SANDBOX_MODE,

    "--ephemeral",

    "--json",

    "--cd",
    route.local_path,

    "-",
  ];

  console.log("");
  console.log(
    `[WORKER] task_id=${task.task_id} Codex Worker starting`
  );

  console.log(
    `repo: ${route.repo_id}`
  );

  console.log(
    `cwd: ${route.local_path}`
  );

  console.log(
    `sandbox: ${CODEX_SANDBOX_MODE}`
  );

  console.log(
    `windows_sandbox: ${CODEX_WINDOWS_SANDBOX}`
  );

  console.log(
    `codex_bin: ${CODEX_BIN}`
  );

  return new Promise(
    (resolve, reject) => {
      const child =
        spawn(
          CODEX_BIN,
          args,
          {
            cwd:
              route.local_path,

            shell: false,

            windowsHide: true,

            stdio: [
              "pipe",
              "pipe",
              "pipe",
            ],

            env: {
              ...process.env,
            },
          }
        );

      let stdoutRaw = "";
      let stderrRaw = "";

      let stdoutBuffer = "";

      const agentMessages = [];

      const diagnostics = [];

      let timedOut = false;

      const timeout =
        setTimeout(
          () => {
            timedOut = true;

            console.error(
              `⏱️ Codex timeout after ${CODEX_TIMEOUT_MS}ms`
            );

            child.kill();
          },
          CODEX_TIMEOUT_MS
        );


      // ------------------------------------------------------
      // stdout: Codex JSONL
      // ------------------------------------------------------

      child.stdout.on(
        "data",
        (chunk) => {
          const text =
            chunk.toString(
              "utf8"
            );

          stdoutRaw =
            appendCaptured(
              stdoutRaw,
              text
            );

          stdoutBuffer += text;

          const lines =
            stdoutBuffer.split(
              /\r?\n/
            );

          stdoutBuffer =
            lines.pop() || "";

          for (
            const line of lines
          ) {
            if (!line.trim()) {
              continue;
            }

            const event =
              tryParseJsonLine(
                line
              );

            if (!event) {
              if (DEBUG_CODEX_JSON) {
                console.log(
                  "CODEX_STDOUT:",
                  redactProgressText(line)
                );
              }

              continue;
            }

            printCodexProgress(task.task_id, event);

            if (DEBUG_CODEX_JSON) {
              debugCodexEvent(event);
            }

            const agentText =
              extractAgentMessage(
                event
              );

            if (agentText) {
              agentMessages.push(
                agentText
              );
            }

            const diagnostic =
              extractDiagnosticText(
                event
              );

            if (diagnostic) {
              diagnostics.push(
                diagnostic
              );
            }
          }
        }
      );


      // ------------------------------------------------------
      // stderr:
      //
      // Keep locally for diagnosis.
      //
      // V5.1 IMPORTANT:
      // stderr is NOT automatically included in DONE summary.
      // ------------------------------------------------------

      child.stderr.on(
        "data",
        (chunk) => {
          const text =
            chunk.toString(
              "utf8"
            );

          stderrRaw =
            appendCaptured(
              stderrRaw,
              text
            );

          if (DEBUG_CODEX_JSON) {
            process.stderr.write(
              redactProgressText(text)
            );
          }
        }
      );


      child.on(
        "error",
        (error) => {
          clearTimeout(
            timeout
          );

          reject(error);
        }
      );


      child.on(
        "close",
        (code, signal) => {
          clearTimeout(
            timeout
          );


          // Flush final partial JSONL line.
          if (
            stdoutBuffer.trim()
          ) {
            const event =
              tryParseJsonLine(
                stdoutBuffer
              );

            if (event) {
              printCodexProgress(task.task_id, event);

              if (DEBUG_CODEX_JSON) {
                debugCodexEvent(event);
              }

              const agentText =
                extractAgentMessage(
                  event
                );

              if (agentText) {
                agentMessages.push(
                  agentText
                );
              }

              const diagnostic =
                extractDiagnosticText(
                  event
                );

              if (diagnostic) {
                diagnostics.push(
                  diagnostic
                );
              }
            }
          }


          // --------------------------------------------------
          // Timeout
          // --------------------------------------------------

          if (timedOut) {
            resolve({
              status:
                "FAILED",

              summary:
                `Codex Worker exceeded the configured timeout of ${CODEX_TIMEOUT_MS} ms and was terminated.`,
            });

            return;
          }


          // --------------------------------------------------
          // Success
          //
          // V5.1:
          // ONLY return agent response.
          // Never append stderr transport noise.
          // --------------------------------------------------

          if (code === 0) {
            let summary =
              agentMessages
                .filter(Boolean)
                .at(-1);

            if (!summary) {
              summary =
                `Codex completed successfully in ${CODEX_SANDBOX_MODE} sandbox.`;
            }

            resolve({
              status:
                "DONE",

              summary,
            });

            return;
          }


          // --------------------------------------------------
          // Failure diagnostics
          // --------------------------------------------------

          const diagnosticCombined =
            [
              ...diagnostics,
              stderrRaw,
            ]
              .filter(Boolean)
              .join("\n");

          const cleanedDiagnostic =
            sanitizeDiagnosticText(
              diagnosticCombined
            );

          const blocked =
            looksLikeApprovalBlock(
              cleanedDiagnostic
            );


          // --------------------------------------------------
          // BLOCKED
          // --------------------------------------------------

          if (blocked) {
            resolve({
              status:
                "BLOCKED",

              summary:
                cleanedDiagnostic ||
                `Codex could not continue because the requested operation is outside the ${CODEX_SANDBOX_MODE} sandbox.`,
            });

            return;
          }


          // --------------------------------------------------
          // FAILED
          // --------------------------------------------------

          resolve({
            status:
              "FAILED",

            summary:
              cleanedDiagnostic ||
              `Codex exited with code ${code}${
                signal
                  ? ` and signal ${signal}`
                  : ""
              }.`,
          });
        }
      );


      // ------------------------------------------------------
      // Worker prompt
      // ------------------------------------------------------

      const context = buildContext({
        task,
        route: {
          ...route,
          sandboxMode: CODEX_SANDBOX_MODE,
        },
        repoRoot: route.local_path,
      });
      const workerPrompt = context.prompt;
      // Browser evidence is executed only by the Relay host after this Codex process exits DONE.
      // Do not launch a browser, capture screenshots, or upload artifacts yourself.
      const telemetry = context.telemetry;
      console.log(`[CONTEXT] task_chars=${telemetry.taskChars} mandatory_chars=${telemetry.mandatoryChars} repo_chars=${telemetry.repoChars} capability_chars=${telemetry.capabilityChars} final_prompt_chars=${telemetry.finalPromptChars} fragments=${telemetry.selectedFragments.join(",") || "none"}`);


      // ------------------------------------------------------
      // Feed prompt through stdin.
      // ------------------------------------------------------

      child.stdin.write(
        workerPrompt,
        "utf8"
      );

      child.stdin.end();
    }
  );
}


// ------------------------------------------------------------
// Task lifecycle
// ------------------------------------------------------------

async function runTaskLifecycle({
  channelId,
  task,
  route,
}) {
  const execution = createExecutionHeartbeat({
    taskId: task.task_id,
    workerId: WORKER_ID,
    onHeartbeat: (current) => sendHeartbeat({ channelId, task, execution: current }),
    onError: (error) => console.error(`[HEARTBEAT] task_id=${task.task_id} status=RUNNING not sent: ${error.message}`),
  });

  try {
    await sendStatus({
      channelId,

      status:
        "START",

      task,
      route,

      summary:
        `Agent Relay accepted the task. Codex Worker is starting in ${CODEX_SANDBOX_MODE} sandbox.`,
    });

    const executionContext = execution.start();
    console.log(`[LIFECYCLE] task_id=${executionContext.task_id} worker_id=${executionContext.worker_id} started_at=${executionContext.started_at} status=${executionContext.current_status}`);


    const result =
      await executeCodexTask({
        task,
        route,
      });

    if (task.browser_evidence && result.status === "DONE") {
      try {
        const evidenceSummary = await runBrowserEvidence({ channelId, task, route });
        result.summary = `${result.summary}\n\n${evidenceSummary}`;
      } catch (error) {
        result.status = isSlackFilesScopeError(error) ? "BLOCKED" : "FAILED";
        result.summary = isSlackFilesScopeError(error)
          ? "Browser evidence screenshot was captured locally but Slack artifact upload is blocked. The Slack Bot Token requires the files:write OAuth scope."
          : `Browser evidence failed: ${redactBrowserText(error.message)}`;
      }
    }

    const terminalExecution = execution.stop(result.status);
    result.summary = `${buildCompletionSummary({
      status: result.status,
      taskId: task.task_id,
      workerId: WORKER_ID,
      elapsedMs: terminalExecution.elapsed_ms,
    })}\n\n${result.summary}`;


    await sendStatus({
      channelId,

      status:
        result.status,

      task,
      route,

      summary:
        result.summary,
    });

    await notifyBrowserCallback({
      task,
      status: result.status,
    });


    console.log(
      `[LIFECYCLE] task_id=${task.task_id} finished=${result.status}`
    );

    console.log(
      "==============================="
    );
  } catch (error) {
    const terminalExecution = execution.stop("FAILED");
    console.error("");

    console.error(
      `[ERROR] task_id=${task.task_id} Task execution failed`
    );

    console.error(
      `error: ${error.message}`
    );


    try {
      await sendStatus({
        channelId,

        status:
          "FAILED",

        task,
        route,

      summary:
          `${buildCompletionSummary({
            status: "FAILED",
            taskId: task.task_id,
            workerId: WORKER_ID,
            elapsedMs: terminalExecution.elapsed_ms,
          })}\n\nAgent Relay Worker internal failure: ${error.message}`,
      });

      await notifyBrowserCallback({
        task,
        status: "FAILED",
      });
    } catch (
      statusError
    ) {
      console.error(
        `[ERROR] task_id=${task.task_id} Failed to send FAILED status:`,
        statusError.message
      );
    }


    console.log(
      "==============================="
    );
  }
}


// ------------------------------------------------------------
// Slack message handler
// ------------------------------------------------------------

app.event(
  "message",
  async ({ event }) => {
    const message = event;

    try {
      // Ignore Agent Relay's own status posts.
      if (message.bot_id) {
        return;
      }

      if (
        !message.text ||
        !message.channel
      ) {
        return;
      }


      // ------------------------------------------------------
      // Source authentication
      // ------------------------------------------------------

      const source =
        classifySource(
          message
        );

      if (!source) {
        return;
      }


      // ------------------------------------------------------
      // Only CODEX_TASK enters parser
      // ------------------------------------------------------

      const normalizedText =
        normalizeSlackText(
          message.text
        );

      if (
        !normalizedText.startsWith(
          "CODEX_TASK"
        )
      ) {
        return;
      }


      // ------------------------------------------------------
      // Parse
      // ------------------------------------------------------

      let task;

      try {
        task =
          parseCodexTask(
            normalizedText
          );
      } catch (error) {
        console.error(
          "[REJECT] malformed CODEX_TASK"
        );

        console.error(
          `reason: ${error.message}`
        );

        return;
      }


      // ------------------------------------------------------
      // Route validation
      // ------------------------------------------------------

      let route;

      try {
        route =
          resolveRoute(
            message.channel,
            task
          );
      } catch (error) {
        console.error(
          `[REJECT] task_id=${task.task_id} CODEX_TASK`
        );

        console.error(
          `reason: ${error.message}`
        );

        return;
      }


      // ------------------------------------------------------
      // Dedup AFTER successful routing
      // ------------------------------------------------------

      const dedupKey =
        `${message.channel}:${task.task_id}`;

      if (
        seenTasks.has(
          dedupKey
        )
      ) {
        console.log(
          `[DEDUP] ignored task_id=${task.task_id}`
        );

        return;
      }


      // Persist before lifecycle starts.
      seenTasks.add(
        dedupKey
      );

      persistSeenTasks(
        seenTasks
      );


      // ------------------------------------------------------
      // ACCEPT
      // ------------------------------------------------------

      console.log("");

      console.log(
        `[ACCEPT] task_id=${task.task_id} CODEX_TASK`
      );

      console.log(
        `source: ${source}`
      );

      console.log(
        `worker: ${WORKER_ID}`
      );

      console.log(
        `project: ${route.project_id}`
      );

      console.log(
        `workspace: ${route.workspace_id}`
      );

      console.log(
        `repo: ${route.repo_id}`
      );

      console.log(
        `local_path: ${route.local_path}`
      );

      console.log(
        `sandbox: ${CODEX_SANDBOX_MODE}`
      );

      console.log(
        "instruction:"
      );

      console.log(
        task.instruction
      );

      console.log(
        "====================="
      );


      await enqueueTask(
        task.task_id,
        () =>
          runTaskLifecycle({
            channelId:
              message.channel,

            task,
            route,
          })
      );

    } catch (error) {
      console.error(
        "[ERROR] Unexpected listener error:",
        error
      );
    }
  }
);


// ------------------------------------------------------------
// Startup validation
// ------------------------------------------------------------

function validateStartup() {
  console.log("");

  console.log(
    "[STARTUP] Agent Relay V5.5 startup checks"
  );

  console.log(
    `Worker ID: ${WORKER_ID}`
  );

  console.log(
    `Codex sandbox: ${CODEX_SANDBOX_MODE}`
  );

  console.log(`Browser evidence: ${BROWSER_EVIDENCE_ENABLED ? "enabled" : "disabled"}`);

  console.log(
    `Windows sandbox backend: ${CODEX_WINDOWS_SANDBOX}`
  );

  console.log(
    `Codex executable: ${CODEX_BIN}`
  );


  if (
    process.platform === "win32"
  ) {
    if (
      !fs.existsSync(
        CODEX_BIN
      )
    ) {
      throw new Error(
        `Codex executable not found: ${CODEX_BIN}`
      );
    }

    console.log("  [OK] Codex executable exists");
  }


  for (
    const [
      channelId,
      project,
    ] of Object.entries(
      PROJECTS
    )
  ) {
    console.log("");

    console.log(
      `Channel: ${channelId}`
    );

    console.log(
      `Project: ${project.project_id}`
    );


    for (
      const [
        repoId,
        repo,
      ] of Object.entries(
        project.repos
      )
    ) {
      const localPath =
        path.resolve(
          repo.local_path
        );

      console.log(
        `  ${repoId}`
      );

      console.log(
        `  ${localPath}`
      );


      if (
        !fs.existsSync(
          localPath
        )
      ) {
        throw new Error(
          `Configured repo path does not exist: ${localPath}`
        );
      }

      // Keep Git's repository and ownership/trust checks intact. This does not
      // mark a directory safe or otherwise alter Git configuration.
      const gitCheck = spawnSync(
        "git",
        ["-C", localPath, "status", "--porcelain"],
        {
          encoding: "utf8",
          shell: false,
        }
      );

      if (gitCheck.error || gitCheck.status !== 0) {
        const detail = String(
          gitCheck.stderr || gitCheck.error?.message || "unknown Git error"
        ).trim();

        throw new Error(
          `Configured repo failed Git repository/trust check: ${localPath}${
            detail ? ` (${detail})` : ""
          }`
        );
      }

      console.log("  [OK] Git repository/trust check passed");
    }
  }
}


// ------------------------------------------------------------
// Start
// ------------------------------------------------------------

(async () => {
  validateStartup();

  await app.start();

  console.log("");

  console.log(
    "[READY] Agent Relay Task Listener V5.5 connected to Slack."
  );

  console.log(
    `Worker ID: ${WORKER_ID}`
  );

  console.log(
    `Codex sandbox: ${CODEX_SANDBOX_MODE}`
  );

  console.log(
    `Windows sandbox: ${CODEX_WINDOWS_SANDBOX}`
  );

  console.log(
    "Execution backend: Real Codex Worker"
  );

  console.log(
    "Status output: agent answer only on DONE"
  );

  console.log(
    `Local Codex logs: ${AGENT_RELAY_LOG_LEVEL} (terminal-only progress)`
  );

  console.log(
    "Execution queue: single task at a time"
  );

  console.log(
    "CODEX_STATUS: START / DONE / BLOCKED / FAILED"
  );

  console.log("");
})();
