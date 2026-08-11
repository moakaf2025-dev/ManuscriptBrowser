const { app, BrowserWindow, Menu, shell, ipcMain, desktopCapturer, dialog, nativeImage, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");

// Windows taskbar identification (helps show correct icon + name)
if (process.platform === "win32") {
  app.setAppUserModelId("com.moakaf.manuscriptbrowser");
}

// ---- Opening a manuscript handed to the program on the command line ----
//
// This is what "Open with" gives you: Windows launches the executable with the
// file as an argument. Without a single-instance lock every such launch would be
// a whole second copy of the program - a second Electron, a second renderer, a
// second copy of everything - and the reader's open manuscript would be in the
// window they just buried. So the first instance keeps the lock, and later
// launches hand it their argument and exit.
//
// The path is not opened here. Main only holds it; the pane collects it through
// the preload bridge and decides what to do, which keeps the two panes from both
// opening the same file: takePendingOpenPath clears it, so exactly one caller
// ever receives a given path.
// What the program can actually open, mirroring the file picker's accept list.
const MANUSCRIPT_EXT = /\.(pdf|zip|rar|7z|tar|tar\.gz|tgz|tar\.bz2|jpe?g|png|tiff?|bmp|webp|gif)$/i;

function manuscriptPathFromArgv(argv) {
  // Deliberately not "the argument at index N". The command line differs between
  // a packaged launch, `electron . <file>`, and a relaunch by Electron itself,
  // which can insert switches of its own ahead of the script - counting positions
  // picked up the app's own entry file. An argument is the manuscript when it is
  // an existing file the program can open, and nothing else qualifies.
  for (const arg of argv.slice(1)) {
    if (!arg || arg.startsWith("-")) continue; // Chromium switches, not paths
    if (!MANUSCRIPT_EXT.test(arg)) continue;
    try {
      const resolved = path.resolve(arg);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
    } catch { /* not a usable path */ }
  }
  return null;
}

function announceToPanes(win) {
  if (!win || win.isDestroyed()) return;
  for (const frame of win.webContents.mainFrame.framesInSubtree) {
    try { frame.send("ms:open-path-available"); } catch { /* frame already gone */ }
  }
}

let pendingOpenPath = manuscriptPathFromArgv(process.argv);

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // A copy is already running and has been handed our argument by Electron.
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const requested = manuscriptPathFromArgv(argv);
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    if (!requested) return;
    pendingOpenPath = requested;
    // Announce only. Whoever asks first gets it, so a second pane cannot open the
    // same manuscript on top of the first.
    //
    // Sent to every frame, not with webContents.send: that delivers to the main
    // frame alone, and the app runs in the pane iframes, so the announcement would
    // arrive nowhere that could act on it.
    announceToPanes(win);
  });
}

ipcMain.handle("ms:take-pending-open-path", async () => {
  const taken = pendingOpenPath;
  pendingOpenPath = null;
  return taken;
});

// Resolve icon path: when packed, icon.ico is in app.asar.unpacked; in dev, alongside main.js
function resolveIconPath() {
  const candidates = [
    path.join(process.resourcesPath || "", "app.asar.unpacked", "icon.ico"),
    path.join(__dirname, "icon.ico"),
    path.join(process.resourcesPath || "", "app.asar.unpacked", "icon.png"),
    path.join(__dirname, "icon.png"),
  ];
  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) return p; } catch {}
  }
  return path.join(__dirname, "icon.ico");
}

function createWindow() {
  const iconPath = resolveIconPath();
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: "#1a1613",
    autoHideMenuBar: true,
    title: "متصفح المخطوطات — إصدار 2",
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      preload: path.join(__dirname, "preload.js"),
      // The whole UI runs inside an iframe (SplitView gives each pane its own
      // document and localStorage namespace). Without this the preload runs only
      // in the top frame, window.msElectron is undefined where the app actually
      // lives, and every clipboard call falls through to the web API - which
      // file:// origins restrict. Copying a snip had no fallback at all and
      // simply never worked.
      //
      // This only lets the preload run in child frames; it does not put Node in
      // the page. contextIsolation stays on, nodeIntegration stays off, and the
      // only frames ever loaded are this app's own local files.
      nodeIntegrationInSubFrames: true,
    },
  });

  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, "app", "index.html"));

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

// ---- IPC handlers for global screen capture + saving ----
ipcMain.handle("ms:get-sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 200 },
    fetchWindowIcons: false,
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : null,
    display_id: s.display_id,
  }));
});

ipcMain.handle("ms:choose-save-folder", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: "اختر مجلد لحفظ اللقطات",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("ms:save-file", async (event, payload) => {
  const { folder, subFolder, filename, bytes } = payload || {};
  if (!folder || !filename) throw new Error("مسار أو اسم الملف مفقود");
  const targetDir = subFolder ? path.join(folder, subFolder) : folder;
  fs.mkdirSync(targetDir, { recursive: true });
  const full = path.join(targetDir, filename);
  fs.writeFileSync(full, Buffer.from(bytes));
  return full;
});

// ---- Clipboard IPC handlers (renderer cannot access `clipboard` directly) ----
ipcMain.handle("clipboard:image", async (_event, dataUrl) => {
  try {
    if (!dataUrl || typeof dataUrl !== "string") return false;
    const img = nativeImage.createFromDataURL(dataUrl);
    if (!img || img.isEmpty()) return false;
    clipboard.writeImage(img);
    return true;
  } catch (e) {
    return false;
  }
});

ipcMain.handle("clipboard:text", async (_event, text) => {
  try {
    clipboard.writeText(String(text ?? ""));
    return true;
  } catch (e) {
    return false;
  }
});

// Rich copy: the manuscript card is meant to paste into Word as a table, which
// needs text/html on the clipboard. navigator.clipboard.write() is the web way
// to do that and file:// origins refuse it, so route it through the main process.
ipcMain.handle("clipboard:html", async (_event, payload) => {
  try {
    const { text, html } = payload || {};
    clipboard.write({ text: String(text ?? ""), html: String(html ?? "") });
    return true;
  } catch (e) {
    return false;
  }
});

if (gotTheLock) app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
