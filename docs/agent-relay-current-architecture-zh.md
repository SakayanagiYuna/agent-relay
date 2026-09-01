# Agent Relay 当前架构

## V5.7 / v1.1.0

本版本相对 V5.6 的完整变更如下：

- 协议：`CODEX_TASK` 与 `CODEX_STATUS` 名称、schema version `1` 和任务必填字段保持不变。可选 `agent` 扩展字段省略时固定为 `codex`，也可显式为 `grok`（底层为 Grok Build CLI）；不做自动选择或失败 fallback。parser 在拒绝时记录可解析的 `task_id`、`stage=schema_validation`、更细的 parse stage、recognized fields 与 reason；该提取仅用于审计，不能放宽接收 schema，拒绝工单仍可按编号追踪。
- 生命周期：新增显式 execution state 模块，状态仅允许 `START -> RUNNING -> DONE | FAILED | BLOCKED`。heartbeat 每 30 秒更新本机 context，在 debug 终端/log 中输出，既不发布 Slack `RUNNING`，也不触发 Browser Callback。
- Slack 审计：终态 `CODEX_STATUS` 统一输出 duration、Git commit、changed files、diff summary 与可识别的 test result；`DONE` 使用 summary，`FAILED`/`BLOCKED` 使用 reason。完整 stdout、stderr、diff 和 heartbeat 继续不进入 Slack。
- 终态分发：`task_terminal` event 在 Slack 终态成功后由 Browser Callback 和 Human Notification 并行独立消费。Browser 或通知失败只留下本机 `BROWSER_CALLBACK_FAILED` / `HUMAN_NOTIFY_FAILED`，不修改 Slack 事实状态。
- 浏览器：新增 Relay 专用可见 Browser Runtime、runtime registry、page binding 和 callback target registry。用户手动登录后复用 profile；根控制页对明确选中的 allowlisted conversation 一键 Bind、Arm 并写入本机 `.env`。Callback 重启仅在唯一匹配且 `ARMED` 的对话仍存在时恢复；否则安全地要求重新授权。
- 通知：新增独立、可选的 Nodemailer SMTP provider。邮件只含 task ID、status 与 elapsed seconds；缺失或无效配置时 provider 为 disabled，不影响任务执行。
- Browser Evidence：Evidence 始终以独立 headless Chromium 直接打开 allowlisted loopback Vue URL 截图；它不进行 ChatGPT page discovery/binding，不读取或操作 ChatGPT tab、profile、Cookie、session 或 conversation identity，也不连接 Managed Chrome。
- 就绪与测试：Doctor 校验可选 callback loopback endpoint；回归覆盖 parser/reject、状态机、heartbeat、status audit、fan-out、SMTP、browser runtime、binding、registry 和 callback 生命周期。

凭据、浏览器 profile、Cookie、callback target、runtime record、processed state、日志和证据都属于本机被忽略状态，绝不进入仓库。

Agent Relay 将 ChatGPT/人工规划与本地受控执行分离：

```text
ChatGPT / human -> CODEX_TASK -> Slack -> Agent Relay -> Codex (default) / Grok Build (selected) -> allowlisted local repo
                                      <- CODEX_STATUS START / DONE / BLOCKED / FAILED
Relay local debug terminal/log       <- HEARTBEAT（每 30 秒）
                                      -> terminal fan-out -> optional loopback Browser Callback -> bound ChatGPT conversation
                                                          -> optional Human Notification provider
```

`CODEX_TASK` 和 `CODEX_STATUS` 是稳定的协议名称。当前唯一的产品和路由标识是 Agent Relay（`agent-relay`）。每台机器都保留自己的、被忽略的 `.env`、本地路径、worker ID 和去重状态。

## Execution Result / Event 状态模型（v5.7 第一阶段）

状态集合固定为 `START`、`RUNNING`、`DONE`、`FAILED`、`BLOCKED`，唯一允许的转换为 `START -> RUNNING -> DONE | FAILED | BLOCKED`。`START` 为已接受任务的 `CODEX_STATUS`，成功发送后才创建本地 execution context 并进入 `RUNNING`；后三者均为终态，并以终态 `CODEX_STATUS` 将完整摘要留在 Slack。

终态不只依赖 Codex child 的退出码：worker 最终回复必须以独立行给出 `AGENT_RELAY_RESULT: DONE|FAILED|BLOCKED`。若回复明确报告 `FAILED` 或 `BLOCKED`（兼容 `状态：FAILED` / `status: FAILED`），Relay 会覆盖 exit code `0` 并发布对应终态，避免任务实际失败却显示 `DONE`。

