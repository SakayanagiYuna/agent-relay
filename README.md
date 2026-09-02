# Agent Relay

## Desktop Console（Windows MVP）

安装依赖后可运行 `npm run console:start` 启动本机 Electron Console；它会以受限 IPC 启动或复用 Listener、Relay 专用原生 Chrome 和既有 loopback Browser Callback。若只需独立运行 Listener，请使用 `npm start`。Console 不嵌入 ChatGPT、不会读取浏览器 profile、Cookie、Slack/SMTP 凭据或完整任务指令。

运行中的任务或 Browser Evidence 在关闭窗口时会提示：默认保持运行，也可选择完成后自动退出；强制退出需再次确认，且可能缺少 Slack 终态。首次使用仍需在原生 Chrome 内由用户自行登录并明确选择 conversation 后 Connect Callback。真人登录、MFA、Windows 窗口聚焦行为需要在本机 GUI 环境验证。

Agent Relay 是本地、按 allowlist 控制的 Slack-to-agent 执行中继。稳定协议名称是 `CODEX_TASK` 和 `CODEX_STATUS`。工单可显式选择 `codex` 或 `grok`；未写 `agent` 时使用本机默认值（Desktop Console 右栏可改，未配置则为 Codex）。终态 `CODEX_STATUS` 成功发送后，Relay 从同一个 `task_terminal` event 独立 fan-out 到可选 Browser Callback 和 Human Notification；Slack 仍是唯一生命周期事实来源。

## V5.7 / v1.1.0

本版本相对 V5.6 的完整变更如下：

- `CODEX_TASK` 协议仍固定为 schema version `1` 和既有必填字段；parser 为拒绝路径补充可审计的 `task_id` 提取、解析阶段、已识别字段和明确 reason，拒绝工单不会进入执行，编号可被审计追踪。
- `agent` 是 `CODEX_TASK v1` 的可选扩展字段：工单写明 `agent: codex` 或 `agent: grok` 时以工单为准；省略时使用本机 `.env` 的 `AGENT_RELAY_DEFAULT_AGENT`（Desktop Console 右栏可改，启动时从 `.env` 校准），未配置则为 `codex`。Relay 不做自动 agent 路由或失败 fallback，Grok 任务使用 `workspace` sandbox、`acceptEdits` 权限模式和提示文件，绝不启用 `--always-approve`；若其 JSON 终态包含兼容 usage，仍进入既有本机账本和 Slack 审计。
- `conversation` 是可选扩展字段：省略或 `conversation: continue` 时，同一 worker 上相同 workspace、repo 和 agent 的后续工单续上一次 worker 会话（Codex `exec resume`，Grok `--resume`）。仅当工单写明 `conversation: new` 时才新开会话。换仓库或换 agent 不会续上。session id 只存在本机 `.agent-relay/worker-sessions.json`，不进入 Slack 工单。
- 在配置频道发送精确文本 `AGENT_RELAY_HEALTH` 可探活所有收到该消息的 Relay 实例。探活不校验发件人、不会进入任务队列；每台实例立即回复自己的 `worker`、`running_tasks` 和 `queued_tasks`。
- 每个终态任务会将 Codex JSONL 中实际返回的 token usage 写入本机 `state/usage-accounting.json`，并在 `CODEX_STATUS` 中以紧凑 `token_usage` 字段报告；CLI 未返回 usage 时明确报告 `unavailable`，不估算费用。
- 执行状态统一为 `START -> RUNNING -> DONE | FAILED | BLOCKED`。30 秒 heartbeat 改为仅在 `AGENT_RELAY_LOG_LEVEL=debug` 的本地观测信号，不再向 Slack 产生周期 `RUNNING` 消息，也不会触发 callback。
- 终态 `CODEX_STATUS` 新增 duration、Git commit、changed files、diff 汇总及可推断的 test result；成功摘要使用 `summary`，失败/阻塞摘要使用 `reason`，不会复制完整 stdout、stderr 或 diff。
- 终态以单个 `task_terminal` event 独立 fan-out 到 Browser Callback 和 Human Notification；任一分支失败只写本机 diagnostic，不改变 Slack 生命周期或阻塞另一分支。
- 加入 Relay 专用可见 Browser Runtime、持久化 profile、callback target registry 与根控制页的一键 Bind + Arm + `.env` 同步；Browser Callback 重启可在唯一匹配的已授权对话仍打开时恢复，Listener 每次 fan-out 前重读本机 callback 配置。
- 加入可选 Nodemailer SMTP Human Notification；邮件仅含 task ID、status、elapsed seconds，缺失配置时安全 disabled。
- Browser Evidence 始终使用独立 headless Chromium 直接访问 allowlisted loopback Vue 页面；它不发现、绑定、读取或操作 ChatGPT 页面，也不连接或复用可见的 Managed Chrome。
- Doctor 会校验可选 Browser Callback endpoint；新增 parser、状态机、heartbeat、status audit、fan-out、notification、browser runtime/binding/registry 的回归覆盖。

