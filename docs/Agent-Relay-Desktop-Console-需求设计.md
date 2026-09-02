# Agent Relay Desktop Console 需求设计

> 文档状态：Draft v0.2  
> 对齐基线：当前 `feature-browser-callback-poc` 分支  
> 产品边界：Desktop Console 是本机控制面与人机交互容器，不替代 Slack、`CODEX_TASK`、`CODEX_STATUS` 或 Relay 的安全决策。

## 0. Terra 执行入口

### 0.1 任务目标

在当前仓库实现 Agent Relay Desktop Console MVP。Terra 应直接检查仓库、修改代码、安装项目所需依赖、运行回归并交付可启动结果；不要只输出方案、原型图或伪代码。

完成结果必须满足：

```text
npm run console:start

-> 打开 Windows Electron Console
-> 启动或连接 Agent Relay Listener
-> 启动或连接 Relay 专用 Chrome
-> 启动或连接 Browser Callback
-> 展示真实 Runtime / Queue / Task / Browser / Callback 状态
-> 支持明确选择 ChatGPT conversation 后 Connect Callback
-> 任务运行中关闭窗口时显示保护提示
```

### 0.2 已固定决策

以下事项无需再次向用户确认：

1. 首版只支持 Windows；
2. Desktop Console 保留在本仓库，目录为 `desktop-console/`；
3. 使用 Electron、原生 HTML/CSS/JavaScript，不引入 React/Vue、CSS framework 或构建工具；
4. MVP 复用现有 Relay 专用原生 Chrome，不把 ChatGPT 登录页迁移进 Electron；
5. 中央 Browser Surface 在 MVP 中展示 Chrome 状态和打开/聚焦操作，真正 `WebContentsView` 内嵌延后；
6. Listener 状态通道使用 Node child-process IPC：Console 以 `fork()` 启动 `listener.js`，不新增未经认证的 HTTP 管理端口；
7. Browser Callback 继续使用现有 loopback HTTP API；不重写 callback target、binding 或发送逻辑；
8. Slack `CODEX_STATUS` 仍是唯一任务事实来源；Console 不创造新的执行状态；
9. Browser Evidence 保持独立 headless capture，不使用可见 Chrome；
10. 任务运行中关闭时，默认按钮是“保持运行并返回”；支持“完成后自动退出”；强制退出必须二次确认；
11. 不在本阶段实现自动更新、安装包签名、多 profile、多主机或 token cost 推算。

### 0.3 授权边界

Terra 可以直接执行以下本地操作：

- 阅读当前仓库、`AGENTS.md`、README 和相关模块；
- 在本仓库新增或修改 Desktop Console、IPC 状态、测试、README 和架构文档；
- 安装并锁定 Electron 开发依赖；
- 运行 `node --check`、`npm test`、Console regression、`npm run doctor` 和 `git diff --check`；
- 启动 Console 做本机 smoke test，但不得自动登录 ChatGPT、自动处理 MFA 或发送真实任务。

禁止：

- push、publish、deploy、创建 release 或修改远端服务；
- 读取、输出或复制 `.env`、Slack token、SMTP secret、Cookie、local storage、ChatGPT 账号信息；
- 修改现有 browser profile/session 内容；
- 放宽 allowlist、sandbox、Bind/Arm、identity revalidation 或 no-fallback；
- 为了测试而清理用户现有 `.agent-relay/`、profile、binding、registry、usage ledger 或 evidence。

### 0.4 交付文件

目标目录结构：

```text
desktop-console/
  package.json
  src/
    main.js
    preload.js
    ipc-contract.js
    process-supervisor.js
    shutdown-coordinator.js
    browser-service.js
    callback-service.js
    renderer/
      index.html
      app.js
      styles.css
  test/
    ipc-contract.regression.js
    process-supervisor.regression.js
    shutdown-coordinator.regression.js
    renderer-state.regression.js

runtime-observer.js
runtime-observer.regression.js
```

根 `package.json` 增加：

```json
{
  "scripts": {
    "console:start": "npm --prefix desktop-console start",
    "console:test": "npm --prefix desktop-console test"
  }
}
```

`npm test` 必须串入 `npm run console:test` 和 `runtime-observer.regression.js`，但 Console 测试不得启动真实 Slack、Chrome、ChatGPT 或 SMTP。

### 0.5 实施顺序

Terra 按以下顺序执行，并在每个工作包完成后运行对应测试。除非出现需要用户授权的外部写入、破坏性操作或无法从仓库确定的产品冲突，不要中途停下来等待确认。

#### WP1：Runtime Observer 与 Listener IPC

新增 `runtime-observer.js`，作为无 Electron 依赖的纯状态模块。

状态快照固定为：

