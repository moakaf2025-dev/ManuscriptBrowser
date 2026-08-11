const { app, BrowserWindow, Menu, shell, ipcMain, desktopCapturer, dialog, nativeImage, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");

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

  // Every close is intercepted once, to run the backup check; the actual
  // teardown at the end of handleCloseRequest is win.destroy(), which does not
  // re-emit "close" - so this never needs to tell its own request apart from a
  // real one, and nothing here can double-fire.
  win.on("close", (event) => {
    event.preventDefault();
    handleCloseRequest(win);
  });
}

// ---- Reminding the reader to back up before losing a session's work ----
//
// Comments, headings, catalogue cards and page orders live only in this
// machine's localStorage until the reader exports a backup by hand - there is no
// autosave to another location. So before the window actually closes, every
// pane is asked whether it holds anything not covered by its last backup
// (window.__msBackupDirty, a plain global the pane exposes for exactly this -
// see ManuscriptRuler.jsx). If any pane says yes, closing pauses for a native
// prompt instead of the window just disappearing over unsaved annotations.
//
// frame.executeJavaScript, not an IPC round trip: main already has a direct line
// into each frame's main world regardless of contextIsolation, and the check is
// narrow enough that adding a channel for it would only be more to keep in sync.
//
// Bounded by a timeout, and this is not defensive padding: executeJavaScript
// waits on the renderer's main thread, and that thread is exactly what a heavy
// page render or an in-progress export keeps busy. Before this reminder existed,
// clicking close never depended on the renderer being free - Electron just tore
// the window down. Making every close await a script that can stay queued
// behind real work turns "the renderer is doing something" into "the window
// will not close", which is worse than no reminder at all. Timing out and
// treating that pane as clean (not dirty) preserves the old guarantee: close
// always closes, the reminder is a best-effort addition on top of it.
//
// The timeout alone is not enough, though: win.close() itself waits on the
// renderer too, for its own unload lifecycle, regardless of anything decided
// here. Measured directly - a pane wedged in an unbounded `while(true){}` at
// the moment of close never finished closing through win.close(), timeout or
// not. win.destroy() is what actually finishes the job: Electron documents it
// as skipping unload/beforeunload and the "close" event entirely, which is
// exactly the point once this function has already decided closing is safe -
// there is nothing left for the page's own lifecycle to do.
const PANE_CHECK_TIMEOUT_MS = 1500;
const PANE_BACKUP_TIMEOUT_MS = 4000; // the pane's own ack already waits ~400ms

function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(fallback); }
    );
  });
}

async function paneIsDirty(frame) {
  const result = await withTimeout(
    frame.executeJavaScript("(window.__msBackupDirty ? window.__msBackupDirty() : false)").catch(() => false),
    PANE_CHECK_TIMEOUT_MS,
    false // a frame mid-navigation, gone, or too busy to answer should not block a close
  );
  return !!result;
}

// Split (double-page) view never survives closing the file - splitPages starts
// false every time a manuscript (re)opens, by design, so switching files never
// carries one manuscript's split range into another. The fold-line fitting
// itself is not lost (foldOverridesMap is keyed by file and is part of the
// backup), only the toggle being on - but that reads as "my split is gone" to
// whoever spent time getting it right, so it gets its own notice rather than
// being folded silently into the backup one.
async function paneSplitActive(frame) {
  const result = await withTimeout(
    frame.executeJavaScript("(window.__msSplitActive ? window.__msSplitActive() : false)").catch(() => false),
    PANE_CHECK_TIMEOUT_MS,
    false
  );
  return !!result;
}

async function runPaneBackup(frame) {
  await withTimeout(
    frame.executeJavaScript("(window.__msRunBackupThenAck ? window.__msRunBackupThenAck() : Promise.resolve(false))").catch(() => false),
    PANE_BACKUP_TIMEOUT_MS,
    false // the pane's own toast already reports a failure inside it; the close must still proceed
  );
}

