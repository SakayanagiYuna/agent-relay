"use strict";

function parseEnabled(value) {
  if (value === undefined || value === "") return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("human_notify_enabled_invalid");
}

function readHumanNotificationConfig(env = process.env) {
  const enabled = parseEnabled(env.AGENT_RELAY_NOTIFY_ENABLED);
  const provider = String(env.AGENT_RELAY_NOTIFY_PROVIDER || "disabled").trim().toLowerCase();
  if (!['disabled', 'noop', 'email'].includes(provider)) throw new Error("human_notify_provider_invalid");
  const emailTo = String(env.AGENT_RELAY_NOTIFY_EMAIL_TO || "").trim();
  if (/[\r\n]/.test(emailTo)) throw new Error("human_notify_email_to_invalid");
  return {
    enabled,
    provider: enabled ? provider : "disabled",
    email: {
      to: emailTo,
      host: String(env.AGENT_RELAY_NOTIFY_SMTP_HOST || "").trim(),
      port: String(env.AGENT_RELAY_NOTIFY_SMTP_PORT || "").trim(),
      user: String(env.AGENT_RELAY_NOTIFY_SMTP_USER || "").trim(),
      secret: String(env.AGENT_RELAY_NOTIFY_SMTP_SECRET || ""),
    },
  };
}

function renderEmailMessage(event) {
  return {
    subject: `Agent Relay ${event.status}: ${event.task_id}`,
    text: [`task_id: ${event.task_id}`, `status: ${event.status}`, ...(event.elapsed_sec === undefined ? [] : [`elapsed_sec: ${event.elapsed_sec}`])].join("\n"),
  };
}

function createSmtpTransport({ config = readHumanNotificationConfig(), nodemailer } = {}) {
  if (!config.enabled || config.provider !== "email") return null;
  if (!config.email.to || !config.email.host || !config.email.port || !config.email.user || !config.email.secret) return null;
  const port = Number(config.email.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("human_notify_smtp_port_invalid");
  const client = nodemailer || require("nodemailer");
  if (!client || typeof client.createTransport !== "function") throw new Error("human_notify_smtp_client_unavailable");
  const transport = client.createTransport({ host: config.email.host, port, secure: port === 465, auth: { user: config.email.user, pass: config.email.secret } });
  return { async sendMail(message) { return transport.sendMail({ from: config.email.user, ...message }); } };
}

function createHumanNotificationProvider({ config = readHumanNotificationConfig(), transport } = {}) {
  if (!config.enabled || config.provider === "disabled" || config.provider === "noop" || (config.provider === "email" && (!config.email.to || !config.email.host || !config.email.port || !config.email.user || !config.email.secret))) {
    return { name: "disabled", async notify() { return { skipped: true, provider: "disabled" }; } };
  }
  if (config.provider !== "email") throw new Error("human_notify_provider_invalid");
  return {
    name: "email",
    async notify(event) {
      if (!config.email.to || !config.email.host) throw new Error("HOST_CONFIG_REQUIRED");
      if (!transport || typeof transport.sendMail !== "function") throw new Error("HOST_CONFIG_REQUIRED");
      const message = renderEmailMessage(event);
      await transport.sendMail({ to: config.email.to, ...message });
      return { delivered: true, provider: "email" };
    },
  };
}

module.exports = { createHumanNotificationProvider, createSmtpTransport, readHumanNotificationConfig, renderEmailMessage };