```json
{
  "schema_version": 1,
  "relay": { "state": "STARTING", "worker_id": null, "started_at": null },
  "queue": { "running": 0, "queued": 0 },
  "task": null,
  "browser_evidence": { "state": "IDLE", "task_id": null },
  "last_terminal": null
}
```

允许值：

```text
relay.state = STARTING | RUNNING | STOPPING | STOPPED | FAILED
task.status = START | RUNNING | DONE | FAILED | BLOCKED
browser_evidence.state = IDLE | CAPTURING | UPLOADING | UPLOADED | FAILED
```

`task` 在运行时包含：

```json
{
  "task_id": "TASK-102",
  "agent": "codex",
  "workspace": "workspace-1",
  "repo": "agent-relay",
  "status": "RUNNING",
  "started_at": "ISO-8601",
  "elapsed_ms": 12000,
  "activity": "执行测试"
}
```

`activity` 必须来自现有脱敏 progress event；没有可靠 activity 时为 `null`。不得生成 percentage。

Listener 仅在 `typeof process.send === "function"` 时发送：

```json
{ "type": "agent-relay:runtime-state", "payload": {} }
```

触发点至少包括 startup、ready、enqueue、dequeue、task START/RUNNING、heartbeat/activity、Evidence capture/upload、terminal、shutdown/failure。独立执行 `npm start` 时行为必须保持不变。

Listener 接受的 IPC command 仅有：

```json
{ "type": "agent-relay:request-state" }
{ "type": "agent-relay:shutdown", "mode": "when-idle" }
{ "type": "agent-relay:shutdown", "mode": "force" }
```

`when-idle` 在当前任务和队列清空后停止 Slack app；`force` 必须走统一 shutdown path，不能直接伪造 `DONE`。若现有 Listener 无法可靠发送正在运行任务的终态，Console 必须把该风险显示在二次确认中，不能声称已安全失败。

WP1 验收：

```powershell
node --check runtime-observer.js
node --check listener.js
node runtime-observer.regression.js
npm test
```

#### WP2：Electron Shell 与 Process Supervisor

创建 `desktop-console/` 独立 package。Electron Main Process 负责进程生命周期，Renderer 无 Node 权限。

`BrowserWindow` 必须设置：

```js
{
  webPreferences: {
    preload: absolutePreloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  }
}
```

Process Supervisor 管理三项能力：

```text
listener          -> fork(<repo>/listener.js, ipc enabled)
browser-runtime   -> spawn node browser-runtime-init.js
browser-callback  -> spawn node browser-callback.js runtime
```

规则：

- 启动前检查现有 Browser Runtime Registry/CDP，能复用则不创建第二个 Chrome；
- callback 端口已由正确 runtime 占用时连接，不创建第二个 controller；
- Listener 不允许重复启动；
- 子进程退出要记录 component、exit code、signal 和脱敏 error；
- Renderer reload 不重启子进程；
- `app.requestSingleInstanceLock()` 防止重复 Console；
- Main Process 不向 Renderer 暴露环境变量或原始 stdout/stderr。

WP2 验收：

```powershell
npm run console:test
npm run console:start
```

Smoke test 只确认窗口、进程状态与错误展示；不得自动操作 ChatGPT。

#### WP3：Browser 与 Callback 集成

`browser-service.js`：

- 读取 `BrowserRuntimeRegistry` 的非敏感状态；
- 通过 CDP `/json/version` 判断连接；
- 启动或复用现有 Relay Chrome；
- Windows 下提供聚焦浏览器能力；若无法安全识别窗口，只提供“浏览器已运行”并允许用户从任务栏切换，不得聚焦任意 Chrome；
- 不读取 profile 内任何文件。

`callback-service.js` 复用现有：

```text
GET  http://127.0.0.1:8787/api/state
POST http://127.0.0.1:8787/api/bind-arm-configure
```

Connect Callback UI 必须：

1. 获取 allowlisted pages；
2. 没有 page 时提示用户先在 Relay Chrome 打开 ChatGPT conversation；
3. 多个 page 时要求用户明确选择；
4. POST 精确 `page_id`；
5. 回读 `/api/state`；
6. 只有 `bound=true`、`armed=true` 且 target state 为 `ARMED` 时显示成功。

不得调用 `/api/bind` 后在 UI 内假设 Arm 成功，也不得选择列表第一项作为隐式 fallback。WP3 测试必须 mock loopback HTTP，不连接真实 browser。

#### WP4：Renderer、任务状态与清透视觉

首屏布局固定为：

