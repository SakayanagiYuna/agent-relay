"use strict";

const assert = require("assert");
const path = require("path");
const { resolveGrokExecutable } = require("./grok-discovery");

function fakeFs(files) {
  return { statSync(candidate) { if (!files.has(path.normalize(candidate))) throw new Error("missing"); return { isFile: () => true }; } };
}

const grokPath = path.join("C:\\Users\\worker", ".grok", "bin", "grok.exe");
assert.strictEqual(resolveGrokExecutable({ platform: "win32", pathValue: path.dirname(grokPath), fsModule: fakeFs(new Set([path.normalize(grokPath)])) }), path.normalize(grokPath));
assert.throws(() => resolveGrokExecutable({ platform: "win32", pathValue: "", fsModule: fakeFs(new Set()) }), /Grok Build executable not found/);
console.log("grok discovery regression checks passed");
