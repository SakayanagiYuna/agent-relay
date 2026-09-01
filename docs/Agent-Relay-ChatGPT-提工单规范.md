# Agent Relay ChatGPT 提工单规范

向已配置的 Slack 频道发送普通文本即可。首行必须是 `CODEX_TASK`。V5.7 的工单正文只描述任务特有的目标、范围和验收；稳定的 Relay 安全、仓库约定和 Doctor/Browser Evidence 边界由 Relay Context Builder 与根目录 `AGENTS.md` 提供，不要重复粘贴。

## 模板

```yaml
CODEX_TASK
schema_version: 1
task_id: TASK-XXX
target_worker: <WORKER_ID>
target_workspace: <WORKSPACE_ID>
target_repo: agent-relay
instruction: |
  目标：<要完成的具体变化>
  范围：<允许涉及的文件、模块或边界>
  验收：<可执行的验证和结果>
```

`schema_version: 1` 以及 `task_id`、`target_worker`、`target_workspace`、`target_repo`、`instruction` 五个字段必须保留。`target_repo` 是 allowlist 的逻辑名称，不是文件系统路径。不要填写 `cwd`、shell、executable、`--cd`、`--sandbox`、approval 或 Git trust flags；这些由本地 Agent Relay 决定。

## Browser Evidence（可选）

截图只能由完整的结构化三元组显式请求；不要只在 `instruction` 里写“截图”“打开页面”或“检查浏览器”。三项全部省略时不截图；任一项存在时必须完整提供，否则工单会以 `invalid_browser_evidence_request` 被拒绝。

```yaml
browser_evidence: screenshot
browser_url: http://localhost:5173
browser_viewport: desktop
```

`browser_url` 必须是此 Relay 主机配置过的 HTTP/HTTPS loopback origin，且不能带 credentials、query 或 fragment。`browser_viewport` 只能是 `desktop`、`intermediate` 或 `mobile`。截图由 Relay 在 Codex 成功后用独立 headless 浏览器执行，不能使用或操作 ChatGPT 页面；成功时 Slack 终态会提供证据附件引用。

## 压缩写法示例

重复写法会把整段安全规则、仓库介绍和验证清单再次放进每张工单：

```text
请在 agent-relay 仓库内遵守所有 Relay 安全规则，只改允许的文件，不访问 secret，不 push/deploy，并运行所有测试……然后更新 docs/guide.md。
```

V5.7 推荐只保留任务差异：

```text
目标：更新 docs/guide.md，补充简体中文安装说明。
范围：仅修改该文档。
验收：运行 npm test；报告变更文件和验证结果。
```

不要让 ChatGPT 改写或截短 acceptance，也不要在 instruction 中重复稳定安全 boilerplate。若任务涉及文档、Doctor 或 Browser Evidence，请在目标/范围中使用明确的文件名、模块名或能力名称，方便 Context Builder 选择最小片段；选择仍由 Relay 的固定规则完成。

生命周期为 `CODEX_TASK -> START -> Codex execution -> DONE / BLOCKED / FAILED`。每张工单使用新的 `task_id`，因为去重状态会持久化保存；即使工单被拒绝也保留编号，下一张使用新的编号，不能复用。