```text
┌─────────────────────────────────────────────────────┐
│ Relay ●  Browser ●  Callback ●             Settings │
├──────────────┬──────────────────────────┬───────────┤
│ Projects     │ Current Task / Browser   │ Activity  │
│ Queue        │ Surface                  │ Evidence  │
│ Recent Tasks │                          │ Usage     │
├──────────────┴──────────────────────────┴───────────┤
│ Local · worker · version · diagnostics              │
└─────────────────────────────────────────────────────┘
```

要求：

- 当前任务优先显示 task ID、agent、repo、status、elapsed、activity 和 queue；
- 没有 activity 时显示“任务执行中”，不显示百分比；
- Evidence capture/upload 与 worker RUNNING 明确区分；
- Slack 详情是审计入口，Console 不复制完整 instruction/log；
- UI 中不出现虚构项目、虚构 token、虚构任务或装饰性 dashboard 指标；
- Connect Callback 是 callback 区域唯一主要操作；
- Browser Surface MVP 显示状态、已绑定 conversation identity 的安全摘要、启动/聚焦按钮，不嵌入 ChatGPT。

视觉实现使用 CSS variables，至少定义浅色/深色：

```css
:root {
  color-scheme: light dark;
  --console-bg: light-dark(#f4f8fc, #10151d);
  --console-surface: light-dark(rgba(255,255,255,.72), rgba(24,31,42,.76));
  --console-text: light-dark(#172033, #edf4ff);
  --console-muted: light-dark(#66758a, #9eabba);
  --console-border: light-dark(rgba(83,112,151,.16), rgba(174,199,232,.14));
}
```

允许低强度 `backdrop-filter`，但必须有不透明 fallback。禁止大面积渐变、厚阴影、霓虹、高饱和背景、嵌套卡片和无意义 KPI。状态不能只靠颜色表达。

#### WP5：关闭保护与恢复

当 task 为 `START/RUNNING`，或 Evidence 为 `CAPTURING/UPLOADING` 时，任何退出入口都显示同一 modal：

```text
任务仍在执行

TASK-102 · Codex · agent-relay
RUNNING · 00m12s

[保持运行并返回]  [完成后自动退出]  [立即强制退出…]
```

- Escape、关闭 modal、默认按钮：保持运行；
- 完成后自动退出：窗口可最小化，等待 task terminal + Evidence + terminal Slack receipt + fan-out settled，再优雅停止进程；
- 立即强制退出：第二个确认 modal，明确可能缺少 Slack 终态；
- 窗口关闭、应用菜单、托盘退出、系统退出请求复用同一个 coordinator；
- 测试覆盖所有状态和选择，不启动真实进程。

#### WP6：文档、验证与交付

更新根 README，增加安装、`npm run console:start`、原生 Chrome MVP 边界、关闭保护、本机数据/凭据边界和已知限制。

最终必须运行：

```powershell
node --check listener.js
node --check runtime-observer.js
npm run console:test
npm test
npm run doctor
git diff --check
```

`npm run doctor` 若只因仓库 ownership 等既有本机环境问题失败，必须准确说明；不得修改全局 Git 配置绕过。

### 0.6 完成定义

只有同时满足以下条件才可报告完成：

- Console 可从根命令启动；
- Renderer 无 Node/环境变量访问；
- Listener 独立启动兼容；
- UI 显示真实 task/queue/activity/evidence 状态；
- Connect Callback 需要明确 page selection 并回读 ARMED；
- 运行中关闭提示和完成后自动退出有回归；
- 不读取/修改现有 browser profile 内容；
- 所有新增测试与既有 `npm test` 通过；
- 最终报告列出改动文件、实际验证、未验证的真人登录/窗口行为和剩余风险。

Terra 的最终回复格式：

```text
状态：DONE | FAILED | BLOCKED
实现：<完成的工作包>
验证：<执行的命令与结果>
未验证：<只能由用户在 Windows GUI/ChatGPT 登录环境验证的项目>
风险：<剩余限制>
改动文件：<文件列表>
```

## 1. 背景与现状

Agent Relay 当前已经具备：

- 通过 Slack Socket Mode 接收 `CODEX_TASK v1`；
- 用户、频道、worker、workspace、repo allowlist、schema、去重和单任务队列；
- 显式选择 Codex（默认）或 Grok Build，不自动路由、不失败回退；
- `START -> RUNNING -> DONE | FAILED | BLOCKED` 生命周期；
- 本机 heartbeat、Git/test/status audit 和 Usage Accounting；
- Relay-host-only Browser Evidence：独立 headless Chromium 截图并上传 Slack；
- Relay 专用原生 Chrome persistent profile、人工登录、Page Binding、Callback Target Registry；高级 attach 仍兼容 Chrome/Edge channel；
- Browser Callback：终态 Slack receipt 成功后唤醒已 Bind + Arm 的 ChatGPT conversation；
- 可选 SMTP Human Notification；
- `AGENT_RELAY_HEALTH` Slack 探活。

