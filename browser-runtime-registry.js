"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const DEFAULT_RUNTIME_RECORD_PATH = path.join(process.cwd(), ".agent-relay", "browser-runtime.json");
function validate(record) { if (!record || record.schema_version !== 1 || !path.isAbsolute(String(record.profile_path || "")) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(String(record.cdp_endpoint || "")) || !Number.isSafeInteger(record.pid) || !/^runtime-[a-f0-9]{32}$/.test(String(record.runtime_id || ""))) throw new Error("browser_runtime_record_invalid"); return record; }
class BrowserRuntimeRegistry { constructor({ filePath = DEFAULT_RUNTIME_RECORD_PATH, fsModule = fs } = {}) { this.filePath = filePath; this.fs = fsModule; } load() { if (!this.fs.existsSync(this.filePath)) return null; return validate(JSON.parse(this.fs.readFileSync(this.filePath, "utf8"))); } save({ profilePath, cdpPort, pid }) { const record = { schema_version: 1, runtime_id: `runtime-${crypto.randomBytes(16).toString("hex")}`, profile_path: path.resolve(profilePath), cdp_endpoint: `http://127.0.0.1:${cdpPort}`, pid, started_at: new Date().toISOString() }; validate(record); this.fs.mkdirSync(path.dirname(this.filePath), { recursive: true }); this.fs.writeFileSync(this.filePath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 }); return record; } clear() { if (this.fs.existsSync(this.filePath)) this.fs.unlinkSync(this.filePath); } }
module.exports = { BrowserRuntimeRegistry, DEFAULT_RUNTIME_RECORD_PATH };
