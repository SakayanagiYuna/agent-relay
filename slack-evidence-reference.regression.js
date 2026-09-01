"use strict";

const assert = require("assert");
const { extractSlackEvidenceReference } = require("./slack-evidence-reference");

assert.deepStrictEqual(
  extractSlackEvidenceReference({ ok: true, files: [{ ok: true, files: [{ id: "F085ABC", permalink: "https://workspace.slack.com/files/U1/F085ABC/evidence.png" }] }] }),
  { fileId: "F085ABC", permalink: "https://workspace.slack.com/files/U1/F085ABC/evidence.png" },
  "uploadV2 nested completion responses must yield the shared file reference"
);
assert.deepStrictEqual(extractSlackEvidenceReference({ file: { id: "F085DEF" } }), { fileId: "F085DEF", permalink: null });
assert.strictEqual(extractSlackEvidenceReference({ files: [{ id: "not-a-file" }] }), null);
console.log("slack evidence reference regression passed");
