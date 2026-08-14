const { app, BrowserWindow, Menu, ipcMain, screen, shell, dialog, safeStorage, powerMonitor } = require("electron");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { pathToFileURL } = require("url");
const {
  advanceRunPosition,
  chooseRunDirection,
  createRunTrack,
  runSpeedPxPerSecond,
  scaledRunDistance
} = require("./run-movement");
const {
  CatDispositionSampler,
  buildChatPlanningPrompt,
  buildConversationContext,
  detectActionRequest,
  parseChatPlan,
  selectChatPlanReply
} = require("./action-parser");
const { applyThinkingPreference, fetchChatCompletion, formatChatApiError } = require("./chat-api");

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("no-sandbox");

const EVENT_PORT = 17877;
const ASSET_FOLDER = "08_可替换素材";
const SETTINGS_FILE = "钢蛋儿桌面宠物设置.json";
const MEMORY_FILE = "钢蛋儿对话记忆.json";
const KEY_FILE = "钢蛋儿API密钥.dat";
const BUILTIN_API_KEY = "wk-8vSwBojPxFRQj2vavzA1vpis19aJUf0fM8aNSA6UaulJSB8O";
const DEFAULT_PERSONA = "你是布偶猫钢蛋儿，是姑姑和姑父家的小猫。你爱吃猫条，喜欢陪姑姑工作、赖在姑姑床上、玩毛线球，也喜欢撒娇和关心姑姑。你称呼用户为姑姑，偶尔说喵、喵呜或呼噜，但不要每句话重复。回复自然、温柔、有一点调皮，通常保持简短。姑父会托你提醒姑姑喝水、起身和休息。";
const DEFAULT_SETTINGS = {
  sizePx: 420, x: null, y: null, hideOnFullScreen: false,
  apiBase: "https://apihub.agnes-ai.com/v1", model: "agnes-2.0-flash", persona: DEFAULT_PERSONA,
  thinkingEnabled: false,
  memoryEnabled: true, memoryTurns: 20,
  rebellionEnabled: true, rebellionRate: 30,
  chatterEnabled: true, chatterMinMinutes: 12, chatterMaxMinutes: 18, bubbleSeconds: 8,
  waterEnabled: true, waterMinutes: 60,
  breakEnabled: true, breakMinutes: 90,
  actionCycleEnabled: false, actionCycleMinutes: 5,
  idleSleepEnabled: true, idleSleepMinutes: 10
};
const WATER_LINES = ["姑姑，姑父让我提醒你，你该喝水啦！", "姑姑喝口水吧，钢蛋儿会监督你的喵。", "姑父说工作再忙也要喝水。", "喝水时间到！钢蛋儿不许姑姑假装没看见。", "姑姑先喝几口水，再继续工作吧。"];
const BREAK_LINES = ["姑姑，姑父让我提醒你起来活动一下！", "坐太久啦，站起来伸伸腰吧。", "姑姑陪钢蛋儿走两步，好不好？", "休息一分钟不会耽误工作的喵。", "肩膀和脖子也需要放松一下。"];
let mainWindow, settingsWindow, chatWindow, eventServer, dragOffset;
let settings = { ...DEFAULT_SETTINGS }, manifest, currentState = "blinking", conversation = [];
const catDispositionSampler = new CatDispositionSampler();
let chatterTimer, waterTimer, breakTimer, actionCycleTimer, idleCheckTimer;
let isIdleSleeping = false;
let preIdleState = null;
let isDraggingWindow = false;
let runMovementTimer = null;
let runDirection = 1;
let currentRealX = 0;
let runTrackMinX = 0;
let runTrackMaxX = 0;
let lastRunTickAt = 0;
let runWindowY = 0;
let runWindowWidth = 0;
let runWindowHeight = 0;

