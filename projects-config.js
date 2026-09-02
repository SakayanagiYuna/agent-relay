"use strict";

const fs = require("fs");
const path = require("path");

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DEFAULT_PROJECTS_PATH = path.join(__dirname, ".agent-relay", "projects.json");

function validateRepoId(repoId) {
  if (!ID_PATTERN.test(String(repoId || ""))) throw new Error("projects_repo_id_invalid");
  return String(repoId);
}

function validateWorkspaceId(value) {
  if (!ID_PATTERN.test(String(value || ""))) throw new Error("projects_workspace_id_invalid");
  return String(value);
}

function validateLocalPath(value) {
  const configured = String(value || "");
  if (!configured || !path.isAbsolute(configured)) throw new Error("projects_local_path_invalid");
  return path.resolve(configured);
}

function loadProjectsConfig({ filePath = DEFAULT_PROJECTS_PATH, fsModule = fs } = {}) {
  if (!fsModule.existsSync(filePath)) {
    throw new Error("projects_config_missing_copy_projects.example.json_to_.agent-relay/projects.json");
  }
  const parsed = JSON.parse(fsModule.readFileSync(filePath, "utf8"));
  if (!parsed || parsed.schema_version !== 1) throw new Error("projects_config_schema_invalid");
  const workspaceId = validateWorkspaceId(parsed.workspace_id);
  if (!parsed.repos || typeof parsed.repos !== "object" || Array.isArray(parsed.repos) || !Object.keys(parsed.repos).length) {
    throw new Error("projects_config_repos_invalid");
  }
  const repos = {};
  for (const [repoId, repo] of Object.entries(parsed.repos)) {
    repos[validateRepoId(repoId)] = { local_path: validateLocalPath(repo?.local_path) };
  }
  return { schema_version: 1, workspace_id: workspaceId, repos };
}

function buildChannelProjects({ channelId, config }) {
  if (!channelId) throw new Error("projects_channel_id_required");
  return {
    [channelId]: {
      project_id: config.workspace_id,
      workspace_id: config.workspace_id,
      repos: config.repos,
    },
  };
}

function configuredRepoPaths(config) {
  return Object.values(config.repos).map((repo) => repo.local_path);
}

module.exports = {
  DEFAULT_PROJECTS_PATH,
  buildChannelProjects,
  configuredRepoPaths,
  loadProjectsConfig,
};