当前浏览器链路是多个独立进程：

```text
npm start                         -> Slack Listener / Worker Runtime
npm run browser:init              -> Relay 管理的原生 Chrome
npm run browser-callback -- runtime -> loopback Callback Controller
http://127.0.0.1:8787/            -> Bind + Arm + 本机 .env 配置
```

Desktop Console 的价值不是重新实现这些能力，而是提供统一、可恢复、可诊断的本机入口。

## 2. 产品定位

Agent Relay Desktop Console 是本地桌面控制面，负责：

1. 启动、停止和观察 Relay 相关进程；
2. 展示 Relay、worker、队列、浏览器和 callback 的真实状态；
3. 提供人工登录、选择 conversation 和 Connect Callback 的入口；
4. 展示从 Relay 产生的最小审计摘要；
5. 保持凭据、浏览器身份和安全决策在现有 Relay 边界内。

它不是：

- Slack 的替代入口或第二套任务协议；
- 远程管理后台；
- 自动登录器、密码管理器或 MFA 处理器；
- 可以绕过 Bind、Arm、origin allowlist、repo allowlist 或 sandbox 的管理员工具；
- Browser Evidence 的执行者。

Slack 的终态 `CODEX_STATUS` 仍是唯一任务事实来源；Console 的状态是本机投影，不自行判定任务成功或失败。

## 3. 目标与非目标

### 3.1 MVP 目标

- 单一桌面入口启动 Listener、Browser Runtime 和 Browser Callback；
- 清楚区分 `Stopped`、`Starting`、`Running`、`Degraded`、`Stopping`、`Failed`；
- 展示当前 task、选定 agent、队列长度、运行时长和最近终态；
- 展示浏览器 profile、CDP 连通性、绑定状态和 callback target 状态；
- 一个显式按钮完成“选择当前 conversation → Bind → Arm → 保存本机 callback 配置”；
- 支持打开/聚焦 Relay 管理的原生 Chrome；
- Console 关闭时执行有界、可诊断的优雅退出；
- 不读取或展示 Slack token、SMTP secret、Cookie、local storage 或 ChatGPT 账号信息。

### 3.2 MVP 非目标

- 不从 Console 创建或编辑 `CODEX_TASK`；
- 不自动选择 Codex/Grok；
- 不提供 token cost 推算，仅展示 CLI 实际返回的 token usage；
- 不支持多 profile、多 Relay 主机或远程控制；
- 不修改 Browser Evidence 的 headless、loopback、artifact 边界；
- 不承诺 Electron 内嵌 ChatGPT 登录，除非完成真人验证、session persistence 和 callback adapter 的独立验证。

## 4. 关键架构决策

### 4.1 Console 不直接 import `listener.js`

当前 Listener 是可执行进程，包含配置加载、Socket Mode、队列和子进程管理。Electron Main Process 不应直接 `require()` 它，否则 Listener 异常可能拖垮 UI，开发热重载也可能重复注册 Slack handler。

MVP 使用受控子进程；Listener 为了获得双向 IPC，必须由 Electron Main 直接 `fork()`：

```text
Electron Main Process
  ├─ fork listener.js
  ├─ spawn npm run browser:init
  └─ spawn npm run browser-callback -- runtime
```

后续可将 Listener 抽取为 `createRelayRuntime()`，但这不是 Desktop Console MVP 的前置条件。

### 4.2 增加本机 IPC Control Plane，而不是解析 stdout

Console 不应依靠终端文本猜状态。Listener 在存在 Node IPC channel 时输出有版本的机器可读快照；通过 `npm start` 独立运行时不创建 IPC，也不改变现有行为：

```json
{
  "schema_version": 1,
  "relay": { "state": "RUNNING", "worker_id": "..." },
  "queue": { "running": 1, "queued": 0 },
  "task": { "task_id": "TASK-...", "agent": "codex", "status": "RUNNING" },
  "browser": { "state": "CONNECTED", "profile_id": "..." },
  "callback": { "state": "ARMED", "target_id": "target-..." }
}
```

约束：

- 只接受父进程 IPC 中固定 schema 的 request-state/shutdown command；
- 不开放新的 Listener HTTP/TCP 管理端口；
- 不返回 token、secret、Cookie、完整 instruction、stdout/stderr 或页面 DOM；
- mutation 使用明确命令并返回结构化结果；
- Slack `AGENT_RELAY_HEALTH` 继续用于跨实例探活，不作为桌面 UI 的内部轮询 API。

### 4.3 浏览器采用可替换呈现适配层

