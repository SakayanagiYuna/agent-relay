"use strict";

const assert = require("assert");
const { createHumanNotificationProvider, createSmtpTransport, readHumanNotificationConfig, renderEmailMessage } = require("./human-notification");

(async () => {
  const event = { schema_version: 1, event: "task_terminal", task_id: "TASK-075", status: "DONE", elapsed_sec: 12 };
  const disabled = createHumanNotificationProvider({ config: readHumanNotificationConfig({}) });
  assert.deepStrictEqual(await disabled.notify(event), { skipped: true, provider: "disabled" });

  const sent = [];
  const config = readHumanNotificationConfig({ AGENT_RELAY_NOTIFY_ENABLED: "true", AGENT_RELAY_NOTIFY_PROVIDER: "email", AGENT_RELAY_NOTIFY_EMAIL_TO: "ops@example.test", AGENT_RELAY_NOTIFY_SMTP_HOST: "smtp.example.test", AGENT_RELAY_NOTIFY_SMTP_PORT: "465", AGENT_RELAY_NOTIFY_SMTP_USER: "relay@example.test", AGENT_RELAY_NOTIFY_SMTP_SECRET: "local-secret" });
  const email = createHumanNotificationProvider({ config, transport: { sendMail: async (message) => sent.push(message) } });
  assert.deepStrictEqual(renderEmailMessage(event), { subject: "Agent Relay DONE: TASK-075", text: "task_id: TASK-075\nstatus: DONE\nelapsed_sec: 12" });
  await email.notify(event);
  assert.deepStrictEqual(sent, [{ to: "ops@example.test", subject: "Agent Relay DONE: TASK-075", text: "task_id: TASK-075\nstatus: DONE\nelapsed_sec: 12" }]);
  await assert.rejects(() => createHumanNotificationProvider({ config }).notify(event), /HOST_CONFIG_REQUIRED/);
  assert.deepStrictEqual(await createHumanNotificationProvider({ config: readHumanNotificationConfig({ AGENT_RELAY_NOTIFY_ENABLED: "true", AGENT_RELAY_NOTIFY_PROVIDER: "email", AGENT_RELAY_NOTIFY_EMAIL_TO: "ops@example.test" }) }).notify(event), { skipped: true, provider: "disabled" });
  const smtpCalls = [];
  const smtp = createSmtpTransport({ config: { ...config, email: { ...config.email, port: "465", user: "relay@163.com", secret: "local-secret" } }, nodemailer: { createTransport: (options) => { smtpCalls.push(["create", options]); return { sendMail: async (message) => smtpCalls.push(["send", message]) }; } } });
  await smtp.sendMail({ to: "ops@example.test", subject: "test", text: "minimal" });
  assert.deepStrictEqual(smtpCalls, [["create", { host: "smtp.example.test", port: 465, secure: true, auth: { user: "relay@163.com", pass: "local-secret" } }], ["send", { from: "relay@163.com", to: "ops@example.test", subject: "test", text: "minimal" }]]);
  assert.throws(() => createSmtpTransport({ config: { ...config, email: { ...config.email, port: "invalid" } }, nodemailer: {} }), /human_notify_smtp_port_invalid/);
  console.log("human notification regression passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
