"use strict";

const fs = require("fs");
const path = require("path");

function isUsableFile(candidate, fsModule = fs) {
  try {
    return fsModule.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function resolveGrokExecutable({ configuredPath, platform = process.platform, env = process.env, pathValue = env.PATH, fsModule = fs } = {}) {
  if (configuredPath) {
    const candidate = path.resolve(String(configuredPath).trim());
    if (!isUsableFile(candidate, fsModule)) throw new Error(`Configured AGENT_RELAY_GROK_BIN is not a usable executable file: ${candidate}`);
    return candidate;
  }
  const names = platform === "win32" ? ["grok.exe", "grok.cmd"] : ["grok"];
  const candidates = String(pathValue || "").split(path.delimiter).filter(Boolean)
    .flatMap((directory) => names.map((name) => path.join(directory, name)));
  const resolved = candidates.find((candidate) => isUsableFile(candidate, fsModule));
  if (!resolved) throw new Error("Grok Build executable not found. Set AGENT_RELAY_GROK_BIN or install grok on PATH.");
  return path.resolve(resolved);
}

module.exports = { resolveGrokExecutable };