所有凭据、profile、Cookie、target registry、runtime record 与证据仅保留在被忽略的本机文件中。

## Execution Result / Event 状态模型（v5.7 第一阶段）

执行生命周期的唯一状态集合为 `START`、`RUNNING`、`DONE`、`FAILED`、`BLOCKED`，允许的转换是 `START -> RUNNING -> DONE | FAILED | BLOCKED`。`START` 是已接受任务的 `CODEX_STATUS` 事件；成功发送后才创建本地 execution context 并进入 `RUNNING`。`DONE`、`FAILED`、`BLOCKED` 是终态，写入终态 `CODEX_STATUS`，其完整结果和摘要只由 Slack 承载。

Worker 的进程退出码不是唯一成功依据：当最终回复以独立行报告 `AGENT_RELAY_RESULT: FAILED` 或 `AGENT_RELAY_RESULT: BLOCKED`（兼容识别首行式的 `状态：FAILED` / `status: FAILED`）时，Relay 即使收到 exit code `0` 也会发送相同的失败终态，防止 Slack 显示与实际结果冲突的 `DONE`。

execution state 仅保存任务运行事实：`task_id`、`worker_id`、`started_at`、`current_status`、`last_heartbeat_at`，以及在结束时计算的 `duration`。Browser Callback 的冻结 `AGENT_RELAY_EVENT v1` 基础字段为 `task_id` 和 `status`；如配置 `callback_target_id`，它仅用于本机已 Arm 目标的投递校验，不是执行结果。它不复制 summary、stdout、stderr、改动文件或图片内容；有 Browser Evidence 时，只追加可让 ChatGPT 从 Slack 读取附件的 `slack_channel_id`、`slack_status_ts`、`evidence_file_id` 和可选 permalink。终态 fan-out 的内部 event 可带 `elapsed_sec`，仅供 Human Notification 的极简提醒使用。

debug information 与上述两者分离：heartbeat 的 `elapsed_ms`、本地日志以及诊断错误只用于 Relay 主机观测；不会改变执行状态、发送为 `RUNNING` 的 Slack 事件，或进入 callback。

## Execution Heartbeat v1

每个 Codex execution 在 `START` 成功发送后创建本地 execution context：`task_id`、`worker_id`、`started_at`、`current_status` 与 `last_heartbeat_at`。当执行仍为 `RUNNING` 时，Relay 每 30 秒更新 context、累计耗时。heartbeat 是本地 debug/observability 信号：仅在 `AGENT_RELAY_LOG_LEVEL=debug` 时输出到 listener terminal/log，默认 `normal` 输出会隐藏；不会向 Slack 发送周期 heartbeat 或 `RUNNING` polling。heartbeat 不会改变任务事实状态，也不会触发 Browser Callback。终态 `DONE`、`BLOCKED` 或 `FAILED` 会先停止并清理 timer，再发送带最终耗时的 `CODEX_STATUS`。timer 使用 `unref()`，不会阻止 Node 正常退出。

debug 日志示例：

```text
[HEARTBEAT]
task_id=TASK-057
worker=worker-1
elapsed=03m30s
```

