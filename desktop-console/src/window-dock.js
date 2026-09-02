"use strict";

const GWL_STYLE = -16;
const GWLP_HWNDPARENT = -8;
const GWL_EXSTYLE = -20;
const WS_CAPTION = 0x00C00000;
const WS_THICKFRAME = 0x00040000;
const WS_MINIMIZEBOX = 0x00020000;
const WS_MAXIMIZEBOX = 0x00010000;
const WS_SYSMENU = 0x00080000;
const WS_VISIBLE = 0x10000000;
const WS_POPUP = 0x80000000;
const WS_CHILD = 0x40000000;
const WS_CLIPSIBLINGS = 0x04000000;
const WS_CLIPCHILDREN = 0x02000000;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_APPWINDOW = 0x00040000;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_SHOWWINDOW = 0x0040;
const SWP_FRAMECHANGED = 0x0020;
const SWP_NOACTIVATE = 0x0010;
const SWP_NOOWNERZORDER = 0x0200;
const GW_OWNER = 4;
const SW_HIDE = 0;
const SW_SHOWNA = 8;
const WM_CLOSE = 0x0010;
const CHROME_WINDOW_CLASS = "Chrome_WidgetWin_1";

function nativeHandleToHwnd(handle) {
  if (typeof handle === "bigint") return handle;
  if (typeof handle === "number") return BigInt(handle);
  if (Buffer.isBuffer(handle)) return handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
  throw new Error("console_hwnd_invalid");
}

function validateSurfaceRect(value) {
  if (!value || typeof value !== "object") throw new Error("console_surface_rect_invalid");
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (![x, y, width, height].every(Number.isFinite)) throw new Error("console_surface_rect_invalid");
  if (width < 1 || height < 1 || width > 10000 || height > 10000) throw new Error("console_surface_rect_invalid");
  if (Math.abs(x) > 10000 || Math.abs(y) > 10000) throw new Error("console_surface_rect_invalid");
  return { x, y, width, height };
}

function roundRect(rect) {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function surfaceToScreenRect(win, rect, screenApi) {
  const content = win.getContentBounds();
  return roundRect(screenApi.dipToScreenRect(win, {
    x: content.x + rect.x,
    y: content.y + rect.y,
    width: rect.width,
    height: rect.height,
  }));
}

function surfaceToParentClient(win, rect, screenApi) {
  const screenRect = surfaceToScreenRect(win, rect, screenApi);
  const origin = screenApi.dipToScreenRect(win, win.getContentBounds());
  return {
    x: Math.round(screenRect.x - origin.x),
    y: Math.round(screenRect.y - origin.y),
    width: Math.round(screenRect.width),
    height: Math.round(screenRect.height),
  };
}

function listChromeWindows(pid, api, className = CHROME_WINDOW_CLASS) {
  const found = [];
  let hwnd = 0n;
  while (true) {
    hwnd = BigInt(api.findWindowEx(0n, hwnd, className, null) || 0);
    if (!hwnd) break;
    if (api.getWindowProcessId(hwnd) !== pid) continue;
    found.push(hwnd);
  }
  return found;
}

function findChromeWindow(pid, api) {
  let hwnd = 0n;
  let best = null;
  let bestArea = 0;
  while (true) {
    hwnd = BigInt(api.findWindowEx(0n, hwnd, CHROME_WINDOW_CLASS, null) || 0);
    if (!hwnd) break;
    if (api.getWindowProcessId(hwnd) !== pid) continue;
    if (!api.isVisible(hwnd)) continue;
    const box = api.getWindowRect(hwnd);
    const area = Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top);
    if (area > bestArea) {
      best = hwnd;
      bestArea = area;
    }
  }
  return best;
}