execution state 保存 `task_id`、`worker_id`、`started_at`、`current_status`、`last_heartbeat_at` 和最终计算出的 duration。Browser Callback 不承载 execution result：冻结的 `AGENT_RELAY_EVENT v1` 基础字段只传 `task_id` 与 `status`；可选的 `callback_target_id` 仅供本机目标投递校验。它不含 summary、stdout、stderr、文件改动或图片内容；有 Browser Evidence 时只携带 `slack_channel_id`、`slack_status_ts`、`evidence_file_id` 与可选 permalink，供 ChatGPT 自行从 Slack 读取附件。terminal fan-out 的内部 event 可带 `elapsed_sec`，仅供 Human Notification 的极简提醒使用。

heartbeat 的 `elapsed_ms`、debug 本地日志和诊断错误属于 debug information；它们不迁移执行状态、不产生 `RUNNING` 的 `CODEX_STATUS`，也不进入 callback。

## Execution Heartbeat v1

生命周期为 `TASK_RECEIVED -> START -> HEARTBEAT (RUNNING) -> DONE / BLOCKED / FAILED`。`START` 成功后，Relay 为该 execution 记录 `task_id`、`worker_id`、`started_at`、`current_status` 和 `last_heartbeat_at`，并每 30 秒更新 heartbeat 与累计耗时。heartbeat 是 debug/observability 信号，只在 `AGENT_RELAY_LOG_LEVEL=debug` 时输出到本地 listener terminal/log，默认 `normal` 输出不显示；不会发布到 Slack，也不会产生 `RUNNING` polling，不是新的 `CODEX_STATUS`，不改变任务事实状态，也不进入 Browser Callback。

终态前 Relay 会清理 heartbeat timer，并在终态 `CODEX_STATUS` 摘要中输出最终 `duration`。终态消息还包含 `task_id`、`status`、`worker`、`workspace`、`repo`、可获得的 `git_commit`、`git_diff_summary`，以及 worker 明确报告执行测试时的 `test_result`。`FAILED` 与 `BLOCKED` 将简短原因写入 `reason`。Git 不可用时相应字段为 `unavailable`；不会把 stdout、stderr、完整 diff 或 heartbeat 放入 Slack。timer 使用 `unref()`，不会令 Node 因 heartbeat 而无法退出。Codex sandbox、Browser Evidence 与 Browser Callback 的既有边界不变。

终态 `DONE` 示例：

```text
CODEX_STATUS
schema_version: 1
task_id: TASK-063
status: DONE
worker: dev-pc-b
workspace: baiyuan
repo: agent-relay
duration: 00m42s
git_commit: abc1234
git_diff_summary: 2 changed file(s), +12/-3
test_result: passed
summary: |
  已完成状态审计摘要模板与回归。
```

## Callback Loop v1

终态 `CODEX_STATUS`（`DONE`、`BLOCKED`、`FAILED`）成功发送并取得 Slack message receipt 后，Relay 才生成 `{ schema_version: 1, event: "task_terminal", task_id, status, elapsed_sec? }` 并独立 fan-out。配置 `AGENT_RELAY_BROWSER_CALLBACK_URL` 时，Browser 分支将其投递到精确的 loopback `/api/callback`（可附加仅用于本机路由校验的 `callback_target_id`）。有 Browser Evidence 时，终态 Slack 状态包含 `evidence_file_id` 和可获得的 `evidence_permalink`；callback 只附带经过格式/来源校验的 `slack_channel_id`、`slack_status_ts`、`evidence_file_id`、`evidence_permalink?`，让 ChatGPT 经 Slack 检索附件，绝不传递 image blob、Cookie 或执行详情。未取得 receipt 时 Browser Callback 跳过，避免在 Slack 终态之前唤醒对话。Human Notification 分支消费同一个 event。它不是第二套状态系统，任一分支的未启动、未 Arm、provider 或发送失败只记录 `BROWSER_CALLBACK_FAILED` / `HUMAN_NOTIFY_FAILED` diagnostic，不修改 Slack 状态，也不阻止另一分支。

