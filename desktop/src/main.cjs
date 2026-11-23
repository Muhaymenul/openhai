'use strict';

const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { ORIGIN, WORKSPACE, isWorkspaceUrl, isExternalUrl } = require('./policy.cjs');
const { probeWorkspace, startBackend, stopBackend } = require('./backend.cjs');
const { ShutdownCoordinator } = require('./shutdown.cjs');
const { optionValue, runtimePaths, validProjectRoot } = require('./runtime-paths.cjs');

const desktopRoot = path.resolve(__dirname, '..');
const runtime = runtimePaths({ packaged: app.isPackaged, sourceRoot: desktopRoot,
  executablePath: app.getPath('exe'), dataOverride: optionValue(process.argv, '--desktop-data-dir') });
let projectRoot = runtime.defaultProjectRoot;
const localRoot = runtime.localRoot;
const settingsPath = path.join(localRoot, 'desktop-settings.json');
const smoke = process.argv.includes('--desktop-smoke');
const lifecycleMode = optionValue(process.argv, '--desktop-lifecycle-smoke');
const lifecycleResult = {};
const loadingPath = path.join(__dirname, 'loading.html');
const logDir = path.join(localRoot, 'logs');
const tempDir = path.join(localRoot, 'tmp');
for (const dir of ['profile', 'session', 'logs', 'tmp', 'crashes', 'downloads']) {
  fs.mkdirSync(path.join(localRoot, dir), { recursive: true });
}
// Set paths before ready, so Electron's own browser data remains in this folder.
app.setName('教研阅记');
app.setPath('userData', path.join(localRoot, 'profile'));
app.setPath('sessionData', path.join(localRoot, 'session'));
app.setPath('temp', tempDir);
app.setPath('crashDumps', path.join(localRoot, 'crashes'));
app.setPath('downloads', path.join(localRoot, 'downloads'));
app.setAppLogsPath(logDir);
process.env.TEMP = tempDir;
process.env.TMP = tempDir;
app.commandLine.appendSwitch('disk-cache-size', String(64 * 1024 * 1024));

const logFile = path.join(logDir, 'desktop.log');
if (fs.existsSync(logFile) && fs.statSync(logFile).size > 1024 * 1024) {
  fs.renameSync(logFile, `${logFile}.previous`);
}
function log(message) {
  // Avoid URLs with query strings, model responses, and configuration content.
  fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
}

let window;
let connecting = false;
let startup;
let closingWindow;
let shutdownStarted = false;
let shutdownComplete = false;
let shutdownAttempt;
let exitCode = 0;
let managedRoot = null;
const coordinator = new ShutdownCoordinator(async () => {
  await stopBackend(managedRoot, { ...process.env, TEMP: tempDir, TMP: tempDir }).completion;
});
const primaryInstance = app.requestSingleInstanceLock();

if (!primaryInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (lifecycleMode === 'single') lifecycleResult.secondInstanceObserved = true;
    if (closingWindow && !closingWindow.isDestroyed()) { closingWindow.show(); closingWindow.focus(); return; }
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId('org.openhai.jiaoyan.desktop');
    configureSession();
    createWindow();
    createMenu();
    await window.loadFile(loadingPath);
    window.show();
    if (!(await resolveProject())) { app.quit(); return; }
    if (shutdownStarted) return;
    await connect();
    if (lifecycleMode && lifecycleMode !== 'startup' && window && !shutdownStarted) {
      await require('./lifecycle-smoke.cjs')({ window, app, dialog, probeWorkspace, result: lifecycleResult });
    }
  }).catch((error) => {
    if (shutdownStarted) return;
    log(`Startup failed: ${error.code || error.name || 'Error'}`);
    dialog.showErrorBox('教研阅记启动失败', `请查看桌面日志：${logFile}，或运行项目中的“检查Demo.cmd”。`);
    app.quit();
  });
}