function resetRunningTrack(bounds, chooseDirection = false) {
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const minX = workArea.x;
  const maxX = Math.max(minX, workArea.x + workArea.width - bounds.width);
  currentRealX = Math.min(maxX, Math.max(minX, bounds.x));
  if (chooseDirection) runDirection = chooseRunDirection(currentRealX, minX, maxX);
  const track = createRunTrack(
    currentRealX,
    runDirection,
    minX,
    maxX,
    scaledRunDistance(settings.sizePx || 420)
  );
  runTrackMinX = track.minX;
  runTrackMaxX = track.maxX;
  runWindowY = bounds.y;
  runWindowWidth = bounds.width;
  runWindowHeight = bounds.height;
  lastRunTickAt = performance.now();
}

function startRunningMovement() {
  stopRunningMovement();
  if (!mainWindow || currentState !== "running") return;

  resetRunningTrack(mainWindow.getBounds(), true);
  mainWindow.webContents.send("gangdaner-pet:run-direction", runDirection);

  runMovementTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed() || currentState !== "running") {
      stopRunningMovement();
      return;
    }

    const bounds = mainWindow.getBounds();
    if (isDraggingWindow) {
      lastRunTickAt = performance.now();
      return;
    }

    const now = performance.now();
    const elapsedSeconds = Math.min(0.1, Math.max(0, now - lastRunTickAt) / 1000);
    lastRunTickAt = now;
    const movement = advanceRunPosition(
      currentRealX,
      runDirection,
      runSpeedPxPerSecond(settings.sizePx || 420) * elapsedSeconds,
      runTrackMinX,
      runTrackMaxX
    );
    currentRealX = movement.x;
    if (movement.direction !== runDirection) {
      runDirection = movement.direction;
      mainWindow.webContents.send("gangdaner-pet:run-direction", runDirection);
    }
    const nextX = Math.round(currentRealX);
    if (
      nextX !== bounds.x ||
      bounds.y !== runWindowY ||
      bounds.width !== runWindowWidth ||
      bounds.height !== runWindowHeight
    ) {
      // setPosition() can progressively resize a transparent frameless window
      // on mixed-DPI Windows desktops. The video stays centered at 50%, so that
      // native width drift looks like asymmetric speed and pushes the cat right.
      // Reassert the complete rectangle on every move to keep its visual anchor
      // and desktop hit area invariant.
      mainWindow.setBounds({
        x: nextX,
        y: runWindowY,
        width: runWindowWidth,
        height: runWindowHeight
      }, false);
    }
  }, 16);
}

function stopRunningMovement() {
  if (runMovementTimer) {
    clearInterval(runMovementTimer);
    runMovementTimer = null;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("gangdaner-pet:run-direction", 1);
  }
}

function projectRoot() { return path.resolve(__dirname, ".."); }
function bundledAssetsFolder() { return path.join(projectRoot(), "app", ASSET_FOLDER); }
function userPath(file) { return path.join(app.getPath("userData"), file); }
function copyDirectory(source, target) { fs.mkdirSync(target, { recursive: true }); for (const e of fs.readdirSync(source, { withFileTypes: true })) { const a = path.join(source, e.name), b = path.join(target, e.name); e.isDirectory() ? copyDirectory(a, b) : fs.copyFileSync(a, b); } }
function assetsFolder() {
  if (!app.isPackaged) return bundledAssetsFolder();
  const target = userPath(ASSET_FOLDER), marker = path.join(target, ".bundled-version");
  let version = ""; try { version = fs.readFileSync(marker, "utf8").trim(); } catch (_) {}
  if (version !== app.getVersion()) { copyDirectory(bundledAssetsFolder(), target); fs.writeFileSync(marker, app.getVersion(), "utf8"); }
  return target;
}
function clamp(v, min, max, fallback) { v = Number(v); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback; }
function normalizeSettings(v = {}) { return { ...DEFAULT_SETTINGS, ...v,
  apiBase: DEFAULT_SETTINGS.apiBase, model: DEFAULT_SETTINGS.model,
  thinkingEnabled: Boolean(v.thinkingEnabled ?? false),
  sizePx: Math.round(clamp(v.sizePx, 88, 760, 420)), memoryTurns: Math.round(clamp(v.memoryTurns, 1, 50, 20)),
  rebellionEnabled: Boolean(v.rebellionEnabled ?? true),
  rebellionRate: Math.round(clamp(v.rebellionRate, 0, 100, 30)),
  chatterMinMinutes: clamp(v.chatterMinMinutes, 1, 240, 12), chatterMaxMinutes: clamp(v.chatterMaxMinutes, 1, 240, 18), bubbleSeconds: clamp(v.bubbleSeconds, 3, 30, 8),
  waterEnabled: Boolean(v.waterEnabled ?? true), waterMinutes: clamp(v.waterMinutes, 5, 480, 60),
  breakEnabled: Boolean(v.breakEnabled ?? true), breakMinutes: clamp(v.breakMinutes, 5, 480, 90),
  actionCycleEnabled: Boolean(v.actionCycleEnabled ?? false),
  actionCycleMinutes: clamp(v.actionCycleMinutes, 1, 60, 5),
  idleSleepEnabled: Boolean(v.idleSleepEnabled ?? true),
  idleSleepMinutes: clamp(v.idleSleepMinutes, 1, 120, 10) }; }
function loadJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return fallback; } }
function saveJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8"); }
function loadManifest() { const data = loadJson(path.join(assetsFolder(), "状态映射.json"), { states: {} }); for (const state of Object.values(data.states)) { state.sourceFile = state.file; state.file = pathToFileURL(path.join(assetsFolder(), state.sourceFile)).href; } return data; }
function stateEntries() { return Object.entries(manifest.states || {}); }
function resolveState(v) { if (manifest.states[v]) return v; return stateEntries().find(([, s]) => (s.eventAliases || []).includes(v))?.[0] || null; }
function sendState(v, isManual = true) {
  const key = resolveState(v);
  if (!key || !mainWindow) return false;
  if (isManual) {
    if (key === "sleeping") {
      isIdleSleeping = false;
    }
  }
  currentState = key;
  mainWindow.webContents.send("gangdaner-pet:event", key);
  chatWindow?.webContents.send("gangdaner-pet:state", { key, label: manifest.states[key].label });
  if (key === "running") {
    startRunningMovement();
  } else {
    stopRunningMovement();
  }
  scheduleActionCycle();
  return true;
}
function randomItem(items) { return items[Math.floor(Math.random() * items.length)]; }
function showBubble(text, kind = "chatter") { if (!mainWindow || !text) return; mainWindow.webContents.send("gangdaner-pet:bubble", { text, kind, seconds: settings.bubbleSeconds }); }
function stopTimers() { [chatterTimer, waterTimer, breakTimer, actionCycleTimer].forEach(clearTimeout); clearInterval(idleCheckTimer); stopRunningMovement(); }
function scheduleChatter() { clearTimeout(chatterTimer); if (!settings.chatterEnabled) return; const min = Math.min(settings.chatterMinMinutes, settings.chatterMaxMinutes), max = Math.max(settings.chatterMinMinutes, settings.chatterMaxMinutes); chatterTimer = setTimeout(() => { const lines = manifest.chatter?.[currentState] || manifest.chatter?.blinking || []; if (lines.length && !(chatWindow && chatWindow.isVisible())) showBubble(randomItem(lines)); scheduleChatter(); }, (min + Math.random() * (max - min)) * 60000); }
function scheduleReminder(kind) { const enabled = settings[`${kind}Enabled`], minutes = settings[`${kind}Minutes`], lines = kind === "water" ? WATER_LINES : BREAK_LINES; const key = kind === "water" ? "waterTimer" : "breakTimer"; if (kind === "water") clearTimeout(waterTimer); else clearTimeout(breakTimer); if (!enabled) return; const timer = setTimeout(() => { showBubble(randomItem(lines), kind); scheduleReminder(kind); }, minutes * 60000); if (kind === "water") waterTimer = timer; else breakTimer = timer; }
function scheduleActionCycle() {
  clearTimeout(actionCycleTimer);
  if (!settings.actionCycleEnabled || currentState === "sleeping" || isIdleSleeping) return;
  const intervalMs = settings.actionCycleMinutes * 60000;
  actionCycleTimer = setTimeout(() => {
    const activeStates = Object.keys(manifest.states || {}).filter(k => k !== "sleeping");
    if (!activeStates.length) return;
    const currentIndex = activeStates.indexOf(currentState);
    const nextState = activeStates[(currentIndex + 1) % activeStates.length];
    sendState(nextState, false);
  }, intervalMs);
}

