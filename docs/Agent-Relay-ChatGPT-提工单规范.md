# Agent Relay ChatGPT 提工单规范

向已配置的 Slack 频道发送普通文本。首行必须是 `CODEX_TASK`；稳定协议名称只有 `CODEX_TASK` 和 `CODEX_STATUS`。

## 职责边界

| 事项 | ChatGPT / 提单人 | Codex worker | Relay host |
| --- | --- | --- | --- |
| 目标、范围、验收 | 必须明确 | 按工单执行 | 不推断或扩展 |
| 代码、文档、测试、只读诊断 | 说明范围，并按需选择 agent | 执行并报告 | 路由、隔离、审计 |
| `CODEX_STATUS` | 阅读终态 | 提供最终摘要 | 发送唯一生命周期事实 |
| Browser Evidence 截图与上传 | 提供完整结构化三元组 | **不得**启动浏览器、截图或上传 | worker `DONE` 后独立截图并上传 Slack |
| ChatGPT 登录、Bind + Arm、callback target | 用户手动完成 | 不得操作 | 提供本机 Runtime / 控制页 / callback |
| `.env`、token、cookie、profile、Slack 凭据 | 不写入工单 | 不读取或修改 | 仅按本机配置使用必要值 |

`CODEX_TASK` 只用于让选定的 worker agent 在 allowlisted 仓库内执行工作。省略 `agent` 时固定使用 `codex`；目前可显式选择 `grok`（底层为 Grok Build CLI）。截图、Slack 上传和 callback 都是 Relay host 的职责，不能通过 instruction 转交给 worker。

## 所有工单的字段顺序

字段必须先写完，再开始 `instruction: |`。该行后的所有内容都是 instruction 文本，不能再放 `browser_evidence`、`browser_url` 或 `browser_viewport`。

```text
CODEX_TASK
schema_version: 1
task_id: TASK-XXX
target_worker: <WORKER_ID>
target_workspace: <WORKSPACE_ID>
target_repo: <ALLOWLIST_REPO_ID>
# 可选：agent: codex（默认）或 agent: grok
# 可选：conversation: continue（默认，续上同一仓库同一 agent 的上一次会话）或 conversation: new
# 可选 Browser Evidence 字段只能放在这里
instruction: |
  目标：<任务特有目标>
  范围：<允许的文件、模块或只读边界>
  验收：<预期结果与验证方式>
```

必填字段为 `schema_version`、`task_id`、`target_worker`、`target_workspace`、`target_repo` 和 `instruction`。`agent` 是可选字段，合法值为 `codex`（默认）和 `grok`；不支持自动选择、fallback 或模型名。`conversation` 是可选字段，合法值为 `continue`（默认）和 `new`。省略或 `continue` 时，Relay 续上该 worker 上同一 `target_workspace` + `target_repo` + `agent` 的上一次会话；换仓库、换 agent，或尚未有会话时自动新开。只有工单写明 `conversation: new` 才强制新对话。不要把 session id 写入工单。`target_repo` 是 allowlist 逻辑名称，不是文件系统路径。不要填写 `cwd`、shell、executable、`--cd`、`--sandbox`、approval、Git trust flags 或本机配置项。

## 选择 `grok`

仅当该主机已安装并登录 Grok Build 时，才在 `instruction` 前加上 `agent: grok`。Relay 以 Grok Build 的 `workspace` sandbox 和 `acceptEdits` 权限模式执行，不会启用 `--always-approve`；需要 shell 或额外权限的工作会按 worker 结果变为 `BLOCKED`，再由提单人决定下一步。Grok 登录、`XAI_API_KEY`、`~/.grok` 配置和计费均是本机 Grok 的职责，不能写入 Slack 工单。

```text
CODEX_TASK
schema_version: 1
task_id: TASK-XXX
target_worker: <WORKER_ID>
target_workspace: <WORKSPACE_ID>
target_repo: agent-relay
agent: grok
instruction: |
  目标：实现 <功能>。
  范围：仅修改 <文件> 并运行 <验证>。
  验收：报告变更、验证结果和未完成项。
```

每张工单使用新的 `task_id`；拒绝、失败或重试都不能复用旧 ID，因为 Relay 会持久化去重状态。默认续上一次同一仓库、同一 agent 的 worker 会话。若要清空上下文，在 `instruction` 前加：

```text
conversation: new
```

## 类型 A：代码或文档修改

