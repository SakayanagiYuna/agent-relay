# Agent Relay repository guidance

- Identity: Agent Relay is a local, allowlisted Slack-to-Codex execution relay; stable protocol names are `CODEX_TASK` and `CODEX_STATUS`.
- Documentation: authoritative explanatory prose is Simplified Chinese; keep technical identifiers, commands, and code literals in English.
- Configuration and naming use `AGENT_RELAY_*`. Do not introduce deprecated product or configuration naming.
- Validation: use `node --check` for changed executable JavaScript, `npm test`, `npm run doctor` when permitted, and `git diff --check`.
- Doctor is local/read-only readiness diagnostics. Browser Evidence is Relay-host-only post-Codex evidence capture with loopback/origin and artifact boundaries; neither boundary is delegated to prompt text. A `CODEX_TASK` requests evidence only through the complete structured trio `browser_evidence: screenshot`, `browser_url`, and `browser_viewport`; never infer browser access, URL, or viewport from `instruction`, goals, or acceptance prose.
