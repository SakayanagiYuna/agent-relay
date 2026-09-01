"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { BrowserRuntimeRegistry } = require("./browser-runtime-registry");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-relay-runtime-registry-"));
try {
  const filePath = path.join(root, "runtime.json"); const registry = new BrowserRuntimeRegistry({ filePath });
  assert.strictEqual(registry.load(), null);
  const record = registry.save({ profilePath: path.join(root, "profile"), cdpPort: 9333, pid: 1234 });
  assert.match(record.runtime_id, /^runtime-[a-f0-9]{32}$/); assert.strictEqual(record.cdp_endpoint, "http://127.0.0.1:9333"); assert.deepStrictEqual(registry.load(), record);
  registry.clear(); assert.strictEqual(registry.load(), null);
  fs.writeFileSync(filePath, "{}\n"); assert.throws(() => registry.load(), /browser_runtime_record_invalid/);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log("browser runtime registry regression passed");