```text
CODEX_TASK
schema_version: 1
task_id: TASK-XXX
target_worker: <WORKER_ID>
target_workspace: <WORKSPACE_ID>
target_repo: agent-relay
instruction: |
  目标：在 listener 中实现 <功能>。
  范围：仅修改 listener.js、对应 regression 与中文文档。
  验收：运行 npm test 和 git diff --check；报告变更文件与结果。
```

不要重复完整安全规则、仓库介绍或“不要 push/deploy”；Relay 和仓库 guidance 已提供这些稳定边界。

## 类型 B：只读检查或诊断

```text
CODEX_TASK
schema_version: 1
task_id: TASK-XXX
target_worker: <WORKER_ID>
target_workspace: <WORKSPACE_ID>
target_repo: agent-relay
instruction: |
  目标：诊断 Browser Callback 无法启动的原因。
  范围：只读检查本机监听端口、运行时 registry 与相关日志；不修改文件、配置或进程。
  验收：报告失败阶段、证据和建议的下一步。
```

若结论需要停止进程、修改 `.env`、安装依赖或进行外部操作，应报告后等待新的明确授权，不要自动扩大诊断范围。

## 类型 C：Browser Evidence 截图验证

完整三元组必须位于 `instruction: |` **之前**。`browser_url` 只能是已配置的 HTTP/HTTPS loopback origin，且不能带 credentials、query 或 fragment；`browser_viewport` 可写单个 `desktop`、`intermediate` 或 `mobile`，也可用逗号列出多个不同值（如 `desktop,mobile`）。Relay 会分别截图并上传每个 viewport。

```text
CODEX_TASK
schema_version: 1
task_id: TASK-XXX
target_worker: <WORKER_ID>
target_workspace: <WORKSPACE_ID>
target_repo: <ALLOWLIST_REPO_ID>
browser_evidence: screenshot
browser_url: http://localhost:5173
browser_viewport: desktop
instruction: |
  目标：验证允许列表仓库首页的 desktop Browser Evidence。
  范围：只读；不修改仓库文件或 Agent Relay 配置。
  验收：worker 完成后由 Relay host 截图并上传 Slack；终态应包含 evidence_file_id，且可用时包含 evidence_permalink。
  注意：不要启动或操作浏览器、截图或上传证据；这些由 Relay host 在 worker DONE 后执行。
```

执行顺序固定为：

```text
Codex worker DONE
  -> Relay host 启动独立 headless Chromium
  -> 访问已授权 loopback URL、截图、上传 Slack
  -> 终态 CODEX_STATUS 附 evidence 引用
```

Browser Evidence 不使用 ChatGPT 可见 Chrome、Browser Runtime、页面绑定、cookie、profile 或 tab。不要要求 worker“使用 Browser Runtime”“打开网页”或“返回 file_id”；worker 因自身没有浏览器而 `FAILED` 时，Relay 不会继续截图。

## 类型 D：Browser Callback / ChatGPT 回调配置

这不是普通 `CODEX_TASK`。用户在 Relay 主机手动启动专属 Chrome、登录、启动 callback runtime，并在控制页明确选择对话后点击“一键 Bind + Arm + 写入 .env”。

```powershell
npm run browser:init
npm run browser-callback -- runtime
# 打开 http://127.0.0.1:8787/
```

终态 callback 只唤醒已绑定对话，并提示 ChatGPT 通过 Slack 读取同一 `task_id` 的完整 `CODEX_STATUS`；不会传递完整任务正文、日志、cookie、token 或截图 blob。排查 callback 时使用“类型 B：只读检查/诊断”单独提单。

## 结果与失败的阅读方式

生命周期为 `CODEX_TASK -> START -> DONE | BLOCKED | FAILED`。Slack 的终态 `CODEX_STATUS` 是唯一执行事实来源：它包含 worker、仓库、耗时、Git 摘要、测试结论、可用时的 `token_usage` 与 Browser Evidence 引用。

- `DONE`：worker 已完成；请求了 Browser Evidence 时 Relay host 才继续截图和上传。
- `BLOCKED`：需要权限、配置或外部状态；阅读 `reason` 后发新工单。
- `FAILED`：验收未完成；先确认失败发生在 worker、navigation、screenshot 还是 evidence upload，不要复用原 `task_id`。

不要让 ChatGPT 改写或截短 acceptance。任务涉及文档、Doctor 或 Browser Evidence 时，在目标中写出明确文件名、模块名或能力名称，便于 Context Builder 选择最小必要 guidance。