Human Notification provider 默认 `disabled`/noop。首个 `email` provider 的配置入口是 `AGENT_RELAY_NOTIFY_ENABLED`、`AGENT_RELAY_NOTIFY_PROVIDER=email`、`AGENT_RELAY_NOTIFY_EMAIL_TO`，以及仅本机环境变量中的 `AGENT_RELAY_NOTIFY_SMTP_HOST`、`AGENT_RELAY_NOTIFY_SMTP_PORT`、`AGENT_RELAY_NOTIFY_SMTP_USER`、`AGENT_RELAY_NOTIFY_SMTP_SECRET`。Relay 以 Nodemailer 创建 SMTP transport：端口 `465` 使用 TLS，其他端口使用 STARTTLS。邮件仅含 `task_id`、`status`、`elapsed_sec`，不复制 Slack 执行详情、instruction 或凭据。缺少 SMTP 配置会报告 `HOST_CONFIG_REQUIRED`，不得影响任务或声称已发送。

Browser Callback 只接受已 Bind 且已 Arm 的目标 conversation；收到事件后保持 Bind → Arm → Render → Send 顺序，复核 allowlisted ChatGPT origin 和 conversation identity，再通过可见输入框与 Enter 唤醒该 conversation。它不回退到当前/默认 tab，不读取 cookie、profile、session 或 storage，也不越过浏览器安全边界。

V5.7 的 Browser Runtime 以 Relay 专用 persistent profile 启动可见的原生 Chromium/Chrome，并只在 loopback CDP 上接受 Relay attach。默认 profile 位于 `.agent-relay/browser-profile`，绝不复用日常浏览器 profile、cookie、storage 或其他 tab。首次启动由用户完成登录；Relay 不填写账号、密码或 MFA。profile 派生稳定的 `browser_context_id`，所以 target 只可在所属 context 中 resolve，不能回退或控制其他 context。

Relay 主机使用 `npm run browser:init` 创建或加载 profile 并打开 allowlisted `start_url`，再使用 `npm run browser-callback -- runtime` 连接该运行时。入口输出 profile path、headless、native context 和 authentication state；认证状态固定为 `unknown`，不推断账号是否有效。设定 `AGENT_RELAY_BROWSER_RUNTIME_ENABLED=false` 时入口安全退出且不启动浏览器。

Page Binding 与 Callback Target Registry 均只保存在被忽略的 `.agent-relay/`。它们保存 `{ origin, pathname, title }` identity 和 target state，不保存 page object、tab index、Cookie 或凭据。Callback 重启时，若同一 managed profile 中存在唯一匹配且仍为 `ARMED` 的 conversation，会恢复 Bound/Armed；找不到或有歧义时安全地要求重新授权，绝不会猜测页面、发送内容或越过 origin allowlist。

## Callback Target Registry v1

Browser Callback 使用本机 `.agent-relay/callback-registry.json` 保存 callback target：`callback_target_id`、`platform`、`conversation_identity`、`created_at` 与 `state`。target state 仅为 `REGISTERED`、`ARMED`、`DISARMED`、`EXPIRED`，与 execution 的 `START`、`RUNNING`、`DONE`、`BLOCKED`、`FAILED` 完全分离。Registry 不以 `task_id` 作为键，一个 conversation 可对应多个 task，也可经历多个明确的 Bind 生命周期。

底层 API 仍分别提供 Bind 与 Arm；根控制页 `http://127.0.0.1:8787/` 则提供一个明确页面选择后的“一键 Bind + Arm + 写入 .env”操作。它只为选定的 allowlisted conversation 注册并 Arm target，然后更新本机 `.env` 的 callback URL/target。Listener 在每次终态 fan-out 前重新读取该两项本机配置，因此后续任务无需因 target 更新而重启 Listener。缺少、不存在或失效的 target 一律安全失败，绝不回退到当前 tab。

配置使用根目录 README 中记录的 `AGENT_RELAY_*` 名称。`AGENT_RELAY_LOG_LEVEL=normal` 提供简洁的本地进度；`debug` 会额外输出脱敏的 JSON 诊断信息。启动时会校验配置、ID、路径、Git trust、Codex、sandbox 和可选的 Browser Evidence；出现错误即安全失败。

## Doctor

迁移或重新配置后可运行 `npm run doctor`。Doctor 以只读方式检查 Node/npm、Git trust 与允许列表仓库、必需配置和 dotenv 格式、Slack 只读认证、Codex 发现/版本/认证状态，以及可选 Browser Evidence 配置，并默认运行 `npm test`。输出按 `PASS`/`WARN`/`FAIL` 分组；工作树有未提交改动和关闭 Browser Evidence 属于 warning，不会单独阻止就绪。缺少必需配置、Git/Slack/Codex 检查失败、dotenv assignment 拼接错误或回归测试失败会返回退出码 `1`。Doctor 不会打印 token、认证材料或配置值，也不会修改 `.env`、Git 或仓库状态；可用 `npm run doctor -- --skip-tests` 跳过测试。