当前生产可用路径是原生 Chrome + persistent profile + loopback CDP；高级 attach 代码仍保留 Chrome/Edge channel 兼容。Electron `WebContentsView` 不是该路径的直接替换：它使用 Electron Chromium/session，可能改变真人验证表现、profile 格式、CDP target 和 callback page adapter。

因此定义两种呈现模式：

```text
BrowserSurface
  ├─ NativeManagedBrowser（MVP，复用现有实现）
  └─ ElectronWebContents（实验性，验证通过后启用）
```

MVP 中 Console 提供浏览器占位区域、状态、打开/聚焦按钮；原生 Chrome 可以独立显示。若需要“近似内嵌”体验，可在 Windows 专项阶段增加跟随移动/缩放的受控窗口停靠，但不能让窗口定位逻辑进入 Browser Callback 的安全判断。

真正启用 `WebContentsView` 前必须通过：

- ChatGPT 人工登录和真人验证；
- `persist:agent-relay` session 的关闭后恢复；
- conversation identity 唯一匹配；
- Bind/Arm/revalidation/no-fallback 全回归；
- Browser Evidence 仍使用独立 headless 浏览器；
- Electron 升级后的 session/profile 迁移策略。

### 4.4 Browser Identity 与 Notification Credential 分离

- Browser Identity：浏览器 profile/session，由用户人工登录形成；
- Notification Credential：SMTP provider user/secret；
- Slack Credential：Bot/App token；
- Worker Identity：Codex/Grok CLI 本机登录或 API 配置。

Console 只显示各能力的 `configured / connected / unavailable`，不显示凭据值，也不把邮箱绑定到 ChatGPT account。

## 5. 总体架构

```text
┌────────────────────────────────────────────────────────────┐
│ Agent Relay Desktop Console                               │
│                                                            │
│ Renderer（无 Node 权限）                                   │
│  ├─ Runtime / Queue / Task 状态                             │
│  ├─ Browser Surface                                        │
│  ├─ Connect Callback                                       │
│  └─ Diagnostics                                            │
│                    │ allowlisted IPC                        │
│ Electron Main      ▼                                        │
│  ├─ Process Supervisor                                     │
│  ├─ Runtime IPC Client                                     │
│  ├─ Browser Surface Adapter                                │
│  └─ Graceful Shutdown Coordinator                          │
└────────────────────┬───────────────────────────────────────┘
                     │ loopback control / child process
┌────────────────────▼───────────────────────────────────────┐
│ Agent Relay Host Runtime                                   │
│  ├─ Slack Listener / Parser / Allowlist / Dedup / Queue     │
│  ├─ Agent Router -> Codex | Grok Build                     │
│  ├─ Execution State / Usage Accounting / Status Audit       │
│  ├─ Browser Runtime + Page Binding + Callback Registry      │
│  ├─ Browser Evidence（独立 headless）                       │
│  └─ Terminal Fan-out -> Callback | Email                   │
└────────────────────────────────────────────────────────────┘
```

## 6. 功能需求

### 6.1 启动与就绪

启动顺序：

```text
Console Main
  -> 读取非敏感本机配置
  -> 启动/连接 Listener
  -> 等待 Relay readiness
  -> 启动/连接 Browser Runtime
  -> 等待 CDP endpoint
  -> 启动/连接 Browser Callback
  -> 展示 READY 或 DEGRADED
```

要求：

- 每一步有独立状态、超时、错误码和重试按钮；
- Browser/Callback 失败不伪装成 Relay 已停止；
- Email disabled 不降低 Relay readiness；
- Grok 未安装只影响 `agent: grok` 任务，不阻止默认 Codex；
- 禁止启动两个 Listener、两个相同 profile browser 或两个占用同一 callback port 的实例；
- 开发模式热重载 Renderer 时不得重启 Listener。

### 6.2 Runtime Dashboard

至少展示：

- Relay：状态、worker ID、启动时间、版本；
- Queue：running/queued 数量；
- Current Task：task ID、agent、workspace、repo、状态、elapsed；
- Last Terminal：task ID、`DONE|FAILED|BLOCKED`、duration；
- Usage：实际返回的 input/cached/output/reasoning/total token；缺失显示 `unavailable`；
- Browser Evidence：disabled/idle/capturing/uploaded/failed；
- Callback：disconnected/bound/armed/delivering/failed；
- Human Notification：disabled/configured/last delivery failed。

Console 不显示完整 instruction、完整 worker 日志、SMTP secret 或 Slack token。详细审计继续通过 Slack 查看。

#### 6.2.1 任务进行中状态

有任务执行时，主界面必须持续显示一个明确但不过度打扰的运行态区域：

```text
TASK-102 · Codex
RUNNING · 02m 18s
example-app
当前活动：执行测试
Queue：1 waiting
```

