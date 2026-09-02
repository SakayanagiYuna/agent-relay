"use strict";
const assert = require("assert");
const { terminalOverlayBounds } = require("../src/terminal-overlay");

assert.strictEqual(terminalOverlayBounds(null), null);
assert.strictEqual(terminalOverlayBounds({ x: 0, y: 0, width: 0, height: 100 }), null);

const host = { x: 240, y: 80, width: 800, height: 600 };
const expanded = terminalOverlayBounds(host);
assert.deepStrictEqual(expanded, { x: 250, y: 390, width: 780, height: 280 });
assert.deepStrictEqual(host, { x: 240, y: 80, width: 800, height: 600 });

const collapsed = terminalOverlayBounds(host, { collapsed: true });
assert.deepStrictEqual(collapsed, { x: 250, y: 626, width: 780, height: 44 });
assert.strictEqual(collapsed.y + collapsed.height + 10, host.y + host.height);
assert.ok(expanded.height > collapsed.height);

console.log("terminal-overlay regression: passed");
