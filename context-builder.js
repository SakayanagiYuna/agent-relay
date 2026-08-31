"use strict";

const fs = require("fs");
const path = require("path");

const MAX_REPO_GUIDANCE_CHARS = 1800;

const MANDATORY_GUIDANCE = [
  "You are executing an authorized Agent Relay CODEX_TASK.",
  "Work only inside the configured repository and do not expand task scope.",
  "Edit files only when the user instruction requires edits; never edit merely to prove workspace-write.",
  "Do not deploy, publish, push, upload, sync remote assets, modify remote services, or bypass sandbox/approval.",
  "Do not run git push, wrangler deploy, rclone sync/copy, or equivalent remote-write commands.",
  "Do not access secrets unless explicitly necessary and permitted; do not alter authentication or security settings.",
  "Do not alter Codex configuration or system security settings.",
  "If the task cannot be completed inside the sandbox, stop and explain the required permission.",
  "For write tasks, report changed files and verification; if none changed, say so.",
].join("\n");

const CAPABILITY_FRAGMENTS = Object.freeze({
  docs: {
    name: "docs",
    cues: /(^|[\\/ ])(?:docs?|readme|agents\.md)(?:[\\/. ]|$)|文档|说明|规范|documentation/i,
    text: "Documentation: keep authoritative explanatory prose in Simplified Chinese; preserve technical identifiers, commands, and code literals in English. Keep stable protocol names unchanged.",
  },
  doctor: {
    name: "doctor",
    cues: /(^|[\\/ ])doctor(?:\.js)?(?:[\\/. ]|$)|npm\s+run\s+doctor|诊断|就绪检查/i,
    text: "Doctor: keep checks local and read-only. It reports readiness and must not print secrets or modify .env, Git configuration, repository files, or remote services.",
  },
  browser: {
    name: "browser-evidence",
    cues: /browser[ -]?evidence|browser-evidence|screenshot|截图|浏览器证据/i,
    text: "Browser Evidence: Relay host-only post-Codex capture; use configured loopback origins and existing browser safety boundaries. The worker must not launch browsers, capture screenshots, or upload artifacts.",
  },
});

function getCapabilityFragment(name) {
  return Object.values(CAPABILITY_FRAGMENTS).find((fragment) => fragment.name === name);
}

function readRepositoryGuidance(repoRoot) {
  const guidancePath = path.join(repoRoot, "AGENTS.md");
  try {
    return fs.readFileSync(guidancePath, "utf8").trim().slice(0, MAX_REPO_GUIDANCE_CHARS);
  } catch {
    return "Agent Relay repository guidance is unavailable; follow the task and runtime controls.";
  }
}

function selectContextFragments(task) {
  const browserEvidence = task.browser_evidence && typeof task.browser_evidence === "object"
    ? [task.browser_evidence.mode, task.browser_evidence.url].filter(Boolean)
    : [];
  const haystack = [task.instruction, task.target_repo, task.target_workspace, ...browserEvidence]
    .filter(Boolean)
    .join("\n");
  return Object.values(CAPABILITY_FRAGMENTS)
    .filter((fragment) => fragment.cues.test(haystack))
    .map((fragment) => fragment.name);
}

function buildContext({ task, route, repoRoot = route.local_path }) {
  const selectedNames = selectContextFragments(task);
  const capabilityText = selectedNames
    .map((name) => getCapabilityFragment(name).text)
    .join("\n");
  const repoGuidance = readRepositoryGuidance(repoRoot);
  const taskInstruction = String(task.instruction);
  const sections = [
    MANDATORY_GUIDANCE,
    `Task ID: ${task.task_id}\nWorkspace: ${route.workspace_id}\nRepository: ${route.repo_id}\nWorking directory: ${route.local_path}\nSandbox mode: ${route.sandboxMode}`,
    `Repository guidance:\n${repoGuidance}`,
    capabilityText ? `Relevant capability guidance:\n${capabilityText}` : "",
    task.browser_evidence ? "Browser evidence is executed only by the Relay host after this Codex process exits DONE. Do not launch a browser, capture screenshots, or upload artifacts yourself." : "",
    `User instruction:\n${taskInstruction}`,
  ].filter(Boolean);
  const prompt = sections.join("\n\n");
  return {
    prompt,
    selectedFragments: selectedNames,
    telemetry: {
      taskChars: taskInstruction.length,
      mandatoryChars: MANDATORY_GUIDANCE.length,
      repoChars: repoGuidance.length,
      capabilityChars: capabilityText.length,
      finalPromptChars: prompt.length,
      selectedFragments: selectedNames,
    },
  };
}

module.exports = { buildContext, selectContextFragments, MANDATORY_GUIDANCE, CAPABILITY_FRAGMENTS };