async function handleCloseRequest(win) {
  if (win.isDestroyed()) return;
  // In parallel, not one frame at a time (and both kinds of check together, not
  // back to back): same-origin panes share a renderer process, so a wedged
  // pane's main thread blocks executeJavaScript aimed at every frame in the
  // window, main frame included. Starting every timeout together caps the wait
  // at the slowest one, not their sum - sequential checks measured at ~3s for
  // two frames against ~1.5s running together.
  const frames = win.webContents.mainFrame.framesInSubtree;
  const [dirtyResults, splitResults] = await Promise.all([
    Promise.all(frames.map((frame) => paneIsDirty(frame))),
    Promise.all(frames.map((frame) => paneSplitActive(frame))),
  ]);
  const dirtyFrames = frames.filter((_frame, i) => dirtyResults[i]);
  const anySplitActive = splitResults.some(Boolean);

  if (dirtyFrames.length === 0 && !anySplitActive) {
    win.destroy();
    return;
  }

  // Two different shapes of dialog, not one merged into the other. Backing up
  // is one click main.js can trigger unattended; exporting a split view needs
  // its own dialog for quality and size, so there is no equivalent "just do it"
  // button to offer here - the honest options are "go back and export it
  // yourself" or "close anyway", and offering a fake save action would just
  // teach the reader to trust a button that does not do what it says.
  let opts;
  if (dirtyFrames.length > 0) {
    opts = {
      buttons: ["حفظ نسخة ثم إغلاق", "إغلاق دون حفظ", "إلغاء"],
      defaultId: 0,
      cancelId: 2,
      message: "لديك تعديلات لم تُحفظ في نسخة احتياطية منذ آخر مرة.",
      detail: "الحواشي والعناوين وبطاقات الكتب وترتيب الصفحات محفوظة على هذا الجهاز فقط. يُنصح بحفظ نسخة احتياطية قبل الإغلاق حتى لا تفقدها."
        + (anySplitActive
          ? "\n\nوأحد المخطوطات المفتوحة معروض مُقسَّمًا (مقصوصًا) الآن - هذا العرض لا يُحفظ عند الإغلاق ولا في النسخة الاحتياطية. صدّره كملف إن أردت الاحتفاظ به نهائيًا."
          : ""),
    };
  } else {
    opts = {
      buttons: ["إغلاق على أي حال", "إلغاء"],
      defaultId: 1, // cautious default: closing over unexported split work is the one that should need a deliberate click
      cancelId: 1,
      message: "أحد المخطوطات المفتوحة معروض مُقسَّمًا (مقصوصًا) الآن.",
      detail: "هذا العرض لا يُحفظ عند إغلاق الملف أو البرنامج، ويبدأ كل ملف مغلقًا عند فتحه من جديد. إن أردت الاحتفاظ بالمخطوط مُقسَّمًا بشكل نهائي، أَلغِ الإغلاق الآن وصدّره أولاً.",
    };
  }

  const choice = dialog.showMessageBoxSync(win, { type: "question", noLink: true, title: "نسخة احتياطية", ...opts });

  if (choice === opts.cancelId || win.isDestroyed()) return; // leave the window open

  if (dirtyFrames.length > 0 && choice === 0) {
    // In parallel for the same reason as the checks above - one dirty pane
    // stuck under a timeout should not delay the other pane's backup behind it.
    await Promise.all(dirtyFrames.map((frame) => runPaneBackup(frame)));
  }

  if (win.isDestroyed()) return;
  win.destroy();
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

// ---- Reading a manuscript straight off disk, by path ----
//
// A file opened from the command line arrives as a path, and there is no File
// object to hand the renderer. Two ways down from here.
//
// For a PDF, by byte range. pdf.js only asks for the parts it needs, but it can
// only do that when something hands it those bytes: it decides whether ranges are
// allowed with `/^https?:/i.test(url)`, so a blob: URL - or any custom scheme -
// makes it give up on ranges and read the whole document into the page. So the
// renderer drives a pdf.js PDFDataRangeTransport and each range it asks for lands
// here as a positional read on an open descriptor. The file is never copied.
//
// The descriptor stays open for the life of the tab. Re-opening per chunk would
// be a fresh path lookup on every read, and a manuscript is read thousands of
// times while it is browsed.
//
// For an image or an archive there is nothing to read piecewise - the renderer
// needs the bytes to decode or unpack - so those come over whole, which is what
// the file picker was already doing for them anyway.
const openManuscripts = new Map(); // id -> { fh, size, filePath }
let nextManuscriptId = 1;

async function closeManuscript(id) {
  const entry = openManuscripts.get(id);
  if (!entry) return false;
  openManuscripts.delete(id);
  try { await entry.fh.close(); } catch { /* already gone */ }
  return true;
}

// What the pane needs before it can decide anything: the name to show, the size
// to check against the warning threshold, and an mtime, so a manuscript opened by
// path keys to the same stored notes as the same file opened through the picker.
ipcMain.handle("ms:stat-file", async (_event, filePath) => {
  if (typeof filePath !== "string" || !filePath.trim()) throw new Error("مسار الملف مفقود");
  const resolved = path.resolve(filePath);
  const st = await fsp.stat(resolved);
  if (!st.isFile()) throw new Error("المسار لا يشير إلى ملف");
  return { path: resolved, name: path.basename(resolved), size: st.size, lastModified: Math.floor(st.mtimeMs) };
});

ipcMain.handle("ms:read-file", async (_event, filePath) => {
  if (typeof filePath !== "string" || !filePath.trim()) throw new Error("مسار الملف مفقود");
  return fsp.readFile(path.resolve(filePath));
});

ipcMain.handle("ms:open-range-file", async (_event, filePath) => {
  if (typeof filePath !== "string" || !filePath.trim()) throw new Error("مسار الملف مفقود");
  const resolved = path.resolve(filePath);
  const st = await fsp.stat(resolved);
  if (!st.isFile()) throw new Error("المسار لا يشير إلى ملف");
  const fh = await fsp.open(resolved, "r");
  const id = nextManuscriptId++;
  openManuscripts.set(id, { fh, size: st.size, filePath: resolved });
  return { id, size: st.size };
});

ipcMain.handle("ms:read-range", async (_event, payload) => {
  const { id, begin, end } = payload || {};
  const entry = openManuscripts.get(id);
  if (!entry) throw new Error("الملف غير مفتوح");
  // pdf.js treats `end` as exclusive. Clamp both ends: it asks past EOF for the
  // last chunk of the file as a matter of course.
  const from = Math.max(0, Math.min(entry.size, Math.floor(Number(begin) || 0)));
  const to = Math.max(from, Math.min(entry.size, Math.floor(Number(end) || 0)));
  const length = to - from;
  const buf = Buffer.allocUnsafe(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await entry.fh.read(buf, filled, length - filled, from + filled);
    if (bytesRead <= 0) break; // short read: hand back what the disk actually gave
    filled += bytesRead;
  }
  return filled === length ? buf : buf.subarray(0, filled);
});

ipcMain.handle("ms:close-range-file", async (_event, id) => closeManuscript(id));

// A renderer that reloads or crashes never sends its close, so the descriptors
// would sit open until the app quit.
app.on("before-quit", async () => {
  await Promise.all([...openManuscripts.keys()].map(closeManuscript));
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