终态 `CODEX_STATUS` 是 Slack 的审计摘要：保留任务、路由、耗时、本地 Git commit 和工作区 diff 汇总；worker 明确报告执行测试时也记录简短结论。它不复制完整 stdout、stderr 或 heartbeat。`FAILED` 与 `BLOCKED` 使用同一组审计字段，并将简短失败原因写入 `reason`。若任务请求 Browser Evidence，终态还会写入 Slack 的 `evidence_file_id`，以及在 Slack 返回时可获得的 `evidence_permalink`；附件本体仍只保存在 Slack 文件中。

终态 `DONE` 示例：

```text
CODEX_STATUS
schema_version: 1
task_id: TASK-063
status: DONE
worker: worker-1
workspace: workspace-1
repo: example-app
duration: 00m42s
git_commit: abc1234
git_diff_summary: 2 changed file(s), +12/-3
test_result: passed
summary: |
  已完成状态审计摘要模板与回归。
```

## 安装与启动

要求 Node.js 20+、npm、Codex CLI，以及已配置的 allowlisted repository。

```powershell
npm install
Copy-Item .env.example .env
New-Item -ItemType Directory -Force .agent-relay | Out-Null
Copy-Item projects.example.json .agent-relay\projects.json
npm start
```

配置统一使用 `AGENT_RELAY_*` 命名；`.env` 与 `.agent-relay/projects.json` 仅供本地使用，不会上传。把 `projects.example.json` 复制到 `.agent-relay/projects.json` 后填入本机 workspace id、repo id 与绝对路径。

## Browser Callback PoC

V5.7 的 Browser Runtime 以 Relay 专用 persistent profile 启动一个可见的原生 Chromium/Chrome，并通过仅限 loopback 的 CDP 连接 Browser Callback。它不复用日常浏览器 profile、Cookie、storage 或 tab；首次登录、验证码与 MFA 完全由用户在正常浏览器窗口中完成。控制页和 callback target 都绑定到由 profile 派生的稳定 `browser_context_id`。

callback target 只能在其所属 context 中 resolve；context 缺失会在启动前拒绝，target 的 context 与当前 Relay context 不匹配时 callback 安全失败为 `callback_target_context_mismatch`。callback 不包含页面内容，也不会扩展 `CODEX_TASK` schema；它只处理终态唤醒、目标路由和可选的 Slack 证据检索元数据。

创建 Relay 管理的隔离 context：

```powershell
npm run browser:init
```

该命令是 Relay 主机上用于首次初始化和人工登录的独立入口：它以普通 Edge/Chromium 进程（不是 Playwright 自动化上下文）加载或创建 Relay 专用 persistent profile，并打开 allowlisted ChatGPT `start_url`。这样真人验证与扫码登录由正常浏览器处理；Relay 不会自动填写账号、密码或 MFA，也不会操作 ChatGPT。认证状态只报告 `unknown`，由用户在页面确认；完成后直接关闭浏览器窗口。

需要 Browser Callback 控制页时，再单独运行：

```powershell
npm run browser-callback -- runtime
```

可通过本机环境变量或启动参数配置专用 profile 与初始页面；`start_url` 仅接受 allowlisted 的 ChatGPT URL，不能用于自动登录、密码或 MFA。profile 必须是 Relay 专用目录，绝不可指向日常浏览器的 user-data directory：

```powershell
$env:AGENT_RELAY_BROWSER_PROFILE_PATH="<ABSOLUTE_RELAY_PROFILE_PATH>"
$env:AGENT_RELAY_BROWSER_START_URL="https://chatgpt.com/"
npm run browser:init
# 或：npm run browser:init -- --profile <ABSOLUTE_RELAY_PROFILE_PATH> --start-url https://chatgpt.com/
```

同一 profile 会生成稳定的 `browser_context_id`。Browser Callback 重启时，若该 profile 中仍存在唯一匹配、已 Arm 的 conversation，便会恢复 Bound/Armed；目标页不存在、离开 allowlisted origin 或出现歧义时才要求人工重新授权。它不会猜测、搜索或回退到其他 tab，也不会自动发送任何内容。

### Browser Page Binding