async function resolveProject(forceChoose = false) {
  const supplied = optionValue(process.argv, '--desktop-project-root');
  if (!forceChoose && supplied) {
    if (!validProjectRoot(supplied)) throw new Error('指定的 demo 项目目录不完整。');
    projectRoot = path.resolve(supplied);
    if (app.isPackaged) fs.writeFileSync(settingsPath, JSON.stringify({ projectRoot }, null, 2));
    return true;
  }
  if (!forceChoose && validProjectRoot(projectRoot)) return true;
  if (!forceChoose) {
    try {
      const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (validProjectRoot(saved.projectRoot)) { projectRoot = saved.projectRoot; return true; }
    } catch { /* First launch, or a project moved since the last launch. */ }
  }
  const intro = await dialog.showMessageBox(window, {
    type: 'info', title: '连接教研阅记项目', message: '选择已部署好的教研阅记 demo 文件夹',
    detail: '请选择包含 docker-compose.yml 和 scripts 的完整项目。安装版继续使用本机 Docker Desktop、PostgreSQL，以及该项目内的论文、笔记和个人模型配置。',
    buttons: ['选择项目文件夹', '取消'], defaultId: 0, cancelId: 1,
  });
  if (intro.response !== 0) return false;
  const result = await dialog.showOpenDialog(window, {
    title: '选择教研阅记完整项目文件夹', properties: ['openDirectory'],
  });
  if (result.canceled) return false;
  if (!validProjectRoot(result.filePaths[0])) {
    await dialog.showMessageBox(window, { type: 'error', message: '此目录缺少教研阅记项目文件。', detail: '请选择含 docker-compose.yml、scripts 和 app 的父项目目录。' });
    return resolveProject(true);
  }
  projectRoot = result.filePaths[0];
  fs.writeFileSync(settingsPath, JSON.stringify({ projectRoot }, null, 2));
  return true;
}

function configureSession() {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write');
  });
  session.defaultSession.on('will-download', (_event, item) => {
    // Preserve the web app's normal PDF/ZIP/Markdown export flow.
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
  });
}

function openExternal(url) {
  if (isExternalUrl(url)) shell.openExternal(url).catch(() => log('External link could not be opened.'));
}

function createWindow() {
  window = new BrowserWindow({
    title: '教研阅记', width: 1440, height: 940, minWidth: 880, minHeight: 620,
    icon: app.isPackaged ? path.join(process.resourcesPath, 'assets', 'logo.png')
      : path.join(desktopRoot, 'assets', 'logo.png'),
    backgroundColor: '#f6f3ec', show: false,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, spellcheck: false,
    },
  });
  window.once('ready-to-show', () => window.show());
  window.on('page-title-updated', (event) => { event.preventDefault(); window.setTitle('教研阅记'); });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(window, {
      type: 'question', title: '保存编辑内容', message: '当前页面有未保存的内容。',
      detail: '继续编辑可返回页面保存；放弃更改会离开当前页面。',
      buttons: ['继续编辑', '放弃更改并离开'], defaultId: 0, cancelId: 0,
    });
    // Electron's event uses preventDefault to allow leaving despite beforeunload.
    if (choice === 1) event.preventDefault();
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isWorkspaceUrl(url)) { event.preventDefault(); openExternal(url); }
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (!isWorkspaceUrl(url)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWorkspaceUrl(url) && new URL(url).pathname.endsWith('/pdf')) shell.openExternal(url).catch(() => log('PDF browser link failed.'));
    else if (isWorkspaceUrl(url)) window.loadURL(url).catch(() => log('Local navigation failed.'));
    else openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('render-process-gone', () => log('Renderer ended; use the reconnect menu to recover.'));
  window.on('closed', () => { window = null; });
}

