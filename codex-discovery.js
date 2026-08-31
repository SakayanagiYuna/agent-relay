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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function windowsCandidates(env, pathValue) {
  const names = ["codex.exe"];
  const pathCandidates = String(pathValue || "")
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((directory) => names.map((name) => path.join(directory, name)));

  const npmGlobalCandidates = [];
  if (env.APPDATA) {
    npmGlobalCandidates.push(
      path.join(
        env.APPDATA,
        "npm",
        "node_modules",
        "@openai",
        "codex",
        "node_modules",
        "@openai",
        "codex-win32-x64",
        "vendor",
        "x86_64-pc-windows-msvc",
        "bin",
        "codex.exe"
      )
    );
  }

  return unique([...pathCandidates, ...npmGlobalCandidates]);
}

function resolveCodexExecutable({
  configuredPath,
  platform = process.platform,
  env = process.env,
  pathValue = env.PATH,
  fsModule = fs,
} = {}) {
  if (configuredPath) {
    const candidate = path.resolve(String(configuredPath).trim());
    if (!isUsableFile(candidate, fsModule)) {
      throw new Error(`Configured CODEX_BIN is not a usable executable file: ${candidate}`);
    }
    return candidate;
  }

  const candidates = platform === "win32"
    ? windowsCandidates(env, pathValue)
    : String(pathValue || "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((directory) => path.join(directory, "codex"));

  const resolved = candidates.find((candidate) => isUsableFile(candidate, fsModule));
  if (!resolved) {
    throw new Error(
      platform === "win32"
        ? "Codex executable not found. Set CODEX_BIN or install Codex on PATH."
        : "Codex executable not found on PATH. Set CODEX_BIN explicitly."
    );
  }
  return path.resolve(resolved);
}

function discoverCodexExecutable(options = {}) {
  const {
    configuredPath,
    platform = process.platform,
    env = process.env,
    pathValue = env.PATH,
    fsModule = fs,
  } = options;

  if (configuredPath) {
    return {
      executablePath: resolveCodexExecutable(options),
      source: "override",
    };
  }

  const candidates = platform === "win32"
    ? windowsCandidates(env, pathValue)
    : String(pathValue || "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((directory) => path.join(directory, "codex"));
  const resolved = candidates.find((candidate) => isUsableFile(candidate, fsModule));
  if (!resolved) {
    throw new Error(
      platform === "win32"
        ? "Codex executable not found. Set CODEX_BIN or install Codex on PATH."
        : "Codex executable not found on PATH. Set CODEX_BIN explicitly."
    );
  }
  return {
    executablePath: path.resolve(resolved),
    source: candidates.indexOf(resolved) < (platform === "win32"
      ? String(pathValue || "").split(path.delimiter).filter(Boolean).length
      : String(pathValue || "").split(path.delimiter).filter(Boolean).length)
      ? "PATH"
      : "fallback",
  };
}

module.exports = { resolveCodexExecutable, discoverCodexExecutable, windowsCandidates };