要求：

- `START`、`RUNNING`、`DONE`、`FAILED`、`BLOCKED` 使用 Relay 的真实 execution state，不根据进度文案推断；
- 显示 task ID、agent、workspace/repo、elapsed、队列数量和最近一次脱敏 activity；
- heartbeat 只更新本机 elapsed/last activity，不产生新的 Slack 状态；
- 无法获得细粒度 activity 时显示“任务执行中”，不得伪造百分比；
- 除非 worker 提供可验证的离散步骤，不显示 `65%` 一类估算进度；
- 任务进入终态后，运行态区域平滑切换为结果摘要，并提供“查看 Slack 详情”；
- Browser Evidence 属于 worker `DONE` 后的独立阶段，应显示为 `CAPTURING_EVIDENCE` / `UPLOADING_EVIDENCE`，终态 Slack 尚未发送前不得提前显示整体完成；
- Callback 和 Email 是终态后的独立投递结果，不得反向修改任务事实状态。

### 6.3 Browser Surface

MVP：

- 显示当前 browser executable、profile path 的脱敏名称、CDP 状态；
- 提供“启动浏览器”“聚焦浏览器”“重新连接”操作；
- 浏览器关闭后 profile 保留；
- 用户可在原生 Chrome 中人工登录、处理验证码/MFA、打开目标 conversation；
- Console 不自动填写账号、密码或发送消息。

实验性内嵌模式：

- 使用独立 persistent Electron session；
- 页面区域随窗口布局调整；
- renderer 不能访问嵌入页面 DOM、Cookie 或 storage；
- ChatGPT 页面与项目预览页使用不同 partition / permission policy；
- 不允许任意外部导航，下载、新窗口和权限请求必须显式处理。

### 6.4 Connect Callback

按钮名称：`Connect Callback`。

前置条件：

- Browser Runtime `CONNECTED`；
- 至少一个 allowlisted ChatGPT conversation；
- 用户明确选择页面；
- target 不歧义。

原子流程：

```text
Discover allowed targets
  -> user selects exact conversation
  -> validate origin + identity
  -> create/update page binding
  -> register callback target
  -> arm target
  -> persist local callback URL/target
  -> re-read state
  -> report ARMED
```

状态不能压缩成只有 `CONNECTED/DISCONNECTED`，至少保留：

```text
DISCONNECTED -> DISCOVERED -> BOUND -> ARMED
                         \-> AMBIGUOUS
                         \-> REBIND_REQUIRED
ARMED -> DISARMED | EXPIRED | FAILED
```

按钮可以合并操作，但底层 Bind 与 Arm 安全语义必须保留。任何一步失败都不能回退到当前 tab、默认 tab 或其他 conversation。

### 6.5 Browser Evidence

Console 只展示状态和 Slack 引用，不直接执行截图。现有规则保持：

- 只有完整结构化 `browser_evidence + browser_url + browser_viewport` 才授权；
- worker `DONE` 后由 Relay host 独立 headless capture；
- 只访问 allowlisted loopback origin；
- 证据保存到被忽略的 `.agent-relay/evidence/<TASK_ID>/`；
- 上传 Slack 后，终态包含 `evidence_file_id` 和可用的 permalink；
- callback 必须晚于终态 Slack receipt，并在需要时等待 Slack Evidence indexing。

### 6.6 Diagnostics

提供：

- 运行 `doctor --skip-tests` 的只读入口；
- 每个子进程最近一段经过脱敏的本机日志；
- 一键复制不含凭据的诊断摘要；
- 打开 Slack 详情、证据目录、项目目录的显式按钮；
- 错误必须包含 component、stage、code、task ID（可获得时）。

不得提供：

- 展示 `.env` 原文；
- 展示或复制 token/secret；
- UI 中执行任意 shell；
- 绕过 Git trust、sandbox、allowlist 或 approval 的“强制继续”。

## 7. 关闭与恢复

默认关闭流程：

```text
Window Close
  -> 禁止新 UI mutation
  -> Callback stop accepting delivery
  -> 等待/终止 Callback Controller
  -> 关闭 Relay 管理的 Browser process（保留 profile）
  -> Listener 停止接收新任务
  -> 当前任务按策略等待或请求用户确认
  -> 停止 Listener
  -> 清理本次 runtime record / lock
  -> Console exit
```

必须定义运行中任务策略：

