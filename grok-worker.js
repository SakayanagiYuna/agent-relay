"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { resolveWorkerOutcome } = require("./worker-outcome");
const { createUsageCollector, extractUsage } = require("./usage-accounting");

function extractGrokSummary(output) {
  const text = String(output || "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    const candidates = [parsed?.result, parsed?.response, parsed?.text, parsed?.message?.content, parsed?.message?.text, parsed?.content];
    const result = candidates.find((value) => typeof value === "string" && value.trim());
    return result ? result.trim() : text;
  } catch {
    return text;
  }
}

function extractGrokUsage(output) {
  try {
    const parsed = JSON.parse(String(output || ""));
    return extractUsage(parsed) || extractUsage(parsed?.result) || extractUsage(parsed?.response);
  } catch {
    return null;
  }
}

function createPromptFile(prompt) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-relay-grok-"));
  const filePath = path.join(directory, "prompt.txt");
  fs.writeFileSync(filePath, prompt, { encoding: "utf8", mode: 0o600 });
  return { directory, filePath };
}

function removePromptFile({ directory } = {}) {
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
}

function describeGrokActivity(event) {
  const type = String(event?.type || "").toLowerCase();
  if (type === "thought") return "reasoning";
  if (type === "text") return "responding";
  if (type === "usage") return "usage_reported";
  if (type === "end") return "turn_completed";
  if (/(tool|command|file|terminal)/.test(type)) return "tool_activity";
  return type || "activity";
}

function observeGrokStreamEvent({ event, usageCollector, textChunks, onProgress }) {
  if (!event || typeof event !== "object") return;
  usageCollector.observe(event);
  if (event.type === "text" && typeof event.data === "string") textChunks.push(event.data);
  if (event.type !== "available_commands") onProgress?.({ activity: describeGrokActivity(event), chars: typeof event.data === "string" ? event.data.length : 0 });
}

function executeGrokBuildTask({ task, route, executablePath, prompt, timeoutMs, sandbox = "workspace", onProgress }) {
  if (!fs.existsSync(route.local_path)) return Promise.reject(new Error(`Repo path does not exist: ${route.local_path}`));
  if (!fs.existsSync(executablePath)) return Promise.reject(new Error(`Grok Build executable not found: ${executablePath}`));
  const promptFile = createPromptFile(prompt);
  const args = ["--cwd", route.local_path, "--sandbox", sandbox, "--permission-mode", "acceptEdits", "--no-subagents", "--output-format", "streaming-json", "--prompt-file", promptFile.filePath];

  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, args, { cwd: route.local_path, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } });
    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    const textChunks = [];
    const usageCollector = createUsageCollector();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      stdoutBuffer += text;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        try { observeGrokStreamEvent({ event: JSON.parse(line), usageCollector, textChunks, onProgress }); } catch {}
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => { clearTimeout(timeout); removePromptFile(promptFile); reject(error); });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      removePromptFile(promptFile);
      if (stdoutBuffer.trim()) {
        try { observeGrokStreamEvent({ event: JSON.parse(stdoutBuffer), usageCollector, textChunks, onProgress }); } catch {}
      }
      const usage = usageCollector.usage() || extractGrokUsage(stdout);
      if (timedOut) return resolve({ status: "FAILED", summary: `Grok Build exceeded the configured timeout of ${timeoutMs} ms and was terminated.`, usage });
      const summary = textChunks.join("").trim() || extractGrokSummary(stdout) || String(stderr || "").trim();
      if (code === 0) return resolve({ status: resolveWorkerOutcome({ exitCode: code, summary }) || "DONE", summary: summary || `Grok Build completed successfully in ${sandbox} sandbox.`, usage });
      const blocked = /permission denied|not permitted|approval|required|sandbox|dontask/i.test(`${stdout}\n${stderr}`);
      return resolve({ status: blocked ? "BLOCKED" : "FAILED", summary: summary || `Grok Build exited with code ${code}${signal ? ` and signal ${signal}` : ""}.`, usage });
    });
  });
}

module.exports = { createPromptFile, describeGrokActivity, executeGrokBuildTask, extractGrokSummary, extractGrokUsage, observeGrokStreamEvent, removePromptFile };
