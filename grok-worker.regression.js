"use strict";

const assert = require("assert");
const fs = require("fs");
const { buildGrokArgs, createPromptFile, describeGrokActivity, extractGrokSummary, extractGrokUsage, observeGrokStreamEvent, removePromptFile } = require("./grok-worker");

assert.strictEqual(extractGrokSummary('{"result":"Implemented the requested change."}'), "Implemented the requested change.");
assert.strictEqual(extractGrokSummary("plain response"), "plain response");
assert.deepStrictEqual(extractGrokUsage('{"usage":{"input_tokens":12,"cache_read_input_tokens":3,"output_tokens":4,"reasoning_tokens":2,"total_tokens":16}}'), { input_tokens: 12, cached_input_tokens: 3, output_tokens: 4, reasoning_tokens: 2, total_tokens: 16 });
assert.deepStrictEqual(extractGrokUsage('{"result":{"usage":{"input_tokens":7,"output_tokens":2,"total_tokens":9}}}'), { input_tokens: 7, cached_input_tokens: null, output_tokens: 2, reasoning_tokens: null, total_tokens: 9 });
assert.strictEqual(describeGrokActivity({ type: "thought" }), "reasoning");
const events = []; const textChunks = []; const usageCollector = require("./usage-accounting").createUsageCollector();
observeGrokStreamEvent({ event: { type: "text", data: "completed" }, usageCollector, textChunks, onProgress: (progress) => events.push(progress) });
observeGrokStreamEvent({ event: { type: "end", usage: { input_tokens: 12, cache_read_input_tokens: 3, output_tokens: 4, reasoning_tokens: 2, total_tokens: 16 } }, usageCollector, textChunks, onProgress: (progress) => events.push(progress) });
assert.deepStrictEqual(textChunks, ["completed"]); assert.deepStrictEqual(usageCollector.usage(), { input_tokens: 12, cached_input_tokens: 3, output_tokens: 4, reasoning_tokens: 2, total_tokens: 16 }); assert.deepStrictEqual(events.map((event) => event.activity), ["responding", "turn_completed"]);
const promptFile = createPromptFile("untrusted Slack prompt");
assert.strictEqual(fs.readFileSync(promptFile.filePath, "utf8"), "untrusted Slack prompt");
removePromptFile(promptFile);
assert.ok(!fs.existsSync(promptFile.directory));
const grokArgs = buildGrokArgs({ repoPath: "D:\\repo", sandbox: "workspace", promptFilePath: "D:\\tmp\\prompt.txt" });
assert.ok(!grokArgs.includes("--always-approve"));
assert.ok(!grokArgs.includes("--continue"));
assert.ok(!grokArgs.includes("--resume"));
const resumedGrokArgs = buildGrokArgs({ repoPath: "D:\\repo", sandbox: "workspace", promptFilePath: "D:\\tmp\\prompt.txt", resumeSessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });
assert.deepStrictEqual(resumedGrokArgs.slice(-4), ["--resume", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "--prompt-file", "D:\\tmp\\prompt.txt"]);
console.log("grok worker regression checks passed");