- 无运行任务时可直接执行优雅关闭；
- 存在 `START`、`RUNNING`、`CAPTURING_EVIDENCE` 或 `UPLOADING_EVIDENCE` 时，关闭窗口必须先显示确认对话框；
- 对话框必须展示 task ID、agent、repo、已运行时间和当前阶段；
- 默认主操作为“保持运行并返回”，避免误触终止任务；
- 可选操作为“任务完成后自动退出”，Console 保持最小化/后台托管，终态和 fan-out 完成后再退出；
- “立即强制退出”属于危险操作，必须二次确认，并明确说明可能导致任务失败、Slack 终态发送失败或需要人工恢复；
- MVP 不提供“强制杀死并标记 DONE”；
- 若用户明确强制退出，任务必须进入可审计的 `FAILED`，并尽最大可能发送 Slack 终态；
- 进程崩溃后，下次启动检测 stale PID/lock，但只有在确认 PID 不存在或身份不匹配时清理；
- stale binding 不删除，标记 `REBIND_REQUIRED` 或 `EXPIRED`。

关闭提示示例：

```text
任务仍在执行

TASK-102 · Codex · example-app
RUNNING · 02m 18s

关闭 Console 可能中断任务和终态通知。

[保持运行并返回]  [完成后自动退出]  [立即强制退出…]
```

系统托盘退出、窗口关闭、应用菜单退出和操作系统注销事件必须复用同一套关闭协调器，不能存在绕过提示的第二条退出路径。

## 8. Electron 安全基线

- `contextIsolation: true`；
- `nodeIntegration: false`；
- Renderer 只通过 preload 暴露的 allowlisted IPC；
- IPC 参数使用 schema 校验，禁止任意命令、路径和 URL；
- Navigation、new-window、permission、download 默认拒绝，按 allowlist 开放；
- DevTools 仅开发模式启用；
- 不向 Renderer 注入 `process.env`；
- Slack、SMTP、worker credential 只存在于 Main/Relay process；
- Listener Control Plane 只使用父子进程 IPC，不开放管理端口；Browser Callback 继续限制在既有 loopback API；
- Browser profile、registry、usage ledger、logs、evidence 继续被 Git 忽略。

## 9. 视觉与交互风格

整体风格定位：简约、清透、克制，接近轻量桌面工作台，而不是高密度运维后台。

### 9.1 视觉原则

- 以浅色、中性低饱和背景为默认主题，同时支持系统深色模式；
- 使用轻微透明度、柔和层次和有限的背景模糊表达空间关系，但不牺牲文字对比度；
- 主界面保持充足留白，边框细且低对比，不使用厚重阴影、强渐变或大面积高饱和色；
- 状态色只用于关键状态：运行、成功、警告、失败；同一状态在全局保持一致；
- 运行中使用稳定的呼吸点或细进度轨迹，避免循环旋转、闪烁和持续位移动画；
- 动效短促、可中断，并遵循系统 `prefers-reduced-motion`；
- 中文说明为主，技术标识、状态和命令保留英文。

### 9.2 信息层级

```text
顶部：Relay / Browser / Callback 全局连接状态
中央：当前任务与主要工作区域
侧栏：项目、队列、最近任务
底部：简洁诊断、版本和本机状态
```

- 当前任务是最高视觉优先级；无任务时中央区域保持安静，不填充无意义指标；
- Token Usage、Evidence、Audit 等次级信息按需展开，不长期占据主视图；
- 错误信息直接说明 component、stage 和可行动建议，不使用只有颜色或图标的提示；
- 危险操作与日常操作保持明显距离，强制退出不得成为默认按钮。

### 9.3 清透效果边界

- 透明和 blur 只用于 Console 自身 chrome、浮层和状态面板；
- ChatGPT 页面、项目预览页和终端区域保持不透明，保证内容可读且避免视觉混叠；
- Windows 不支持或用户关闭透明效果时，必须降级为等价的纯色表面；
- 任何主题下正文、次要文字、边框和状态都必须满足可读性要求；
- 不通过透明层暴露其后方窗口中的凭据、通知或私人内容。

## 10. 开发计划

### Phase 0：Runtime IPC 可观测性接口

- 定义 `agent-relay:runtime-state` snapshot 与 command schema；
- 为 Listener、Queue、Task、Usage、Evidence、Callback 暴露只读状态；
- 增加受限 start/stop/connect mutation；
- 加入 IPC 来源、schema、独立 Listener 兼容和 secret-redaction 回归。

### Phase 1：Console Shell

- Electron Main/Preload/Renderer；
- Process Supervisor；
- Runtime 状态和 Diagnostics；
- 开发热重载不影响 Listener；
- 原生 Chrome 启动/聚焦。

### Phase 2：Callback Integration

- 页面发现与明确选择；
- Connect Callback 原子流程；
- 完整 target state；
- restart restore、ambiguity、identity drift 和 no-fallback 回归。

### Phase 3：Task Dashboard

- 当前任务、队列、agent、elapsed；
- 最近终态、token usage、evidence、notification；
- Slack 详情跳转；
- 不复制 Slack 的完整审计正文。

