"use strict";

const fs = require("fs");
const path = require("path");

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const CONVERSATION_MODES = new Set(["continue", "new"]);

function workerSessionKey({ agent, workspaceId, repoId }) {
  return `${agent}:${workspaceId}:${repoId}`;
}

function isSessionId(value) {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

function extractWorkerSessionId(event) {
  if (!event || typeof event !== "object") return null;
  const candidates = [
    event.session_id,
    event.sessionId,
    event.thread_id,
    event.threadId,
    event.session?.id,
    event.thread?.id,
    event.payload?.session_id,
    event.data?.session_id,
    event.data?.sessionId,
  ];
  return candidates.find(isSessionId) || null;
}

function buildCodexExecArgs({ resumeSessionId, windowsSandbox, sandboxMode, repoPath }) {
  const args = [
    "-c",
    `windows.sandbox="${windowsSandbox}"`,
    "--ask-for-approval",
    "on-request",
    "exec",
    "--sandbox",
    sandboxMode,
    "--json",
    "--cd",
    repoPath,
  ];
  if (resumeSessionId) {
    if (!isSessionId(resumeSessionId)) throw new Error("worker_session_id_invalid");
    args.push("resume", resumeSessionId, "-");
  } else {
    args.push("-");
  }
  return args;
}

class WorkerSessionStore {
  constructor({ filePath, fsModule = fs } = {}) {
    if (!filePath) throw new Error("worker_session_store_path_required");
    this.filePath = filePath;
    this.fs = fsModule;
  }

  load() {
    if (!this.fs.existsSync(this.filePath)) return { schema_version: 1, sessions: {} };
    const parsed = JSON.parse(this.fs.readFileSync(this.filePath, "utf8"));
    if (!parsed || parsed.schema_version !== 1 || !parsed.sessions || typeof parsed.sessions !== "object") {
      throw new Error("worker_session_store_invalid");
    }
    return parsed;
  }

  get(key) {
    const record = this.load().sessions[key];
    if (!record || !isSessionId(record.session_id)) return null;
    return record;
  }

  put(key, record) {
    if (!isSessionId(record?.session_id)) throw new Error("worker_session_id_invalid");
    const store = this.load();
    store.sessions[key] = {
      agent: String(record.agent),
      workspace_id: String(record.workspace_id),
      repo_id: String(record.repo_id),
      session_id: record.session_id,
      last_task_id: record.last_task_id ? String(record.last_task_id) : null,
      updated_at: record.updated_at || new Date().toISOString(),
    };
    this.fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    this.fs.writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    this.fs.renameSync(temporary, this.filePath);
    return store.sessions[key];
  }

  clear(key) {
    const store = this.load();
    if (!store.sessions[key]) return null;
    delete store.sessions[key];
    this.fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    this.fs.writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    this.fs.renameSync(temporary, this.filePath);
    return true;
  }
}

function resolveResumeSessionId({ conversation, agent, workspaceId, repoId, store }) {
  if (conversation === "new") return null;
  return store.get(workerSessionKey({ agent, workspaceId, repoId }))?.session_id || null;
}

module.exports = {
  CONVERSATION_MODES,
  WorkerSessionStore,
  buildCodexExecArgs,
  extractWorkerSessionId,
  isSessionId,
  resolveResumeSessionId,
  workerSessionKey,
};