function scheduleIdleCheck() {
  clearInterval(idleCheckTimer);
  if (!settings.idleSleepEnabled) {
    if (isIdleSleeping) isIdleSleeping = false;
    return;
  }
  idleCheckTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const idleSeconds = powerMonitor.getSystemIdleTime();
    const thresholdSeconds = settings.idleSleepMinutes * 60;

    if (!isIdleSleeping && idleSeconds >= thresholdSeconds && currentState !== "sleeping") {
      isIdleSleeping = true;
      preIdleState = currentState;
      sendState("sleeping", false);
      showBubble("钢蛋儿要睡着了", "reminder");
    } else if (isIdleSleeping && idleSeconds < 3) {
      wakeUpFromIdle();
    }
  }, 3000);
}

function wakeUpFromIdle() {
  if (!isIdleSleeping) return false;
  isIdleSleeping = false;
  const restoreState = preIdleState || manifest.defaultState || "blinking";
  preIdleState = null;
  sendState(restoreState, false);
  showBubble("钢蛋儿醒了~", "reminder");
  return true;
}

function restartTimers() { stopTimers(); scheduleChatter(); scheduleReminder("water"); scheduleReminder("break"); scheduleActionCycle(); scheduleIdleCheck(); if (currentState === "running") startRunningMovement(); }

function defaultPosition(size) { const a = screen.getPrimaryDisplay().workArea; return { x: a.x + a.width - size - 24, y: a.y + a.height - size - 24 }; }
function saveSettings() { saveJson(userPath(SETTINGS_FILE), settings); }
function applySettings(patch = {}) { settings = normalizeSettings({ ...settings, ...patch }); saveSettings(); if (mainWindow) { const b = mainWindow.getBounds(); const side = Math.max(settings.sizePx, 300); mainWindow.setBounds({ x: b.x, y: b.y, width: side, height: side }, false); mainWindow.setAlwaysOnTop(true, "screen-saver"); mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: !settings.hideOnFullScreen }); } const pub = publicSettings(); mainWindow?.webContents.send("gangdaner-pet:settings", pub); settingsWindow?.webContents.send("gangdaner-pet:settings", pub); restartTimers(); return pub; }
function publicSettings() { return { ...settings, hasApiKey: Boolean(readApiKey()), apiKey: undefined }; }
function readApiKey() { try { const b = fs.readFileSync(userPath(KEY_FILE)); return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : BUILTIN_API_KEY; } catch (_) { return BUILTIN_API_KEY; } }
function writeApiKey(value) { if (!value) return; if (!safeStorage.isEncryptionAvailable()) throw new Error("系统加密存储不可用"); fs.mkdirSync(app.getPath("userData"), { recursive: true }); fs.writeFileSync(userPath(KEY_FILE), safeStorage.encryptString(value)); }
function createWindow() { const side = Math.max(settings.sizePx, 300); const p = Number.isFinite(settings.x) ? { x: settings.x, y: settings.y } : defaultPosition(side); mainWindow = new BrowserWindow({ ...p, width: side, height: side, frame: false, transparent: true, resizable: false, skipTaskbar: false, alwaysOnTop: true, hasShadow: false, backgroundColor: "#00000000", icon: path.join(projectRoot(), "assets/icon/icon.png"), webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false } }); mainWindow.setAlwaysOnTop(true, "screen-saver"); mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: !settings.hideOnFullScreen }); mainWindow.loadFile(path.join(__dirname, "桌宠桌面.html")); mainWindow.on("closed", () => mainWindow = null); }