在 `managed` 模式，用户第一次在控制页对目标 ChatGPT conversation 点击 `Bind` 后，Relay 会将页面 identity 保存到本机 `.agent-relay/browser-page-binding.json`，并按 Relay 专用 `profile_path` 隔离。identity 固定包含 `origin`、`pathname` 与仅供诊断的 `title`；不会保存 page object、tab index 或数组位置。

后续启动同一 profile 时，Relay 枚举该 context 的页面，并只以 `origin + pathname` 找回 identity：唯一匹配时 `/api/state` 的 `page_binding.state` 为 `RESTORED`，且不会再导航到 `start_url`；找不到时为 `REBIND_REQUIRED`；出现多个相同 conversation 页面时为 `AMBIGUOUS`。后两种情况均要求用户显式重新 Bind，Relay 不会按 title、tab 顺序、Project 搜索或 ChatGPT UI 推断自动选择页面。Bind 仍不会 Arm 或发送任何内容。

Windows launcher 使用固定的 `process.execPath` 执行 npm 的 `npx-cli.js`，不调用 `.cmd` shim；官方 `@playwright/cli@latest` existing-browser channel attach 使用固定 session `relay-poc`、`shell:false` 和当前 repository cwd。只支持 `msedge` 与 `chrome`，不扫描端口，不读取 profile、cookie、storage 或 state-save。

控制页只展示 allowlisted ChatGPT 页面。页面 identity 为 origin + conversation pathname；每次刷新和发送前都会重新核对该 identity，CLI 操作会先对对应的真实 tab 执行官方 `tab-select <index>`，然后才使用可见 textarea 和 Enter。非 ChatGPT tab 会保留其真实 tab index，不会因过滤展示列表而错选当前 tab。

Browser Evidence 与 Callback 完全使用不同的浏览器实例：Evidence 每次启动独立 headless Chromium，直接导航至任务中已验证的 allowlisted 本地 URL 后截图并关闭。它不依赖 ChatGPT Page Binding，不能枚举、读取、复用或修改 ChatGPT tab、profile、Cookie、session 或 conversation identity；截图仍只写入目标项目被忽略的 `.agent-relay/evidence/<TASK_ID>/`。

### Browser Evidence 工单约束

Browser Evidence 只能由完整的结构化字段显式授权；`instruction`、目标、验收条件或任何自然语言都不能推断浏览器访问、URL 或 viewport。三项都省略时 Relay 不截图；出现任意一项时必须同时提供全部三项，否则安全拒绝为 `invalid_browser_evidence_request`。

```yaml
browser_evidence: screenshot
browser_url: http://localhost:5173
browser_viewport: desktop
```

`browser_url` 必须是已配置的 HTTP/HTTPS loopback origin，且不得包含 credentials、query 或 fragment；`browser_viewport` 只能是 `desktop`、`intermediate` 或 `mobile`。截图目标与输出要求可以写在 `instruction` 中，但不能替代该结构化授权。

低层 API 仍将 Bind 与 Arm 分开；根控制页 `http://127.0.0.1:8787/` 提供“一键 Bind + Arm + 写入 `.env`”。用户先明确选择页面，Relay 才会注册并 Arm 该 allowlisted conversation，然后写入本机 callback URL/target。Listener 在每次终态 fan-out 前重读这两项 `.env` 配置，因此目标更新后无需重启 Listener。绑定对话离开 allowlisted origin、conversation identity 变化或目标消失时会自动 disarm，并清除待发送事件。

### Callback Target Registry v1

Browser Callback 在本机 `.agent-relay/callback-registry.json` 持久化 target。每一项为 `callback_target_id`、`platform`、`conversation_identity`、`created_at` 和独立的 `state`；`state` 只能是 `REGISTERED`、`ARMED`、`DISARMED` 或 `EXPIRED`。它不是 `task_id -> conversation` 映射，因此同一 conversation 可以在不同 Bind 生命周期注册多个 target，也可以承载多个 task。

execution 仍独立使用 `START`、`RUNNING`、`DONE`、`BLOCKED`、`FAILED`。Registry 不保存 execution 状态；只有用户 Bind/Arm 或已绑定目标失效时才改变 callback target state。

