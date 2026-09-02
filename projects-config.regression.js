"use strict";

const assert = require("assert");
const { buildChannelProjects, configuredRepoPaths, loadProjectsConfig } = require("./projects-config");

const files = new Map();
const fsModule = {
  existsSync: (filePath) => files.has(filePath),
  readFileSync: (filePath) => files.get(filePath),
};

assert.throws(() => loadProjectsConfig({ filePath: "missing.json", fsModule }), /projects_config_missing/);

files.set("ok.json", JSON.stringify({
  schema_version: 1,
  workspace_id: "workspace-1",
  repos: { "example-app": { local_path: "C:\\src\\example-app" } },
}));
const config = loadProjectsConfig({ filePath: "ok.json", fsModule });
assert.strictEqual(config.workspace_id, "workspace-1");
assert.deepStrictEqual(configuredRepoPaths(config), ["C:\\src\\example-app"]);
assert.deepStrictEqual(buildChannelProjects({ channelId: "C123", config }).C123.workspace_id, "workspace-1");

files.set("bad.json", JSON.stringify({ schema_version: 1, workspace_id: "workspace-1", repos: { "example-app": { local_path: "relative\\path" } } }));
assert.throws(() => loadProjectsConfig({ filePath: "bad.json", fsModule }), /projects_local_path_invalid/);
console.log("projects-config regression: passed");
