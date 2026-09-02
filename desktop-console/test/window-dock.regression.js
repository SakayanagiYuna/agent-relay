"use strict";
const assert = require("assert");
const { BrowserDock, validateSurfaceRect, surfaceToScreenRect, findChromeWindow, nativeHandleToHwnd, CHROME_WINDOW_CLASS } = require("../src/window-dock");

assert.throws(() => validateSurfaceRect({}));
assert.throws(() => validateSurfaceRect({ x: 0, y: 0, width: 0, height: 10 }));
assert.deepStrictEqual(validateSurfaceRect({ x: 12.2, y: 40, width: 640, height: 400 }), { x: 12.2, y: 40, width: 640, height: 400 });

const handle = Buffer.alloc(8);
handle.writeBigUInt64LE(0x1234567890n);
assert.strictEqual(nativeHandleToHwnd(handle), 0x1234567890n);

const screenRect = surfaceToScreenRect(
  { getContentBounds: () => ({ x: 100, y: 50, width: 800, height: 600 }) },
  { x: 20, y: 30, width: 400, height: 300 },
  { dipToScreenRect: (_win, rect) => ({ x: rect.x * 2, y: rect.y * 2, width: rect.width * 2, height: rect.height * 2 }) }
);
assert.deepStrictEqual(screenRect, { x: 240, y: 160, width: 800, height: 600 });

const windows = [
  { hwnd: 1n, pid: 7, visible: true, className: CHROME_WINDOW_CLASS, rect: { left: 0, top: 0, right: 100, bottom: 100 } },
  { hwnd: 2n, pid: 9, visible: true, className: CHROME_WINDOW_CLASS, rect: { left: 0, top: 0, right: 800, bottom: 600 } },
  { hwnd: 3n, pid: 9, visible: true, className: CHROME_WINDOW_CLASS, rect: { left: 0, top: 0, right: 200, bottom: 200 } },
  { hwnd: 4n, pid: 9, visible: false, className: CHROME_WINDOW_CLASS, rect: { left: 0, top: 0, right: 900, bottom: 700 } },
];
const found = findChromeWindow(9, {
  findWindowEx: (_parent, after) => {
    const index = after === 0n ? 0 : windows.findIndex((entry) => entry.hwnd === after) + 1;
    return windows[index]?.hwnd || 0n;
  },
  getWindowProcessId: (hwnd) => windows.find((entry) => entry.hwnd === hwnd).pid,
  isVisible: (hwnd) => windows.find((entry) => entry.hwnd === hwnd).visible,
  getWindowRect: (hwnd) => windows.find((entry) => entry.hwnd === hwnd).rect,
});
assert.strictEqual(found, 2n);

const calls = [];
const api = {
  findWindowEx: (_parent, after) => after === 0n ? 11n : 0n,
  getWindowProcessId: () => 99,
  isVisible: () => true,
  getWindowRect: () => ({ left: 0, top: 0, right: 800, bottom: 600 }),
  setParent: (...args) => { calls.push(["parent", ...args]); return 0n; },
  getWindowLongPtr: () => 0x16CF0000,
  setWindowLongPtr: (...args) => calls.push(["style", ...args]),
  setWindowPos: (...args) => calls.push(["pos", ...args]),
  showWindow: (...args) => calls.push(["show", ...args]),
  isWindow: () => true,
  setForegroundWindow: () => true,
  postMessage: (...args) => calls.push(["close", ...args]),
};
const dock = new BrowserDock({ platform: "win32", api });
const win = { getContentBounds: () => ({ x: 10, y: 20, width: 1000, height: 800 }), getNativeWindowHandle: () => Buffer.from(new BigUint64Array([5n]).buffer) };
const surface = { x: 30, y: 40, width: 500, height: 360 };
const screenApi = { dipToScreenRect: (_win, rect) => rect };
(async () => {
  const attached = await dock.attach({ pid: 99, retries: 1, delayMs: 0 });
  assert.strictEqual(attached.attached, true);
  dock.layout(win, surface, screenApi);
  const parent = calls.find((entry) => entry[0] === "parent");
  assert.strictEqual(parent[1], 11n);
  assert.strictEqual(parent[2], 0n);
  const style = calls.find((entry) => entry[0] === "style" && entry[2] === -16);
  assert.strictEqual(Number(style[3]) & 0x40000000, 0);
  assert.ok(Number(style[3]) & 0x80000000);
  const owner = calls.find((entry) => entry[0] === "style" && entry[2] === -8);
  assert.strictEqual(owner[3], 5n);
  const pos = calls.filter((entry) => entry[0] === "pos").at(-1);
  assert.strictEqual(pos[1], 11n);
  assert.strictEqual(pos[3], 40);
  assert.strictEqual(pos[4], 60);
  assert.strictEqual(pos[5], 500);
  assert.strictEqual(pos[6], 360);
  assert.strictEqual(pos[7], 0x0070);
  dock.layout(win, surface, screenApi);
  const follow = calls.filter((entry) => entry[0] === "pos").at(-1);
  assert.strictEqual(follow[3], 40);
  assert.strictEqual(follow[4], 60);
  assert.strictEqual(follow[7], 0x0214);
  assert.strictEqual(dock.raise(), true);
  assert.deepStrictEqual(dock.focus(), { available: true, message: "已聚焦 Relay 浏览器。" });
  assert.strictEqual(dock.requestClose(), true);
  const close = calls.find((entry) => entry[0] === "close");
  assert.strictEqual(close[1], 11n);
  assert.strictEqual(close[2], 0x0010);
  console.log("window-dock regression: passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