Bind 响应和控制页 state 会返回 `callback_target_id`。若将该 ID 配置给 `AGENT_RELAY_BROWSER_CALLBACK_TARGET_ID`，Relay 的终态 callback 会携带它，Browser Callback 必须先按 ID resolve 到仍为 `ARMED` 且 identity 匹配的已 Bind target 才会发送。不存在、未 Armed 或已失效的 ID 都会安全失败，不会回退到当前 tab 或其他 target。未配置该变量时保留 v1 的单个已 Bind/Arm 兼容路径。

未来自建前端可通过本机 Registry 管理 API/服务层注册 conversation identity、展示 target state，并把用户明确选择且已 Arm 的 `callback_target_id` 写入本机 Relay 配置或 task metadata。前端不能替代 Bind、Arm、origin allowlist 和发送前 identity 复核；浏览器页面对象与 tab index 不进入 Registry。

要启用 Callback Loop v1，先启动 Browser Runtime 与 Callback 控制器，再在根控制页明确选择 conversation 并点击一键授权：

```powershell
npm run browser:init
npm run browser-callback -- runtime
# 打开 http://127.0.0.1:8787/，选择目标对话并点击“一键 Bind + Arm + 写入 .env”
```

Relay 只会在 `DONE`、`BLOCKED` 或 `FAILED` 的 `CODEX_STATUS` 已成功发送并取得 Slack message receipt 后，向该 endpoint 发送 callback。基础字段是 `{ task_id, status }`，配置 target ID 时还会带上 `{ callback_target_id }`；有 Browser Evidence 时还会附上已校验的 `{ slack_channel_id, slack_status_ts, evidence_file_id, evidence_permalink? }`，供 ChatGPT 经 Slack 消费附件。它不含图片 blob、Cookie、执行日志或凭据；未取得终态 Slack receipt 时会跳过 callback 而非提前发送。Browser Callback 会沿用既有 Bind → Arm → Render → Send 流程，通过已绑定且复核过 identity 的 ChatGPT 可见输入框发出冻结的 `AGENT_RELAY_EVENT v1`。未启动、未 Armed、target 无法 resolve 或发送失败只记录本地 callback 错误，不改变或补写 Slack 生命周期。

## Human Notification

终态 fan-out 的统一事件为 `{ schema_version: 1, event: "task_terminal", task_id, status, elapsed_sec? }`。Browser Callback 与 Human Notification 使用同一个事件对象，但各自独立结算：任一分支失败只记录本机 diagnostic（`BROWSER_CALLBACK_FAILED` 或 `HUMAN_NOTIFY_FAILED`），不会取消另一分支，也不会把真实 `CODEX_STATUS` 改写为 `FAILED`。

默认 provider 为 `disabled`/noop，不发送且不报错。可通过以下本机环境变量选择 `email`：

```powershell
$env:AGENT_RELAY_NOTIFY_ENABLED="true"
$env:AGENT_RELAY_NOTIFY_PROVIDER="email"
$env:AGENT_RELAY_NOTIFY_EMAIL_TO="ops@example.com"
$env:AGENT_RELAY_NOTIFY_SMTP_HOST="smtp.example.com"
```

邮件接口只构造 `task_id`、`status`、`elapsed_sec` 的极简 subject/body，不复制 instruction、Slack 详情或环境变量。Relay 使用 Nodemailer 建立 SMTP transport；SMTP user/secret 只允许来自本机环境变量，`465` 使用 TLS，其他端口使用 STARTTLS。缺少收件人、host、port、user 或 secret 时只记录 `HOST_CONFIG_REQUIRED`，绝不影响任务或伪造“已发送”。

### Windows 真实手动 E2E

1. 执行 `npm run browser:init`，在 Relay 专用 Chromium/Chrome profile 中手动登录 ChatGPT 并打开目标 conversation；可保留另一个非 ChatGPT tab，用于验证不会误操作。
2. 在仓库目录启动本机 Runtime attach：

   ```powershell
   npm run browser-callback -- runtime
   ```

