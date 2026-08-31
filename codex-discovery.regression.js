"use strict";

const assert = require("assert");
const path = require("path");
const { resolveCodexExecutable } = require("./codex-discovery");

function fakeFs(files) {
  return {
    statSync(candidate) {
      if (!files.has(path.normalize(candidate))) throw new Error("missing");
      return { isFile: () => true };
    },
  };
}

const pathCodex = path.join("C:\\Users\\worker", "AppData", "Local", "Programs", "OpenAI", "Codex", "bin", "codex.exe");
assert.strictEqual(
  resolveCodexExecutable({
    platform: "win32",
    env: { APPDATA: "C:\\Users\\worker\\AppData\\Roaming" },
    pathValue: path.dirname(pathCodex),
    fsModule: fakeFs(new Set([path.normalize(pathCodex)])),
  }),
  path.normalize(pathCodex),
  "discovers the PATH-resolved Windows Codex installation"
);

const npmCodex = path.join(
  "C:\\Users\\worker\\AppData\\Roaming",
  "npm", "node_modules", "@openai", "codex", "node_modules", "@openai",
  "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe"
);
assert.strictEqual(
  resolveCodexExecutable({
    platform: "win32",
    env: { APPDATA: "C:\\Users\\worker\\AppData\\Roaming" },
    pathValue: "",
    fsModule: fakeFs(new Set([path.normalize(npmCodex)])),
  }),
  path.normalize(npmCodex),
  "discovers the prior npm-global native layout"
);

const override = path.join("C:\\tools", "codex.exe");
assert.strictEqual(
  resolveCodexExecutable({
    configuredPath: override,
    platform: "win32",
    fsModule: fakeFs(new Set([path.normalize(override)])),
  }),
  path.normalize(override),
  "preserves an explicit CODEX_BIN override"
);

assert.throws(
  () => resolveCodexExecutable({ platform: "win32", env: {}, pathValue: "", fsModule: fakeFs(new Set()) }),
  /Codex executable not found/
);

console.log("codex discovery regression checks passed");
