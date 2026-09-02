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

const CONSOLE_HWND = 5n;
const CHROME_HWND = 11n;
const CHROME_OWNER_HWND = 77n;
const GWL_STYLE = -16;
const GWLP_HWNDPARENT = -8;
const GWL_EXSTYLE = -20;
const GW_OWNER = 4;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_APPWINDOW = 0x00040000;
const calls = [];
let chromeOwner = CHROME_OWNER_HWND;
const api = {
  findWindowEx: (_parent, after) => after === 0n ? CHROME_HWND : 0n,
  getWindowProcessId: () => 99,
  isVisible: () => true,
  getWindowRect: () => ({ left: 0, top: 0, right: 800, bottom: 600 }),
  setParent: (...args) => { calls.push(["parent", ...args]); return 0n; },
  getWindowLongPtr: () => 0x16CF0000,
  setWindowLongPtr: (hwnd, index, value) => {
    calls.push(["style", hwnd, index, value]);
    if (hwnd === CHROME_HWND && index === GWLP_HWNDPARENT) chromeOwner = value;
  },
  setWindowPos: (...args) => calls.push(["pos", ...args]),
  showWindow: (...args) => calls.push(["show", ...args]),
  isWindow: () => true,
  setForegroundWindow: () => true,
  postMessage: (...args) => calls.push(["close", ...args]),
  getWindow: (hwnd, cmd) => (hwnd === CHROME_HWND && cmd === GW_OWNER ? chromeOwner : 0n),
};
const dock = new BrowserDock({ platform: "win32", api });
const win = { getContentBounds: () => ({ x: 10, y: 20, width: 1000, height: 800 }), getNativeWindowHandle: () => Buffer.from(new BigUint64Array([CONSOLE_HWND]).buffer) };
const surface = { x: 30, y: 40, width: 500, height: 360 };
const screenApi = { dipToScreenRect: (_win, rect) => rect };
function lastExStyle(hwnd) {
  const hit = calls.filter((entry) => entry[0] === "style" && entry[1] === hwnd && entry[2] === GWL_EXSTYLE).at(-1);
  return hit ? Number(hit[3]) : null;
}
(async () => {
  const attached = await dock.attach({ pid: 99, retries: 1, delayMs: 0 });
  assert.strictEqual(attached.attached, true);
  dock.layout(win, surface, screenApi);
  const parent = calls.find((entry) => entry[0] === "parent");
  assert.strictEqual(parent[1], CHROME_HWND);
  assert.strictEqual(parent[2], 0n);
  const style = calls.find((entry) => entry[0] === "style" && entry[2] === GWL_STYLE);
  assert.strictEqual(Number(style[3]) & 0x40000000, 0);
  assert.ok(Number(style[3]) & 0x80000000);
  const owner = calls.find((entry) => entry[0] === "style" && entry[2] === GWLP_HWNDPARENT);
  assert.strictEqual(owner[3], CONSOLE_HWND);
  assert.ok(lastExStyle(CHROME_HWND) & WS_EX_TOOLWINDOW);
  assert.strictEqual(lastExStyle(CHROME_HWND) & WS_EX_APPWINDOW, 0);
  assert.ok(lastExStyle(CHROME_OWNER_HWND) & WS_EX_TOOLWINDOW);
  assert.strictEqual(lastExStyle(CHROME_OWNER_HWND) & WS_EX_APPWINDOW, 0);
  assert.ok(lastExStyle(CONSOLE_HWND) & WS_EX_APPWINDOW);
  assert.strictEqual(lastExStyle(CONSOLE_HWND) & WS_EX_TOOLWINDOW, 0);
  for (const entry of calls.filter((item) => item[0] === "style" && item[1] === CONSOLE_HWND && item[2] === GWL_EXSTYLE)) {
    assert.strictEqual(Number(entry[3]) & WS_EX_TOOLWINDOW, 0, "Console HWND must keep a normal caption");
  }
  const pos = calls.filter((entry) => entry[0] === "pos" && entry[1] === CHROME_HWND).at(-1);
  assert.strictEqual(pos[1], CHROME_HWND);
  assert.strictEqual(pos[3], 40);
  assert.strictEqual(pos[4], 60);
  assert.strictEqual(pos[5], 500);
  assert.strictEqual(pos[6], 360);
  assert.strictEqual(pos[7], 0x0070);
  dock.layout(win, surface, screenApi);
  const follow = calls.filter((entry) => entry[0] === "pos" && entry[1] === CHROME_HWND).at(-1);
  assert.strictEqual(follow[3], 40);
  assert.strictEqual(follow[4], 60);
  assert.strictEqual(follow[7], 0x0214);
  assert.strictEqual(dock.raise(), true);
  assert.deepStrictEqual(dock.focus(), { available: true, message: "已聚焦 Relay 浏览器。" });
  assert.strictEqual(dock.requestClose(), true);
  const close = calls.find((entry) => entry[0] === "close");
  assert.strictEqual(close[1], CHROME_HWND);
  assert.strictEqual(close[2], 0x0010);
  console.log("window-dock regression: passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