function createWin32Api(koffi) {
  const user32 = koffi.load("user32.dll");
  const RECT = koffi.struct("RECT", { left: "int32", top: "int32", right: "int32", bottom: "int32" });
  const FindWindowExW = user32.func("uintptr __stdcall FindWindowExW(uintptr hwndParent, uintptr hwndChildAfter, str16 lpszClass, str16 lpszWindow)");
  const GetWindowThreadProcessId = user32.func("uint32 __stdcall GetWindowThreadProcessId(uintptr hWnd, _Out_ uint32 *lpdwProcessId)");
  const IsWindowVisible = user32.func("bool __stdcall IsWindowVisible(uintptr hWnd)");
  const GetWindowRect = user32.func("bool __stdcall GetWindowRect(uintptr hWnd, _Out_ RECT *lpRect)");
  const SetParent = user32.func("uintptr __stdcall SetParent(uintptr hWndChild, uintptr hWndNewParent)");
  const GetWindowLongPtrW = user32.func("intptr __stdcall GetWindowLongPtrW(uintptr hWnd, int nIndex)");
  const SetWindowLongPtrW = user32.func("intptr __stdcall SetWindowLongPtrW(uintptr hWnd, int nIndex, intptr dwNewLong)");
  const SetWindowPos = user32.func("bool __stdcall SetWindowPos(uintptr hWnd, uintptr hWndInsertAfter, int X, int Y, int cx, int cy, uint32 uFlags)");
  const ShowWindow = user32.func("bool __stdcall ShowWindow(uintptr hWnd, int nCmdShow)");
  const IsWindow = user32.func("bool __stdcall IsWindow(uintptr hWnd)");
  const SetForegroundWindow = user32.func("bool __stdcall SetForegroundWindow(uintptr hWnd)");
  const PostMessageW = user32.func("bool __stdcall PostMessageW(uintptr hWnd, uint32 Msg, uintptr wParam, intptr lParam)");
  const GetWindow = user32.func("uintptr __stdcall GetWindow(uintptr hWnd, uint32 uCmd)");
  const GetParent = user32.func("uintptr __stdcall GetParent(uintptr hWnd)");
  return {
    findWindowEx: (parent, after, className, title) => FindWindowExW(parent, after, className, title),
    getWindowProcessId: (hwnd) => {
      const pid = [0];
      GetWindowThreadProcessId(hwnd, pid);
      return pid[0];
    },
    isVisible: (hwnd) => Boolean(IsWindowVisible(hwnd)),
    getWindowRect: (hwnd) => {
      const box = {};
      GetWindowRect(hwnd, box);
      return box;
    },
    setParent: (child, parent) => SetParent(child, parent),
    getWindowLongPtr: (hwnd, index) => GetWindowLongPtrW(hwnd, index),
    setWindowLongPtr: (hwnd, index, value) => SetWindowLongPtrW(hwnd, index, value),
    setWindowPos: (hwnd, after, x, y, cx, cy, flags) => SetWindowPos(hwnd, after, x, y, cx, cy, flags),
    showWindow: (hwnd, cmd) => ShowWindow(hwnd, cmd),
    isWindow: (hwnd) => Boolean(IsWindow(hwnd)),
    setForegroundWindow: (hwnd) => SetForegroundWindow(hwnd),
    postMessage: (hwnd, msg, wParam, lParam) => PostMessageW(hwnd, msg, wParam, lParam),
    getWindow: (hwnd, cmd) => GetWindow(hwnd, cmd),
    getParent: (hwnd) => GetParent(hwnd),
  };
}

class BrowserDock {
  constructor({ platform = process.platform, api = null, loadKoffi = () => require("koffi") } = {}) {
    this.platform = platform;
    this.api = api;
    this.loadKoffi = loadKoffi;
    this.hwnd = null;
    this.pid = null;
    this.originalStyle = null;
    this.originalExStyle = null;
    this.attached = false;
    this.parentHwnd = null;
    this.framed = false;
    this.positioned = false;
  }

  ensureApi() {
    if (this.api) return this.api;
    if (this.platform !== "win32") throw new Error("console_window_dock_requires_windows");
    this.api = createWin32Api(this.loadKoffi());
    return this.api;
  }

