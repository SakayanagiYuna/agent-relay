# Agent Relay 当前架构

Agent Relay 将 ChatGPT/人工规划与本地受控执行分离：

```text
ChatGPT / human -> CODEX_TASK -> Slack -> Agent Relay -> Codex -> allowlisted local repo
                                      <- CODEX_STATUS START / DONE / BLOCKED / FAILED
```

`CODEX_TASK` 和 `CODEX_STATUS` 是稳定的协议名称。当前唯一的产品和路由标识是 Agent Relay（`agent-relay`）。每台机器都保留自己的、被忽略的 `.env`、本地路径、worker ID 和去重状态。

配置使用根目录 README 中记录的 `AGENT_RELAY_*` 名称。`AGENT_RELAY_LOG_LEVEL=normal` 提供简洁的本地进度；`debug` 会额外输出脱敏的 JSON 诊断信息。启动时会校验配置、ID、路径、Git trust、Codex、sandbox 和可选的 Browser Evidence；出现错误即安全失败。

## Doctor

迁移或重新配置后可运行 `npm run doctor`。Doctor 以只读方式检查 Node/npm、Git trust 与允许列表仓库、必需配置和 dotenv 格式、Slack 只读认证、Codex 发现/版本/认证状态，以及可选 Browser Evidence 配置，并默认运行 `npm test`。输出按 `PASS`/`WARN`/`FAIL` 分组；工作树有未提交改动和关闭 Browser Evidence 属于 warning，不会单独阻止就绪。缺少必需配置、Git/Slack/Codex 检查失败、dotenv assignment 拼接错误或回归测试失败会返回退出码 `1`。Doctor 不会打印 token、认证材料或配置值，也不会修改 `.env`、Git 或仓库状态；可用 `npm run doctor -- --skip-tests` 跳过测试。

## Codex 发现与执行边界

在 Windows 上，可执行文件解析遵循 `CODEX_BIN`，然后在 PATH 中查找原生 `codex.exe`，再检查 npm-global 原生 package layout，并记录解析出的绝对路径。任务执行使用直接调用 `spawn`、`shell:false` 和 stdin；Slack 不能控制 shell、cwd、executable 或 CLI options。

## Browser Evidence

Browser Evidence 只在 Codex 完成后、Relay 主机上运行。顶层 URL 必须是 HTTP/HTTPS loopback URL，并且 origin 必须与配置的允许 origin 完全一致；URL 不得包含 credentials、query 或 fragment。证据按任务隔离，写入被忽略的 `.agent-relay/evidence/<TASK_ID>/` 目录；绝不会读取浏览器配置文件、cookies、local storage 或 credentials。浏览器运行不进入 Codex 子进程或 sandbox。

## 安全不变量

执行范围始终受 worker、workspace、仓库路由允许列表、Git trust 校验和 sandbox 设置约束；任务正文不能注入路径、shell、executable 或 CLI 参数。中继使用持久化去重和单任务队列，并保持不经过 shell 的直接调用。它不会自动修改 Git trust、push、deploy、publish 或远程服务。
## V5.6 Context Builder

任务解析完成后，Relay 先由 Context Builder 生成 Codex stdin prompt，再启动 Codex。Prompt 分为四层：最小 Relay/task guidance、根目录 `AGENTS.md` 的简洁仓库 guidance、与任务明确相关的 capability/module 片段、完整当前 instruction。schema_version 仍为 `1`，旧任务字段和解析方式保持兼容；instruction 不做静默截断。

Context Builder 使用显式、可测试的固定规则：命中 `docs`、README、文档路径或文档关键词时选 `docs`；命中 `doctor.js`、`npm run doctor` 或诊断关键词时选 `doctor`；命中 Browser Evidence、screenshot 或浏览器证据关键词时选 `browser-evidence`。片段固定排序、措辞简洁且有界；未命中的 capability 不进入 prompt，不使用 LLM/semantic classification。

`AGENTS.md` 由 Context Builder 主动读取并 materialize/select，提供 Agent Relay 身份、简体中文文档约定、稳定协议名、`AGENT_RELAY_*` 命名和 Doctor/Browser Evidence 边界。provider 原生读取 `AGENTS.md` 只是 interoperability optimization，不是安全或 portability 依赖。字符级 telemetry 只包含 task、mandatory、repo、capability、final prompt 字符数和片段名，禁止正文、token、ID、secret、`.env` 或私有 operational metadata；完整 Usage Accounting 延后到 V6。

Context Builder 只压缩重复 prompt 文本，不改变 Relay 的代码强制安全边界。Provider Abstraction、Grok integration、automatic routing、quota failover、token/cost accounting、schema v2 和 policy DSL/manifest 均延后到 V6。
