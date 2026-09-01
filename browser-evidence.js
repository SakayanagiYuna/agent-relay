"use strict";

const fs = require("fs");
const path = require("path");

const VIEWPORTS = Object.freeze({
  desktop: Object.freeze({ width: 1440, height: 900 }),
  intermediate: Object.freeze({ width: 1024, height: 768 }),
  mobile: Object.freeze({ width: 390, height: 844 }),
});
const MAX_CONSOLE_ERRORS = 20;
const MAX_ERROR_CHARS = 300;

function redactText(value, maxChars = MAX_ERROR_CHARS) {
  return String(value || "")
    .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[REDACTED_TOKEN]")
    .replace(/\b(?:xoxb|xapp|xoxp)-[A-Za-z0-9-]+\b/g, "[REDACTED_TOKEN]")
    .replace(/\b(?:[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)|TOKEN|SECRET|PASSWORD|API_KEY)\s*=\s*[^\s]+/gi, "[REDACTED_ASSIGNMENT]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function parseLoopbackUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || ""));
  } catch {
    throw new Error("browser_url_invalid");
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname.toLowerCase()) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("browser_url_not_loopback");
  }

  return url;
}

function validateBrowserRequest(request, allowedOrigins) {
  if (!request || request.mode !== "screenshot") {
    return null;
  }

  const url = parseLoopbackUrl(request.url);
  const configuredOrigins = new Set(allowedOrigins || []);

  if (!configuredOrigins.has(url.origin)) {
    throw new Error("browser_url_origin_not_allowed");
  }

  if (!Object.prototype.hasOwnProperty.call(VIEWPORTS, request.viewport)) {
    throw new Error("browser_viewport_not_allowed");
  }

  return { url: url.toString(), viewport: request.viewport };
}

function validateBrowserRequests(request, allowedOrigins) {
  if (!request || request.mode !== "screenshot") return [];
  const rawViewports = Array.isArray(request.viewport) ? request.viewport : String(request.viewport || "").split(",");
  const viewports = rawViewports.map((value) => String(value).trim()).filter(Boolean);
  if (!viewports.length || viewports.length > Object.keys(VIEWPORTS).length || new Set(viewports).size !== viewports.length) {
    throw new Error("browser_viewport_not_allowed");
  }
  return viewports.map((viewport) => validateBrowserRequest({ ...request, viewport }, allowedOrigins));
}

function isAllowedResourceUrl(rawUrl, allowedOrigins) {
  if (rawUrl.startsWith("data:")) {
    return true;
  }
  try {
    // Resource URLs are not task URLs. Vite and other SPA toolchains add
    // cache-busting query strings to same-origin modules and assets, so only
    // the network origin is relevant here. Top-level task URLs remain subject
    // to parseLoopbackUrl's credential/query/fragment restrictions.
    const url = new URL(rawUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname.toLowerCase()) ||
      url.username ||
      url.password
    ) {
      return false;
    }
    return new Set(allowedOrigins).has(url.origin);
  } catch {
    return false;
  }
}

function safeTaskDirectory(repoPath, taskId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(taskId)) {
    throw new Error("browser_task_id_invalid");
  }
  const evidenceRoot = path.resolve(repoPath, ".agent-relay", "evidence");
  const taskDirectory = path.resolve(evidenceRoot, taskId);
  if (!taskDirectory.startsWith(`${evidenceRoot}${path.sep}`)) {
    throw new Error("browser_evidence_path_invalid");
  }
  fs.mkdirSync(taskDirectory, { recursive: true });
  return taskDirectory;
}

function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    throw new Error("browser_playwright_not_installed: run npm install");
  }
}

function resolveBrowserExecutablePath(configuredPath) {
  if (configuredPath === undefined || configuredPath === null || configuredPath === "") {
    return undefined;
  }

  const value = String(configuredPath).trim();
  if (!value || !path.isAbsolute(value)) {
    throw new Error("browser_executable_path_invalid");
  }

  const resolvedPath = path.resolve(value);
  try {
    if (!fs.statSync(resolvedPath).isFile()) {
      throw new Error("browser_executable_path_invalid");
    }
  } catch (error) {
    if (error.message === "browser_executable_path_invalid") throw error;
    throw new Error("browser_executable_path_invalid");
  }

  return resolvedPath;
}