3. 打开 `http://127.0.0.1:8787/`，确认仅列出 allowlisted ChatGPT conversation，并点击目标旁的一键授权按钮。
4. 确认页面提示已完成 Bind、Arm 与 `.env` 更新；`/api/state` 应显示 `bound=true`、`armed=true`。
5. 触发 mock 或真实终态 callback，确认冻结的 `AGENT_RELAY_EVENT v1` 只通过已绑定 conversation 的可见输入框和 Enter 发送；非 ChatGPT tab 不会被操作。
6. 将绑定 conversation 导航到其他 conversation 或离开 ChatGPT origin，确认状态自动 disarm，随后发送被拒绝。
7. 重启 Browser Callback，确认同一 profile 中的唯一匹配 conversation 恢复为 Bound/Armed；关闭 Runtime 浏览器不会删除 profile 或登录状态。

### 高级 endpoint

仅当用户明确提供 browser-level WebSocket endpoint 时使用：

```powershell
$env:AGENT_RELAY_BROWSER_CDP_ENDPOINT="ws://127.0.0.1:9222/devtools/browser/<id>"
npm run browser-callback -- attach
```

endpoint 必须是本地、无认证信息、无 query/hash 的 `ws://.../devtools/browser/<id>`；HTTP endpoint、端口扫描、`DevToolsActivePort`、profile、cookie、私有 ChatGPT API/websocket、CAPTCHA 绕过和 state-save 均被禁止。

## 验证

```powershell
node --check callback-target-registry.js
node --check callback-event.js
node --check browser-callback.js
node --check browser-callback.regression.js
npm run test:browser-context
npm run test:callback-target-registry
npm run test:callback-event
npm run test:execution-heartbeat
npm run test:browser-callback
npm test
git diff --check
```

`npm run doctor` 是本地只读 readiness diagnostics，不启动浏览器、不读取 secret、不修改 `.env` 或远程服务。

## 配置与 Relay 安全边界

进程环境变量优先于 `.env`；本地 `.env` 会被忽略且不会上传。Slack 身份验证、schema 与路由 allowlist、持久化去重、单任务队列、Git/trust 校验、sandbox 限制，以及不经过 shell 的 Codex 直接调用均保持启用。Relay 不会自动 push、deploy、publish 或修改远程服务。

配置包括 `AGENT_RELAY_WORKER_ID`、`AGENT_RELAY_ALLOWED_USER_ID`、`AGENT_RELAY_CHATGPT_APP_ID`、`AGENT_RELAY_CHANNEL_ID`、`AGENT_RELAY_LOG_LEVEL` 和可选的 `AGENT_RELAY_BROWSER_EVIDENCE_*`、`AGENT_RELAY_BROWSER_CALLBACK_URL`、`AGENT_RELAY_GROK_BIN`；仓库 allowlist 放在被忽略的 `.agent-relay/projects.json`（从 `projects.example.json` 复制）。Slack 凭据、`CODEX_BIN` 与 `CODEX_TIMEOUT_MS` 按现有部署需要配置。Grok 登录和 API key 由 Grok CLI 的本机身份配置管理，不会由 Relay 读取或写入 Slack。

Browser Evidence 仅在 Relay 主机上运行，只访问已配置的 loopback origins，并将任务范围内的 PNG 写入被忽略的 `.agent-relay/evidence/<TASK_ID>/` 目录；它不会访问凭据、浏览器 profile、cookies 或 local storage。

## Doctor 与 Context Builder

`npm run doctor` 以本地只读方式检查 Node/npm、Git/trust、必需配置、dotenv 格式、Codex 发现/版本/认证状态、Browser Evidence 设置和回归测试；不会打印 secret、启动浏览器、修改 `.env`、Git 配置、仓库文件或远程服务。使用 `npm run doctor -- --skip-tests` 可进行更快的配置检查。

Context Builder 按固定顺序组合 Relay/task guidance、根目录 `AGENTS.md`、任务明确命中的 capability/module guidance 和完整 instruction。Context 选择只使用显式路径、文件名、模块名及稳定关键词，不使用 LLM 或语义分类；`AGENTS.md` guidance 不能替代代码强制的 Slack auth、allowlisted routing、dedup、队列、Git/trust、`shell:false`、workspace sandbox、approval、Browser Evidence loopback 与 cwd/executable 限制。