function createMenu() {
  const route = (url) => { if (!connecting && window) window.loadURL(url).catch(() => log('Navigation failed.')); };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '工作区', submenu: [
      { label: '回到首页', click: () => route(WORKSPACE) },
      { label: '重新连接', click: () => connect() },
      { label: '选择 demo 项目文件夹…', enabled: !managedRoot, click: async () => {
        if (!connecting && await resolveProject(true)) await connect();
      } },
      { type: 'separator' },
      { label: '在浏览器打开', click: () => shell.openExternal(WORKSPACE) },
      { label: '打开下载文件夹', click: () => shell.openPath(app.getPath('downloads')) },
      { type: 'separator' },
      { label: '退出桌面版', accelerator: 'Alt+F4', role: 'quit' },
    ] },
    { label: '编辑', submenu: [
      { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' },
    ] },
    { label: '视图', submenu: [
      { role: 'reload', label: '刷新' }, { type: 'separator' },
      { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' },
      { role: 'zoomOut', label: '缩小' }, { role: 'togglefullscreen', label: '全屏' },
    ] },
    { label: '帮助', submenu: [
      { label: '桌面版使用说明', click: () => shell.openPath(app.isPackaged
        ? path.join(process.resourcesPath, '安装版使用说明.html')
        : path.join(desktopRoot, '使用说明.html')) },
      { label: '打开桌面日志', click: () => shell.openPath(logDir) },
      { label: '关于教研阅记桌面版', click: () => dialog.showMessageBox(window, {
        type: 'info', title: '教研阅记', message: `教研阅记 · 桌面版 ${app.getVersion()}`,
        detail: managedRoot
          ? '与网页版共用本机资料。关闭窗口会自动停止本项目后台，保留资料；便携部署同时停止自带数据库，系统安装的 PostgreSQL 服务继续运行。再次打开自动恢复服务。'
          : '与网页版共用本机资料。当前普通部署使用共享后台；需要停止时使用原项目的“停止Demo.cmd”。',
      }) },
    ] },
  ]));
}

async function connect() {
  if (connecting || !window || shutdownStarted) return;
  if (!managedRoot && validProjectRoot(projectRoot)) { managedRoot = projectRoot; createMenu(); }
  connecting = true;
  try {
    await window.loadFile(loadingPath);
    if (!window || shutdownStarted) return;
    window.show();
    if (managedRoot || !(await probeWorkspace())) {
      log('Starting existing local services without opening a browser.');
      startup = startBackend(projectRoot, { ...process.env, TEMP: tempDir, TMP: tempDir });
      coordinator.trackStart(startup.completion);
      if (lifecycleMode === 'startup') {
        lifecycleResult.closedDuringStartup = true;
        lifecycleResult.pendingStartupTracked = coordinator.starts.size > 0;
        window.close();
      }
      let timer;
      try {
        await Promise.race([
          startup.completion,
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('启动等待超时。请稍后重新连接，或运行“检查Demo.cmd”。')), 450000); }),
        ]);
      } finally { clearTimeout(timer); startup = null; }
    }
    if (!window || shutdownStarted) return;
    if (!(await probeWorkspace())) throw new Error('本机工作区暂时不可用。请确认 PostgreSQL 和 Docker Desktop 已启动。');
    await window.loadURL(WORKSPACE);
    window.show();
    log('Workspace ready.');
    if (smoke) await runSmoke();
  } catch (error) {
    if (shutdownStarted) return;
    log(`Connection failed: ${error.code || error.name || 'Error'}`);
    if (smoke) {
      writeSmoke({ ok: false, error: error.message });
      exitCode = 1;
      app.quit();
      return;
    }
    if (window) await dialog.showMessageBox(window, {
      type: 'error', title: '连接工作区', message: '暂时无法打开工作区',
      detail: `${error.message}\n\n可从“工作区 → 重新连接”重试。原启动日志位于项目 runtime/launcher；桌面日志：${logFile}`,
    });
  } finally { connecting = false; }
}

function writeSmoke(report) {
  const dir = path.join(localRoot, 'qa');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'smoke.json'), JSON.stringify({ ...report, electron: process.versions.electron, at: new Date().toISOString() }, null, 2));
}

