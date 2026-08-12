const { app, BrowserWindow, Menu, ipcMain, screen, shell, dialog } = require("electron");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { pathToFileURL } = require("url");

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("no-sandbox");

const EVENT_PORT = 17877;
const ASSET_FOLDER = "08_可替换素材";
const SETTINGS_FILE = "钢蛋儿桌面宠物设置.json";
const DEFAULT_SETTINGS = { sizePx: 420, x: null, y: null, hideOnFullScreen: false };
let mainWindow = null;
let settingsWindow = null;
let eventServer = null;
let settings = { ...DEFAULT_SETTINGS };
let manifest = null;
let dragOffset = null;

function projectRoot() { return path.resolve(__dirname, ".."); }
function bundledAssetsFolder() { return path.join(projectRoot(), "app", ASSET_FOLDER); }
function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to); else fs.copyFileSync(from, to);
  }
}
function assetsFolder() {
  if (!app.isPackaged) return bundledAssetsFolder();
  const target = path.join(app.getPath("userData"), ASSET_FOLDER);
  const marker = path.join(target, ".bundled-version");
  let installedVersion = "";
  try { installedVersion = fs.readFileSync(marker, "utf8").trim(); } catch (_) {}
  if (installedVersion !== app.getVersion()) {
    fs.mkdirSync(target, { recursive: true });
    copyDirectory(bundledAssetsFolder(), target);
    fs.writeFileSync(marker, app.getVersion(), "utf8");
  }
  return target;
}
function settingsPath() { return path.join(app.getPath("userData"), SETTINGS_FILE); }
function clampSize(value) { return Math.min(760, Math.max(88, Math.round(Number(value) || 420))); }
function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath(), "utf8")) }; }
  catch (_) { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings() {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
}
function loadManifest() {
  const file = path.join(assetsFolder(), "状态映射.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const state of Object.values(data.states || {})) {
    state.sourceFile = state.file;
    state.file = pathToFileURL(path.join(assetsFolder(), state.sourceFile)).href;
  }
  return data;
}
function stateEntries() { return Object.entries((manifest && manifest.states) || {}); }
function resolveState(value) {
  const text = String(value || "");
  if (manifest.states[text]) return text;
  return stateEntries().find(([, state]) => (state.eventAliases || []).includes(text))?.[0] || null;
}
function sendState(key) {
  const resolved = resolveState(key);
  if (!resolved || !mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.webContents.send("gangdaner-pet:event", resolved);
  return true;
}
function defaultPosition(size) {
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + area.width - size - 24, y: area.y + area.height - size - 24 };
}
function applyVisibility() {
  if (!mainWindow) return;
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: !settings.hideOnFullScreen });
  mainWindow.setAlwaysOnTop(true, "floating");
}
function applySettings(patch) {
  if (Object.prototype.hasOwnProperty.call(patch, "sizePx")) settings.sizePx = clampSize(patch.sizePx);
  if (typeof patch.hideOnFullScreen === "boolean") settings.hideOnFullScreen = patch.hideOnFullScreen;
  if (mainWindow && !mainWindow.isDestroyed()) {
    const b = mainWindow.getBounds();
    mainWindow.setBounds({ x: b.x, y: b.y, width: settings.sizePx, height: settings.sizePx }, false);
  }
  applyVisibility(); saveSettings();
  mainWindow?.webContents.send("gangdaner-pet:settings", settings);
  settingsWindow?.webContents.send("gangdaner-pet:settings", settings);
  return settings;
}
function resetPosition() {
  const p = defaultPosition(settings.sizePx);
  mainWindow?.setPosition(p.x, p.y);
}
function createWindow() {
  const p = Number.isFinite(settings.x) && Number.isFinite(settings.y) ? { x: settings.x, y: settings.y } : defaultPosition(settings.sizePx);
  mainWindow = new BrowserWindow({
    ...p, width: settings.sizePx, height: settings.sizePx,
    frame: false, transparent: true, resizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: false, alwaysOnTop: true, hasShadow: false,
    backgroundColor: "#00000000",
    icon: path.join(projectRoot(), "assets", "icon", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  applyVisibility();
  mainWindow.loadFile(path.join(__dirname, "桌宠桌面.html"));
  mainWindow.on("move", () => { if (!dragOffset) { const b = mainWindow.getBounds(); settings.x = b.x; settings.y = b.y; saveSettings(); } });
  mainWindow.on("closed", () => { mainWindow = null; });
}
function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) return settingsWindow.focus();
  settingsWindow = new BrowserWindow({ width: 500, height: 650, title: "钢蛋儿桌面宠物设置", alwaysOnTop: true,
    icon: path.join(projectRoot(), "assets", "icon", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false } });
  settingsWindow.loadFile(path.join(__dirname, "设置.html"));
  settingsWindow.on("closed", () => { settingsWindow = null; });
}
function actionMenu() { return stateEntries().map(([key, state]) => ({ label: state.label || key, click: () => sendState(key) })); }
function showContextMenu() {
  Menu.buildFromTemplate([
    { label: "切换动作", submenu: actionMenu() },
    { label: "显示大小", submenu: [100, 200, 300, 420, 680].map(size => ({ label: `${size}px`, click: () => applySettings({ sizePx: size }) })) },
    { type: "separator" },
    { label: "设置...", click: createSettingsWindow },
    { label: "打开素材文件夹", click: () => shell.openPath(assetsFolder()) },
    { label: "回到右下角", click: resetPosition },
    { type: "separator" },
    { label: "退出钢蛋儿桌面宠物", click: () => app.quit() }
  ]).popup({ window: mainWindow });
}
function createMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: "钢蛋儿桌面宠物", submenu: [
    { label: "切换动作", submenu: actionMenu() }, { label: "设置...", accelerator: "CommandOrControl+,", click: createSettingsWindow },
    { label: "打开素材文件夹", click: () => shell.openPath(assetsFolder()) }, { type: "separator" },
    { label: "退出", accelerator: "CommandOrControl+Q", click: () => app.quit() }
  ] }]));
}
async function replaceAsset(key) {
  const state = manifest.states[key]; if (!state) return { ok: false };
  const result = await dialog.showOpenDialog(settingsWindow || mainWindow, { properties: ["openFile"], filters: [{ name: "桌宠素材", extensions: ["webm", "gif", "webp", "apng", "png", "mp4"] }] });
  if (result.canceled) return { ok: false, canceled: true };
  const source = result.filePaths[0]; const ext = path.extname(source);
  const oldName = state.sourceFile || path.basename(new URL(state.file).pathname);
  const targetName = `${path.parse(oldName).name}${ext}`;
  const target = path.join(assetsFolder(), targetName);
  if (path.resolve(source) !== path.resolve(target)) fs.copyFileSync(source, target);
  const diskManifestPath = path.join(assetsFolder(), "状态映射.json");
  const diskManifest = JSON.parse(fs.readFileSync(diskManifestPath, "utf8"));
  diskManifest.states[key].file = targetName;
  fs.writeFileSync(diskManifestPath, JSON.stringify(diskManifest, null, 2), "utf8");
  state.sourceFile = targetName; state.file = pathToFileURL(target).href;
  mainWindow.reload(); return { ok: true, path: target };
}
function registerIpc() {
  ipcMain.handle("gangdaner-pet:get-manifest", () => manifest);
  ipcMain.handle("gangdaner-pet:get-settings", () => settings);
  ipcMain.handle("gangdaner-pet:update-settings", (_e, patch) => applySettings(patch || {}));
  ipcMain.handle("gangdaner-pet:send-event", (_e, key) => sendState(key));
  ipcMain.handle("gangdaner-pet:replace-asset", (_e, key) => replaceAsset(key));
  ipcMain.handle("gangdaner-pet:open-assets", () => shell.openPath(assetsFolder()));
  ipcMain.handle("gangdaner-pet:menu", showContextMenu);
  ipcMain.on("gangdaner-pet:drag-start", () => { const c = screen.getCursorScreenPoint(), b = mainWindow.getBounds(); dragOffset = { x: c.x - b.x, y: c.y - b.y }; });
  ipcMain.on("gangdaner-pet:drag-move", () => { if (!dragOffset || !mainWindow) return; const c = screen.getCursorScreenPoint(); mainWindow.setBounds({ x: c.x - dragOffset.x, y: c.y - dragOffset.y, width: settings.sizePx, height: settings.sizePx }, false); });
  ipcMain.on("gangdaner-pet:drag-end", () => { dragOffset = null; if (mainWindow) { const b = mainWindow.getBounds(); settings.x = b.x; settings.y = b.y; saveSettings(); } });
}
function createEventServer() {
  eventServer = http.createServer((req, res) => { const url = new URL(req.url, `http://127.0.0.1:${EVENT_PORT}`); res.setHeader("content-type", "application/json; charset=utf-8");
    if (url.pathname === "/health") return res.end(JSON.stringify({ ok: true, app: "gangdaner-pet", states: stateEntries().map(([key]) => key), settings, bounds: mainWindow?.getBounds() }));
    if (url.pathname === "/event") return res.end(JSON.stringify({ ok: sendState(url.searchParams.get("name")) }));
    res.statusCode = 404; res.end(JSON.stringify({ ok: false })); });
  eventServer.listen(EVENT_PORT, "127.0.0.1");
}
app.whenReady().then(() => { settings = loadSettings(); manifest = loadManifest(); registerIpc(); createWindow(); createMenu(); createEventServer(); });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => eventServer?.close());