  async attach({ pid, retries = 15, delayMs = 200 } = {}) {
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("console_browser_pid_invalid");
    const api = this.ensureApi();
    this.pid = pid;
    for (let attempt = 0; attempt < retries; attempt += 1) {
      const hwnd = findChromeWindow(pid, api);
      if (hwnd) {
        this.hwnd = hwnd;
        if (this.originalStyle == null) this.originalStyle = api.getWindowLongPtr(hwnd, GWL_STYLE);
        if (this.originalExStyle == null) this.originalExStyle = api.getWindowLongPtr(hwnd, GWL_EXSTYLE);
        this.attached = true;
        return { attached: true, hwnd };
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return { attached: false, hwnd: null };
  }

  hideFromTaskbar(hwnd) {
    const api = this.ensureApi();
    const exStyle = (Number(api.getWindowLongPtr(hwnd, GWL_EXSTYLE)) | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW;
    api.setWindowLongPtr(hwnd, GWL_EXSTYLE, exStyle);
    if (typeof api.getWindow === "function") {
      const owner = BigInt(api.getWindow(hwnd, GW_OWNER) || 0);
      if (owner && owner !== hwnd) {
        const ownerEx = (Number(api.getWindowLongPtr(owner, GWL_EXSTYLE)) | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW;
        api.setWindowLongPtr(owner, GWL_EXSTYLE, ownerEx);
      }
    }
  }

  hideSiblingChromeWindows() {
    const api = this.ensureApi();
    if (!this.pid) return;
    for (const className of [CHROME_WINDOW_CLASS, "Chrome_WidgetWin_0"]) {
      for (const hwnd of listChromeWindows(this.pid, api, className)) {
        if (hwnd === this.hwnd) continue;
        this.hideFromTaskbar(hwnd);
      }
    }
  }

  applyChromeFrame(ownerHwnd) {
    const api = this.ensureApi();
    if (!this.hwnd || !api.isWindow(this.hwnd)) return false;
    // Chrome Aura drops click/wheel input if this HWND is a WS_CHILD of Electron.
    if (typeof api.setParent === "function") api.setParent(this.hwnd, 0n);
    const currentStyle = Number(api.getWindowLongPtr(this.hwnd, GWL_STYLE));
    const style = (currentStyle | WS_POPUP | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN) & ~WS_CHILD & ~WS_CAPTION & ~WS_THICKFRAME & ~WS_MINIMIZEBOX & ~WS_MAXIMIZEBOX & ~WS_SYSMENU;
    api.setWindowLongPtr(this.hwnd, GWL_STYLE, style);
    const currentEx = Number(api.getWindowLongPtr(this.hwnd, GWL_EXSTYLE));
    const exStyle = (currentEx | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW;
    api.setWindowLongPtr(this.hwnd, GWL_EXSTYLE, exStyle);
    api.setWindowLongPtr(this.hwnd, GWLP_HWNDPARENT, ownerHwnd);
    this.hideFromTaskbar(this.hwnd);
    this.hideSiblingChromeWindows();
    this.parentHwnd = ownerHwnd;
    this.framed = true;
    return true;
  }

  layout(win, rect, screenApi, { restyle = false } = {}) {
    if (!this.attached || !this.hwnd) return false;
    const api = this.ensureApi();
    if (!api.isWindow(this.hwnd)) {
      const recovered = findChromeWindow(this.pid, api);
      if (!recovered) return false;
      this.hwnd = recovered;
      this.framed = false;
      this.positioned = false;
    }
    const ownerHwnd = nativeHandleToHwnd(win.getNativeWindowHandle());
    if (restyle || !this.framed || this.parentHwnd !== ownerHwnd) this.applyChromeFrame(ownerHwnd);
    const screenRect = surfaceToScreenRect(win, rect, screenApi);
    const raise = restyle || !this.positioned;
    api.setWindowPos(
      this.hwnd,
      0n,
      screenRect.x,
      screenRect.y,
      screenRect.width,
      screenRect.height,
      raise ? SWP_SHOWWINDOW | SWP_FRAMECHANGED | SWP_NOACTIVATE : SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER
    );
    this.positioned = true;
    return true;
  }

  raise() {
    if (!this.attached || !this.hwnd) return false;
    const api = this.ensureApi();
    if (!api.isWindow(this.hwnd)) return false;
    api.setWindowPos(this.hwnd, 0n, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    return true;
  }

  hide() {
    if (!this.hwnd) return;
    this.ensureApi().showWindow(this.hwnd, SW_HIDE);
  }

  show() {
    if (!this.hwnd) return;
    this.ensureApi().showWindow(this.hwnd, SW_SHOWNA);
  }

  focus() {
    if (!this.hwnd) return { available: false, message: "Relay 浏览器窗口尚未停靠。" };
    this.ensureApi().setForegroundWindow(this.hwnd);
    return { available: true, message: "已聚焦 Relay 浏览器。" };
  }

  restoreFrame() {
    if (!this.hwnd || !this.api) return false;
    try {
      if (typeof this.api.setParent === "function") this.api.setParent(this.hwnd, 0n);
      if (this.originalStyle != null) this.api.setWindowLongPtr(this.hwnd, GWL_STYLE, this.originalStyle);
      if (this.originalExStyle != null) this.api.setWindowLongPtr(this.hwnd, GWL_EXSTYLE, this.originalExStyle);
      this.api.setWindowLongPtr(this.hwnd, GWLP_HWNDPARENT, 0n);
      this.api.setWindowPos(this.hwnd, 0n, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_FRAMECHANGED | SWP_NOACTIVATE);
      return true;
    } catch {
      return false;
    }
  }

  requestClose() {
    if (!this.hwnd) return false;
    const api = this.ensureApi();
    this.restoreFrame();
    if (typeof api.postMessage === "function") api.postMessage(this.hwnd, WM_CLOSE, 0n, 0n);
    this.attached = false;
    this.framed = false;
    this.positioned = false;
    this.parentHwnd = null;
    return true;
  }

  detach() {
    this.restoreFrame();
    this.attached = false;
    this.hwnd = null;
    this.originalStyle = null;
    this.originalExStyle = null;
    this.parentHwnd = null;
    this.framed = false;
    this.positioned = false;
  }
}

module.exports = {
  BrowserDock,
  validateSurfaceRect,
  surfaceToScreenRect,
  surfaceToParentClient,
  findChromeWindow,
  nativeHandleToHwnd,
  CHROME_WINDOW_CLASS,
  WM_CLOSE,
};