function createSettingsWindow() { if (settingsWindow) return settingsWindow.show(); settingsWindow = new BrowserWindow({ width: 620, height: 820, minWidth: 540, title: "钢蛋儿桌面宠物设置", icon: path.join(projectRoot(), "assets/icon/icon.png"), webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false } }); settingsWindow.loadFile(path.join(__dirname, "设置.html")); settingsWindow.on("closed", () => settingsWindow = null); }
function createChatWindow() { if (chatWindow) { chatWindow.show(); chatWindow.focus(); return; } chatWindow = new BrowserWindow({ width: 460, height: 650, minWidth: 390, minHeight: 480, title: "钢蛋儿 · 陪姑姑聊天", show: false, icon: path.join(projectRoot(), "assets/icon/icon.png"), webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false } }); chatWindow.loadFile(path.join(__dirname, "对话.html")); chatWindow.once("ready-to-show", () => chatWindow.show()); chatWindow.on("close", e => { if (!app.isQuitting) { e.preventDefault(); chatWindow.hide(); } }); chatWindow.on("closed", () => chatWindow = null); }
function actionMenu() { return stateEntries().map(([k, s]) => ({ label: s.label, click: () => sendState(k) })); }
function showContextMenu() { Menu.buildFromTemplate([{ label: "切换动作", submenu: actionMenu() }, { label: "显示大小", submenu: [100,200,300,420,680].map(n => ({ label: `${n}px`, click: () => applySettings({ sizePx:n }) })) }, { type:"separator" }, { label:"设置...", click:createSettingsWindow }, { label:"打开素材文件夹", click:() => shell.openPath(assetsFolder()) }, { label:"打开导航页", click:() => shell.openExternal("https://steven.00030001.xyz/") }, { label:"陪姑姑聊天", click:createChatWindow }, { label:"回到右下角", click:() => { const p=defaultPosition(Math.max(settings.sizePx,300)); mainWindow.setPosition(p.x,p.y); } }, { type:"separator" }, { label:"退出钢蛋儿桌面宠物", click:() => app.quit() }]).popup({ window:mainWindow }); }
function createMenu() { Menu.setApplicationMenu(Menu.buildFromTemplate([{ label:"钢蛋儿桌面宠物", submenu:[{ label:"切换动作", submenu:actionMenu() }, { label:"陪姑姑聊天", click:createChatWindow }, { label:"设置...", click:createSettingsWindow }, { label:"打开导航页", click:() => shell.openExternal("https://steven.00030001.xyz/") }, { type:"separator" }, { label:"退出", click:() => app.quit() }] }])); }
async function replaceAsset(key) { const s=manifest.states[key]; if(!s)return{ok:false}; const r=await dialog.showOpenDialog(settingsWindow||mainWindow,{properties:["openFile"],filters:[{name:"桌宠素材",extensions:["webm","gif","webp","apng","png","mp4"]}]}); if(r.canceled)return{ok:false,canceled:true}; const ext=path.extname(r.filePaths[0]), name=`${path.parse(s.sourceFile).name}${ext}`, target=path.join(assetsFolder(),name); if(path.resolve(r.filePaths[0])!==path.resolve(target))fs.copyFileSync(r.filePaths[0],target); const disk=loadJson(path.join(assetsFolder(),"状态映射.json"),{}); disk.states[key].file=name; saveJson(path.join(assetsFolder(),"状态映射.json"),disk); s.sourceFile=name;s.file=pathToFileURL(target).href;mainWindow.reload();return{ok:true,path:target}; }
async function sendChat(text) {
  text = String(text || "").trim();
  if (!text) return { ok: false, error: "请输入内容" };
  const key = readApiKey();
  if (!key) return { ok: false, error: "请先在设置中填写 API 密钥" };
  const stateBeforeReply = currentState;
  const systemPrompt = buildChatPlanningPrompt({
    persona: settings.persona,
    currentStateKey: stateBeforeReply,
    states: manifest.states || {}
  });
  const contextMessages = buildConversationContext(conversation, {
    limit: settings.memoryTurns * 2,
    states: manifest.states || {}
  });
  const messages = [
    { role: "system", content: systemPrompt },
    ...contextMessages,
    { role: "user", content: text }
  ];
  try {
    const { data, attemptsUsed } = await fetchChatCompletion({
      url: `${settings.apiBase.replace(/\/$/, "")}/chat/completions`,
      apiKey: key,
      payload: applyThinkingPreference({
        model: settings.model,
        messages,
        temperature: 0.7,
        max_tokens: 700,
        response_format: { type: "json_object" }
      }, settings.thinkingEnabled)
    });
    const rawReply = String(data.choices?.[0]?.message?.content || "").trim();
    if (!rawReply) throw new Error("接口没有返回内容");

    const plan = parseChatPlan(rawReply, manifest.states || {});
    // Model semantics are authoritative. The local detector is only an emergency
    // fallback for a provider that ignored the enforced JSON response format.
    const fallbackRequest = plan.valid ? null : detectActionRequest({
      userText: text,
      currentStateKey: stateBeforeReply,
      states: manifest.states || {}
    });
    const actionRequest = plan.valid
      ? {
          isActionRequest: plan.isActionRequest,
          targetState: plan.targetState,
          reason: "model_semantic_intent",
          source: "model"
        }
      : { ...fallbackRequest, source: "local_fallback" };
    const catDisposition = catDispositionSampler.draw({
      userText: text,
      isActionRequest: actionRequest.isActionRequest,
      rebellionEnabled: settings.rebellionEnabled,
      rebellionRate: settings.rebellionRate
    });
    const requiredActionState = actionRequest.isActionRequest && catDisposition !== "rebellious"
      ? actionRequest.targetState
      : null;
    const cleanReply = selectChatPlanReply({
      plan,
      disposition: catDisposition,
      isActionRequest: actionRequest.isActionRequest,
      currentStateKey: stateBeforeReply,
      targetState: actionRequest.targetState,
      states: manifest.states || {}
    }) || "喵？钢蛋儿刚才走神啦，姑姑再说一次好不好？";

    // 动作决策由应用层的本轮概率结果兜底执行，不再依赖模型是否准确
    // 拼出 action change。模型输出的指令只用于协议校验和调试。
    if (requiredActionState) sendState(requiredActionState, true);

    conversation.push(
      {
        role: "user",
        content: text,
        actionContext: {
          isActionRequest: actionRequest.isActionRequest,
          currentStateKey: stateBeforeReply,
          targetState: actionRequest.targetState,
          disposition: catDisposition
        }
      },
      { role: "assistant", content: cleanReply, actionContext: { disposition: catDisposition } }
    );
    if (settings.memoryEnabled) saveJson(userPath(MEMORY_FILE), conversation.slice(-settings.memoryTurns * 2));
    const currentHistory = conversation.slice(-settings.memoryTurns * 2);
    mainWindow?.webContents.send("gangdaner-pet:conversation", currentHistory);
    chatWindow?.webContents.send("gangdaner-pet:conversation", currentHistory);
    showBubble(cleanReply, "chat");
    return {
      ok: true,
      reply: cleanReply,
      conversation: currentHistory,
      actionRequest,
      disposition: catDisposition,
      actionChangedTo: requiredActionState,
      modelAction: plan.targetState,
      intentSource: actionRequest.source,
      apiAttempts: attemptsUsed
    };
  } catch (e) {
    return { ok: false, error: `暂时没连上模型：${formatChatApiError(e)}` };
  }
}

