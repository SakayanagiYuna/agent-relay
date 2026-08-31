# Agent Relay

Agent Relay 是一个在本地运行、按允许列表控制的 Slack-to-Codex 执行中继。它接收经过授权的 `CODEX_TASK` 消息，仅在已配置的仓库中运行 Codex，并返回任务生命周期结果。它不是远程 shell，也不接受任意路径、可执行文件或 CLI 选项。

## 安装与启动

运行要求：Node.js 20+、npm、Codex CLI、已为路由配置的 Git 仓库，以及 Slack Socket Mode 应用。

```powershell
npm install
Copy-Item .env.example .env
npm start
```

进程环境变量优先于 `.env`；本地 `.env` 会被忽略且不会上传。缺少或无效的配置、无效路径、Git 信任检查失败、不安全的 sandbox 设置、无效的浏览器设置，或找不到可用的 Codex 可执行文件时，启动会安全失败并停止。

## 配置

| 变量 | 用途 |
| --- | --- |
| `AGENT_RELAY_WORKER_ID` | 本地 worker ID，须与 `target_worker` 匹配。 |
| `AGENT_RELAY_ALLOWED_USER_ID`、`AGENT_RELAY_CHATGPT_APP_ID`、`AGENT_RELAY_CHANNEL_ID` | 获授权的 Slack 用户、应用和频道。 |
| `AGENT_RELAY_ATELIER_OF_MEMORY_PATH`、`AGENT_RELAY_PATH` | allowlist 仓库的本地绝对路径。 |
| `SLACK_BOT_TOKEN`、`SLACK_APP_TOKEN` | 本地 Slack 凭据。 |
| `CODEX_SANDBOX_MODE` | `workspace-write`（默认）或 `read-only`。 |
| `AGENT_RELAY_LOG_LEVEL` | `normal`（默认）或 `debug`；仅输出到终端的脱敏诊断信息。 |
| `AGENT_RELAY_BROWSER_EVIDENCE_*` | 可选的 Browser Evidence 设置。 |
| `CODEX_TIMEOUT_MS` | 可选的正数任务超时时间，单位为毫秒。 |
| `CODEX_BIN` | 可选的 Codex executable 绝对路径覆盖值。 |

在 Windows 上，可执行文件发现依次检查 `CODEX_BIN`、各个 PATH 目录中的原生 `codex.exe`，以及 npm-global 原生布局 `%APPDATA%\\npm\\node_modules\\@openai\\codex`。启动时会打印选定的绝对路径。任务不使用 shell，而是通过直接调用 `spawn`、`shell:false` 和 stdin 执行。找不到可用可执行文件时，启动会停止。

## 任务与 Browser Evidence

发送到已配置 Slack 频道的首行必须是 `CODEX_TASK`。`CODEX_TASK` 和 `CODEX_STATUS` 是稳定的协议名称。路由使用 `agent-relay` 这类逻辑 allowlist 名称；任务文本不能提供 `cwd`、shell、executable 或 CLI flags。

Codex 任务成功完成后，可选的 Browser Evidence 会在 Relay 主机上运行，绝不会在 Codex 子进程或 sandbox 内运行。它只访问已配置的 loopback origins，并在 Slack artifact upload 前，将任务范围内的 PNG 写入被忽略的 `.agent-relay/evidence/<TASK_ID>/` 目录。它不会访问凭据、浏览器配置文件、cookies 或 local storage。

## 安全与验证

中继保留 Slack 身份验证、schema 和路由允许列表、持久化去重、单任务队列、Git 仓库/信任校验、sandbox 限制，以及不经过 shell 的 Codex 直接调用。它不会修改 Git trust，也不会自动 push、deploy、publish 或修改远程服务。

```powershell
node --check listener.js
npm test
git diff --check
```

## Doctor

完成设置或迁移后运行 `npm run doctor`。Doctor 以本地只读方式检查 Node/npm、Git 仓库与信任就绪状态、必需的 `AGENT_RELAY_*` 和 Slack 配置、dotenv 格式、Codex 发现/版本/认证状态、可选 Browser Evidence 设置，以及回归测试套件。它不会打印 secret 值、向 Slack 发消息、启动浏览器、修改 `.env`、Git 配置、仓库文件或远程服务。使用 `npm run doctor -- --skip-tests` 可进行更快的配置检查。

每个检查组都会报告 `PASS`、`WARN` 或 `FAIL`。工作树有未提交改动、停用 Browser Evidence 等 warning 不会阻止就绪；必需配置、Git/trust、Slack auth、Codex execution、格式错误的 dotenv assignment 和失败的测试会阻止就绪。Windows 上 Doctor 会通过当前 Node 进程直接运行 npm CLI JavaScript，而不启动 `.cmd` shim；子进程诊断会区分找不到、调用不支持、权限/策略阻断、超时和子进程非零退出。没有关键检查失败时，Doctor 以 `READY_FOR_RELAY: YES` 和退出码 `0` 结束；否则以退出码 `1` 结束。
## V5.6 Context Builder

V5.6 在任务解析与 Codex 调用之间使用确定性的 Context Builder。它按固定顺序组合最小 Relay/task guidance、根目录 `AGENTS.md` 中的简洁仓库 guidance、任务明确命中的 capability/module guidance，以及完整的当前 instruction。`CODEX_TASK` 仍是 schema_version `1`；既有五个必需字段无需改变。

Context 选择只使用显式的路径、文件名、模块名和稳定关键词：文档任务选择 `docs`，Doctor 任务选择 `doctor`，Browser Evidence 任务选择 `browser-evidence`。没有命中时不注入 capability context，不使用 LLM 或语义分类；片段有固定顺序、固定措辞和长度上限。Relay 会记录 secret-safe 的字符级 telemetry：task、mandatory、repo、capability、final prompt 字符数及片段名，不记录正文、token、ID、secret 或 `.env`。

`AGENTS.md` 是 Relay 自己 materialize/select 的 provider-neutral 仓库互操作 guidance；Codex 是否原生读取它只是优化，不是安全或可移植性前提。Prompt guidance 不能替代代码强制的 Slack auth、allowlisted routing、dedup、队列、Git/trust、直接可执行文件调用、`shell:false`、workspace sandbox、approval、Browser Evidence loopback 与 cwd/executable 限制。

压缩示例：旧工单会重复完整安全、仓库和验证说明；V5.6 工单只写“更新 `docs/guide.md`，补充中文安装说明；验收：`npm test` 通过”。稳定内容由 Relay/`AGENTS.md` 提供，任务正文只保留目标、范围和 acceptance。