async function openEvidenceBrowser({ playwright, config, deadline }) {
  const executablePath = resolveBrowserExecutablePath(config.executablePath);
  const launchOptions = { headless: true, timeout: remainingTimeoutMs(deadline) };
  if (executablePath) launchOptions.executablePath = executablePath;
  const browser = await withinDeadline(() => playwright.chromium.launch(launchOptions), deadline);
  return { browser, browserExecutableConfigured: Boolean(executablePath) };
}

function remainingTimeoutMs(deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new Error("browser_evidence_timeout");
  }
  return remaining;
}

async function withinDeadline(operation, deadline) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("browser_evidence_timeout")), remainingTimeoutMs(deadline));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function captureBrowserEvidence({ taskId, route, request, config }) {
  const verified = validateBrowserRequest(request, config.allowedOrigins);
  const deadline = Date.now() + config.timeoutMs;
  const viewport = VIEWPORTS[verified.viewport];
  const screenshotPath = path.join(
    safeTaskDirectory(route.local_path, taskId),
    `${taskId}-${verified.viewport}.png`
  );
  const consoleErrors = [];
  const playwright = loadPlaywright();
  const opened = await openEvidenceBrowser({ playwright, config, deadline });
  const { browser } = opened;
  try {
    const context = await withinDeadline(() => browser.newContext({ viewport }), deadline);
    await withinDeadline(() => context.route("**/*", async (routeRequest) => {
      if (isAllowedResourceUrl(routeRequest.request().url(), config.allowedOrigins)) {
        await routeRequest.continue();
      } else {
        await routeRequest.abort("blockedbyclient");
      }
    }), deadline);
    const page = await withinDeadline(() => context.newPage(), deadline);
    page.on("console", (message) => {
      if (message.type() === "error" && consoleErrors.length < MAX_CONSOLE_ERRORS) {
        consoleErrors.push(redactText(message.text()));
      }
    });
    page.on("pageerror", (error) => {
      if (consoleErrors.length < MAX_CONSOLE_ERRORS) {
        consoleErrors.push(redactText(error.message));
      }
    });

    // `domcontentloaded` confirms that navigation produced a parsed document.
    // Do not require the body element to meet Playwright's visibility heuristic:
    // legitimate SPAs can render from a body that is CSS-hidden by that heuristic.
    const navigation = await page.goto(verified.url, {
      waitUntil: "domcontentloaded",
      timeout: remainingTimeoutMs(deadline),
    });
    if (!navigation || !navigation.ok()) {
      throw new Error("browser_navigation_failed");
    }

    // Give client-side rendering a short, bounded opportunity to settle while
    // sharing the configured capture deadline with navigation and screenshot.
    await page.waitForTimeout(Math.min(500, remainingTimeoutMs(deadline)));
    await page.screenshot({
      path: screenshotPath,
      type: "png",
      timeout: remainingTimeoutMs(deadline),
    });
    await context.close();
  } finally {
    await browser.close();
  }

  return {
    screenshotPath,
    filename: path.basename(screenshotPath),
    url: verified.url,
    viewport: { name: verified.viewport, ...viewport },
    browserRuntime: "isolated_headless",
    browserExecutableConfigured: Boolean(opened.browserExecutableConfigured),
    consoleErrorCount: consoleErrors.length,
    consoleErrors,
  };
}

function isSlackFilesScopeError(error) {
  const code = String(error?.data?.error || error?.code || error?.message || "").toLowerCase();
  return code.includes("missing_scope") || code.includes("files:write");
}

module.exports = {
  VIEWPORTS,
  captureBrowserEvidence,
  isSlackFilesScopeError,
  isAllowedResourceUrl,
  parseLoopbackUrl,
  redactText,
  remainingTimeoutMs,
  withinDeadline,
  resolveBrowserExecutablePath,
  openEvidenceBrowser,
  validateBrowserRequest,
  validateBrowserRequests,
};