## Worker agent 发现与执行边界

在 Windows 上，Codex 可执行文件解析遵循 `CODEX_BIN`，然后在 PATH 中查找原生 `codex.exe`，再检查 npm-global 原生 package layout。`agent: grok` 使用可选 `AGENT_RELAY_GROK_BIN`，否则仅在该任务执行时从 PATH 发现 `grok.exe`。两种 worker 都使用直接调用 `spawn` 和 `shell:false`；Slack 不能控制 shell、cwd、executable 或 CLI options。Codex 从 stdin 读取 prompt；Grok Build 使用 Relay 创建、进程退出即删除的提示文件，以免 Slack 文本成为命令行参数。Grok 以 `workspace` sandbox、`acceptEdits` 和 `--no-subagents` 运行，Relay 不会启用 `--always-approve`。Grok 登录、API key 与其本机配置保持由 Grok CLI 管理。

## Browser Evidence

Browser Evidence 只在 Codex 完成后、Relay 主机上运行。顶层 URL 必须是 HTTP/HTTPS loopback URL，并且 origin 必须与配置的允许 origin 完全一致；URL 不得包含 credentials、query 或 fragment。每次截图均启动独立 headless 浏览器，完成后关闭；不会连接 Managed Chrome，也不会 page-discover、绑定、读取或操作 ChatGPT 页面。证据按任务隔离，写入被忽略的 `.agent-relay/evidence/<TASK_ID>/` 目录；绝不会读取浏览器配置文件、cookies、local storage 或 credentials。浏览器运行不进入 Codex 子进程或 sandbox。

### 工单授权约束

浏览器访问不能由 `instruction`、任务目标、输出要求或验收文字推断。`CODEX_TASK` 只有在同时出现完整结构化三元组时才请求截图：`browser_evidence: screenshot`、`browser_url`、`browser_viewport`。三项全部缺失表示不截图；任何一项存在但不完整或无效时，parser 以 `invalid_browser_evidence_request` 安全拒绝。`browser_url` 必须是已配置的 loopback origin 且不带 credentials、query、fragment；viewport 仅允许 `desktop`、`intermediate`、`mobile`。自然语言可以说明截图的验收目标，但不构成授权。

## 安全不变量

执行范围始终受 worker、workspace、仓库路由允许列表、Git trust 校验和 sandbox 设置约束；任务正文不能注入路径、shell、executable 或 CLI 参数。中继使用持久化去重和单任务队列，并保持不经过 shell 的直接调用。它不会自动修改 Git trust、push、deploy、publish 或远程服务。
## V5.6 Context Builder

任务解析完成后，Relay 先由 Context Builder 生成 Codex stdin prompt，再启动 Codex。Prompt 分为四层：最小 Relay/task guidance、根目录 `AGENTS.md` 的简洁仓库 guidance、与任务明确相关的 capability/module 片段、完整当前 instruction。schema_version 仍为 `1`，旧任务字段和解析方式保持兼容；instruction 不做静默截断。

Context Builder 使用显式、可测试的固定规则：命中 `docs`、README、文档路径或文档关键词时选 `docs`；命中 `doctor.js`、`npm run doctor` 或诊断关键词时选 `doctor`；命中 Browser Evidence、screenshot 或浏览器证据关键词时选 `browser-evidence`。片段固定排序、措辞简洁且有界；未命中的 capability 不进入 prompt，不使用 LLM/semantic classification。

`AGENTS.md` 由 Context Builder 主动读取并 materialize/select，提供 Agent Relay 身份、简体中文文档约定、稳定协议名、`AGENT_RELAY_*` 命名和 Doctor/Browser Evidence 边界。provider 原生读取 `AGENTS.md` 只是 interoperability optimization，不是安全或 portability 依赖。字符级 telemetry 只包含 task、mandatory、repo、capability、final prompt 字符数和片段名，禁止正文、token、ID、secret、`.env` 或私有 operational metadata；完整 Usage Accounting 延后到 V6。

Context Builder 只压缩重复 prompt 文本，不改变 Relay 的代码强制安全边界。当前仅支持显式 `codex` 与 `grok`；automatic routing、quota failover、跨 provider 的统一 token/cost accounting、schema v2 和 policy DSL/manifest 仍延后。
