# Agent Relay

Agent Relay 是本地、按 allowlist 控制的 Slack-to-Codex 执行中继。稳定协议名称是 `CODEX_TASK` 和 `CODEX_STATUS`。Browser Callback PoC 只执行人工 mock callback，不接入真实 `CODEX_STATUS` 自动触发。

## 安装与启动

要求 Node.js 20+、npm、Codex CLI，以及已配置的 allowlisted repository。

```powershell
npm install
Copy-Item .env.example .env
npm start
```

配置统一使用 `AGENT_RELAY_*` 命名；`.env` 仅供本地使用，不会上传。

## Browser Callback PoC

Windows launcher 使用固定的 `process.execPath` 执行 npm 的 `npx-cli.js`，不调用 `.cmd` shim；官方 `@playwright/cli@latest` existing-browser channel attach 使用固定 session `relay-poc`、`shell:false` 和当前 repository cwd。只支持 `msedge` 与 `chrome`，不扫描端口，不读取 profile、cookie、storage 或 state-save。

控制页只展示 allowlisted ChatGPT 页面。页面 identity 为 origin + conversation pathname；每次刷新和发送前都会重新核对该 identity，CLI 操作会先对对应的真实 tab 执行官方 `tab-select <index>`，然后才使用可见 textarea 和 Enter。非 ChatGPT tab 会保留其真实 tab index，不会因过滤展示列表而错选当前 tab。

Bind 与 Arm 是两个独立的用户操作：Bind 只保存目标对话，Arm 才开启发送权限；未 Armed 时 callback 和 send 都会被拒绝。绑定对话离开 allowlisted origin、conversation identity 变化或目标消失时会自动 disarm，并清除待发送事件。

### Windows Edge 真实手动 E2E

1. 在正常 Microsoft Edge 中登录 ChatGPT，并打开目标 conversation；同时保留另一个非 ChatGPT tab（例如 Bilibili），用于验证不会误操作当前 tab。
2. 打开 `edge://inspect/#remote-debugging`，显式启用 “Allow remote debugging for this browser instance”。
3. 在仓库目录启动官方 channel attach：

   ```powershell
   npm run browser-callback -- attach --channel msedge
   ```

   不要传入 HTTP endpoint。
4. 打开 `http://127.0.0.1:8787`，确认列表只显示 allowlisted ChatGPT conversation，并确认页面显示 `Bind`。
5. 点击目标 conversation 的 `Bind`，确认状态为“已 Bind，未 Armed”；此时点击发送或渲染 callback 应被拒绝。
6. 点击独立的 `Arm 已绑定对话`，确认状态为 `已 Armed`。
7. 在 mock callback 中输入 `TASK-POC-001`，选择 `DONE`，点击“渲染事件”，确认显示冻结的 `AGENT_RELAY_EVENT` v1 JSON。
8. 点击“发送到已绑定对话”，确认事件只通过已绑定 ChatGPT conversation 的可见 UI 输入框和 Enter 发送；确认 Edge 不会被切换到 Bilibili。
9. 将绑定 conversation 导航到其他 conversation 或离开 ChatGPT origin，确认状态自动回到未 Armed，随后发送被拒绝。
10. 按 `Ctrl+C` 停止 relay；这不会关闭或清理用户浏览器，也不会修改登录状态。

Chrome 的手动 E2E 与上述步骤相同，将 `msedge`/`edge://inspect` 替换为 `chrome`/`chrome://inspect`。

### 高级 endpoint

仅当用户明确提供 browser-level WebSocket endpoint 时使用：

```powershell
$env:AGENT_RELAY_BROWSER_CDP_ENDPOINT="ws://127.0.0.1:9222/devtools/browser/<id>"
npm run browser-callback -- attach
```

endpoint 必须是本地、无认证信息、无 query/hash 的 `ws://.../devtools/browser/<id>`；HTTP endpoint、端口扫描、`DevToolsActivePort`、profile、cookie、私有 ChatGPT API/websocket、CAPTCHA 绕过和 state-save 均被禁止。

## 验证

```powershell
node --check browser-callback.js
node --check browser-callback.regression.js
npm run test:browser-callback
npm test
git diff --check
```

`npm run doctor` 是本地只读 readiness diagnostics，不启动浏览器、不读取 secret、不修改 `.env` 或远程服务。

## 配置与 Relay 安全边界

进程环境变量优先于 `.env`；本地 `.env` 会被忽略且不会上传。Slack 身份验证、schema 与路由 allowlist、持久化去重、单任务队列、Git/trust 校验、sandbox 限制，以及不经过 shell 的 Codex 直接调用均保持启用。Relay 不会自动 push、deploy、publish 或修改远程服务。

配置包括 `AGENT_RELAY_WORKER_ID`、`AGENT_RELAY_ALLOWED_USER_ID`、`AGENT_RELAY_CHATGPT_APP_ID`、`AGENT_RELAY_CHANNEL_ID`、`AGENT_RELAY_ATELIER_OF_MEMORY_PATH`、`AGENT_RELAY_PATH`、`AGENT_RELAY_LOG_LEVEL` 和可选的 `AGENT_RELAY_BROWSER_EVIDENCE_*`；Slack 凭据、`CODEX_BIN` 与 `CODEX_TIMEOUT_MS` 按现有部署需要配置。

Browser Evidence 仅在 Relay 主机上运行，只访问已配置的 loopback origins，并将任务范围内的 PNG 写入被忽略的 `.agent-relay/evidence/<TASK_ID>/` 目录；它不会访问凭据、浏览器 profile、cookies 或 local storage。

## Doctor 与 Context Builder

`npm run doctor` 以本地只读方式检查 Node/npm、Git/trust、必需配置、dotenv 格式、Codex 发现/版本/认证状态、Browser Evidence 设置和回归测试；不会打印 secret、启动浏览器、修改 `.env`、Git 配置、仓库文件或远程服务。使用 `npm run doctor -- --skip-tests` 可进行更快的配置检查。

Context Builder 按固定顺序组合 Relay/task guidance、根目录 `AGENTS.md`、任务明确命中的 capability/module guidance 和完整 instruction。Context 选择只使用显式路径、文件名、模块名及稳定关键词，不使用 LLM 或语义分类；`AGENTS.md` guidance 不能替代代码强制的 Slack auth、allowlisted routing、dedup、队列、Git/trust、`shell:false`、workspace sandbox、approval、Browser Evidence loopback 与 cwd/executable 限制。