async function runSmoke() {
  const qaDir = path.join(localRoot, 'qa');
  fs.mkdirSync(qaDir, { recursive: true });
  const result = await require('./smoke.cjs')(window, app, qaDir);
  writeSmoke({ ok: true, ...result, packaged: app.isPackaged, projectRoot, origin: ORIGIN, paths: {
    userData: app.getPath('userData'), sessionData: app.getPath('sessionData'), temp: app.getPath('temp'),
  }, security: { ...window.webContents.getLastWebPreferences(), preload: undefined },
  processes: app.getAppMetrics().map(({ type, memory }) => ({ type, workingSetKB: memory.workingSetSize })) });
  app.quit();
}

function writeExitStatus(phase, error) {
  fs.writeFileSync(path.join(logDir, 'exit-status.json'), JSON.stringify({
    phase, projectRoot: managedRoot, at: new Date().toISOString(), error: error?.message,
  }, null, 2));
  if (lifecycleMode && phase === 'stopped') {
    const qaDir = path.join(localRoot, 'qa'); fs.mkdirSync(qaDir, { recursive: true });
    let aliasReleased = true;
    try { const map = JSON.parse(fs.readFileSync(path.join(managedRoot, 'database', 'portable-path.json'), 'utf8'));
      aliasReleased = !fs.existsSync(`${map.drive}\\database\\data\\PG_VERSION`);
    } catch { /* The database script performs the authoritative ownership check. */ }
    fs.writeFileSync(path.join(qaDir, `lifecycle-${lifecycleMode}.json`), JSON.stringify({
      ...lifecycleResult, mode: lifecycleMode, stopped: true, aliasReleased,
      databaseStopped: !fs.existsSync(path.join(managedRoot, 'database', 'data', 'postmaster.pid')),
    }, null, 2));
  }
}

function showClosingWindow() {
  if (closingWindow && !closingWindow.isDestroyed()) return;
  closingWindow = new BrowserWindow({
    title: '正在退出教研阅记', width: 500, height: 290, resizable: false,
    minimizable: false, maximizable: false, autoHideMenuBar: true, show: false,
    backgroundColor: '#f6f3ec',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  closingWindow.setMenu(null);
  closingWindow.on('close', (event) => { if (!shutdownComplete) event.preventDefault(); });
  closingWindow.once('ready-to-show', () => closingWindow.show());
  closingWindow.loadFile(path.join(__dirname, 'closing.html')).catch(() => closingWindow?.show());
}

function beginShutdown() {
  if (shutdownAttempt) return shutdownAttempt;
  shutdownStarted = true;
  showClosingWindow();
  writeExitStatus('stopping');
  log('Closing reader accepted. Waiting for startup, then stopping project services.');
  shutdownAttempt = (async () => {
    try {
      await coordinator.finish();
      shutdownComplete = true;
      writeExitStatus('stopped');
      log('Project shutdown completed. Desktop exited safely.');
      if (closingWindow && !closingWindow.isDestroyed()) closingWindow.destroy();
      app.exit(exitCode);
    } catch (error) {
      writeExitStatus('error', error);
      log('Project shutdown failed. The desktop remains open for retry.');
      if (smoke || lifecycleMode) { process.exitCode = 1; return; }
      const answer = await dialog.showMessageBox(closingWindow, {
        type: 'error', title: '退出教研阅记', message: '后台暂时未能完全停止',
        detail: `${error.message}\n\n请保持外置盘连接。可以重试，或返回工作区查看状态。`,
        buttons: ['重试退出', '返回工作区'], defaultId: 0, cancelId: 1,
      });
      shutdownAttempt = null;
      if (answer.response === 0) { beginShutdown(); return; }
      // Reopen after a failed cleanup without forcing an unsafe exit.
      shutdownStarted = false;
      createWindow(); createMenu();
      if (closingWindow && !closingWindow.isDestroyed()) closingWindow.destroy();
      closingWindow = null;
      await connect();
    }
  })();
  return shutdownAttempt;
}

// will-quit runs only after renderer beforeunload has allowed the real close.
app.on('will-quit', (event) => {
  if (!primaryInstance || !managedRoot || shutdownComplete) return;
  event.preventDefault();
  beginShutdown();
});
app.on('window-all-closed', () => app.quit());
