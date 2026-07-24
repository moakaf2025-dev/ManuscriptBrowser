const { app, BrowserWindow, Menu, shell, ipcMain, desktopCapturer, dialog, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");

// Windows taskbar identification (helps show correct icon + name)
if (process.platform === "win32") {
  app.setAppUserModelId("com.moakaf.manuscriptbrowser");
}

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
    title: "متصفح المخطوطات",
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      preload: path.join(__dirname, "preload.js"),
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

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