### Phase 4：Browser Surface 实验

- 先验证 Electron ChatGPT 登录、人机验证和 session persistence；
- 实现 `ElectronWebContents` adapter；
- 与 Native Managed Browser 做行为一致性测试；
- 通过安全/兼容性验收后再决定是否默认内嵌。

## 11. 验收标准

### 启动

- [ ] 双击启动后，Listener、Browser Runtime、Callback Controller 状态可分别观察；
- [ ] 重复启动不会产生重复 Listener、重复 browser profile owner 或端口冲突；
- [ ] 缺少可选 Email/Grok 时显示降级，不影响 Codex 基本执行；
- [ ] Renderer 热重载不重启任务执行进程。

### 浏览器

- [ ] 首次人工登录后，关闭并重启仍可复用有效 session；
- [ ] Console 能启动、聚焦和安全关闭 Relay 专用原生 Chrome；
- [ ] 不读取或展示 Cookie、账号、local storage；
- [ ] Browser Evidence 不连接该可见浏览器。

### Callback

- [ ] 用户明确选择 conversation 后，一个按钮完成 Bind + Arm；
- [ ] ARMED 状态来自 Controller 回读，不由 UI 乐观假设；
- [ ] 错误 origin、identity drift、target ambiguity、missing target 均拒绝；
- [ ] 不回退到当前/默认/其他 tab；
- [ ] callback 仅在终态 Slack receipt 后触发；
- [ ] 有 Evidence 时 ChatGPT 可通过 Slack 引用读取附件。

### Task 与状态

- [ ] UI 状态与 Slack `CODEX_STATUS` 一致；
- [ ] worker 显式 `FAILED/BLOCKED` 不显示为 `DONE`；
- [ ] Codex/Grok agent 展示正确，不自动 fallback；
- [ ] token usage 只展示实际数据，缺失显示 `unavailable`；
- [ ] heartbeat 只作为本机观测，不伪造 Slack `RUNNING` 消息。
- [ ] 任务运行中持续显示 task ID、agent、repo、elapsed、queue 和真实 activity；
- [ ] 未获得可靠进度时不显示虚构百分比；
- [ ] Evidence capture/upload 阶段与 worker execution 阶段可区分。

### 退出与恢复

- [ ] 无运行任务时关闭 Console 不遗留 Listener/Callback/browser 进程；
- [ ] 有运行任务时必须提示，不静默终止；
- [ ] 关闭提示提供“保持运行并返回”“完成后自动退出”和经二次确认的“立即强制退出”；
- [ ] 系统托盘、窗口按钮和应用菜单使用相同关闭协调逻辑；
- [ ] profile、binding 和 registry 保留且不进入 Git；
- [ ] stale runtime record 可检测、可解释、安全恢复；
- [ ] 下次启动不会把失效 target 自动标记为 ARMED。

### 安全

- [ ] Renderer 无 Node 权限且拿不到环境变量；
- [ ] IPC 与 loopback API 均有 schema、allowlist 和鉴权；
- [ ] Console 无任意 shell、任意 URL、任意路径能力；
- [ ] 日志、诊断、崩溃报告不含 token、secret、Cookie 或完整 `.env`；
- [ ] `npm test`、`npm run doctor`（允许已知环境项）和 Console E2E 通过。

### 视觉与可用性

- [ ] 浅色与深色模式均保持清晰对比和一致状态色；
- [ ] 透明/模糊不可用时可以无功能损失地降级；
- [ ] 320px 以上窄窗口不出现关键操作遮挡，常规桌面尺寸无横向滚动；
- [ ] 动效遵循 reduced-motion，任务状态不依赖动画或颜色单独表达；
- [ ] 当前任务优先级清晰，空闲状态不展示无意义 dashboard 填充。

## 12. 后续扩展

- 多 Relay 主机与 worker 概览；
- Task Timeline；
- token 趋势与额度展示（不在缺少价格来源时估算成本）；
- 多 Browser Profile 与明确身份切换；
- Agent Permission Center；
- Local Memory Viewer；
- 自建项目预览浏览器，与 ChatGPT Browser Identity 使用独立 partition；
- Console 自动更新、签名和崩溃恢复。

## 13. 已收敛的产品决策

- MVP 使用 Console 管理的独立原生 Chrome，不实施 `WebContentsView`；
- Console 关闭时提供保持运行、完成后退出、二次确认强制退出；
- Listener 状态使用 Electron Main 与 child process IPC；
- 首版只支持 Windows；
- Desktop Console 位于当前仓库的 `desktop-console/`；
- 未来项目预览浏览器与 ChatGPT Browser Identity 使用不同 partition，不共享 session。