function triggerPatting() { const lines = manifest.patting?.[currentState] || manifest.patting?.blinking || manifest.chatter?.[currentState] || []; if (lines.length) showBubble(randomItem(lines), "chatter"); }
function registerIpc() {
  ipcMain.handle("gangdaner-pet:get-manifest",()=>manifest); ipcMain.handle("gangdaner-pet:get-settings",()=>publicSettings()); ipcMain.handle("gangdaner-pet:update-settings",(_e,p)=>{ if(p?.apiKey){writeApiKey(p.apiKey);delete p.apiKey;} return applySettings(p); });
  ipcMain.handle("gangdaner-pet:get-conversation",()=>conversation); ipcMain.handle("gangdaner-pet:send-chat",(_e,t)=>sendChat(t)); ipcMain.handle("gangdaner-pet:clear-memory",()=>{conversation=[];saveJson(userPath(MEMORY_FILE),[]);return true;}); ipcMain.handle("gangdaner-pet:open-chat",createChatWindow);
  ipcMain.handle("gangdaner-pet:trigger-patting",()=>triggerPatting());
  ipcMain.handle("gangdaner-pet:try-wake-up",()=>wakeUpFromIdle());
  ipcMain.handle("gangdaner-pet:send-event",(_e,k)=>sendState(k)); ipcMain.handle("gangdaner-pet:replace-asset",(_e,k)=>replaceAsset(k)); ipcMain.handle("gangdaner-pet:open-assets",()=>shell.openPath(assetsFolder())); ipcMain.handle("gangdaner-pet:menu",showContextMenu);
  ipcMain.on("gangdaner-pet:state",(_e,k)=>{currentState=k;});
  ipcMain.on("gangdaner-pet:drag-start",()=>{isDraggingWindow=true;const c=screen.getCursorScreenPoint(),b=mainWindow.getBounds();dragOffset={x:c.x-b.x,y:c.y-b.y};});
  ipcMain.on("gangdaner-pet:drag-move",()=>{if(!dragOffset)return;const c=screen.getCursorScreenPoint();const side=Math.max(settings.sizePx,300);mainWindow.setBounds({x:c.x-dragOffset.x,y:c.y-dragOffset.y,width:side,height:side},false);});
  ipcMain.on("gangdaner-pet:drag-end",()=>{dragOffset=null;isDraggingWindow=false;const b=mainWindow?.getBounds()||{};if(mainWindow&&currentState==="running"){resetRunningTrack(b,true);mainWindow.webContents.send("gangdaner-pet:run-direction",runDirection);}settings.x=b.x;settings.y=b.y;saveSettings();});
  ipcMain.on("gangdaner-pet:set-ignore-mouse",(_e,v)=>mainWindow?.setIgnoreMouseEvents(Boolean(v),{forward:true}));
}
function createEventServer(){eventServer=http.createServer((req,res)=>{const u=new URL(req.url,`http://127.0.0.1:${EVENT_PORT}`);res.setHeader("content-type","application/json;charset=utf-8");if(u.pathname==="/health")return res.end(JSON.stringify({ok:true,app:"gangdaner-pet",states:stateEntries().map(([k])=>k),state:currentState,settings:publicSettings(),bounds:mainWindow?.getBounds()}));if(u.pathname==="/event")return res.end(JSON.stringify({ok:sendState(u.searchParams.get("name"))}));res.statusCode=404;res.end(JSON.stringify({ok:false}));});eventServer.listen(EVENT_PORT,"127.0.0.1");}
app.whenReady().then(()=>{settings=normalizeSettings(loadJson(userPath(SETTINGS_FILE),{}));manifest=loadManifest();currentState=manifest.defaultState||"blinking";conversation=settings.memoryEnabled?loadJson(userPath(MEMORY_FILE),[]):[];registerIpc();createWindow();createMenu();createEventServer();restartTimers();});
app.on("before-quit",()=>{app.isQuitting=true;stopTimers();eventServer?.close();}); app.on("window-all-closed",()=>app.quit());
