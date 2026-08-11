const { contextBridge, webUtils, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("msElectron", {
  // Modern Electron (>= 32) removed File.path. Use webUtils.getPathForFile.
  getFilePath: (file) => {
    try {
      return webUtils && webUtils.getPathForFile ? webUtils.getPathForFile(file) : "";
    } catch { return ""; }
  },

  // Opening a manuscript the program was given as a path rather than as a File.
  // statFile is what the pane needs before deciding anything - name, size, mtime.
  // A PDF is then read by byte range (openRangeFile / readRange, with `end`
  // exclusive as pdf.js counts it); an image or archive has to come over whole.
  //
  // These deliberately do not swallow their errors: the caller falls back to
  // reading the file whole when opening by range fails, and it can only do that
  // if it is told.
  statFile: (filePath) => ipcRenderer.invoke("ms:stat-file", filePath),
  readFile: (filePath) => ipcRenderer.invoke("ms:read-file", filePath),
  openRangeFile: (filePath) => ipcRenderer.invoke("ms:open-range-file", filePath),
  readRange: (id, begin, end) => ipcRenderer.invoke("ms:read-range", { id, begin, end }),
  closeRangeFile: (id) => ipcRenderer.invoke("ms:close-range-file", id),

  // A manuscript handed to the program on the command line, as "Open with" does.
  // Taking it clears it, so of the two panes only the one that asks first gets a
  // given path and the file is not opened twice.
  takePendingOpenPath: () => ipcRenderer.invoke("ms:take-pending-open-path"),

  // Fired when a later launch hands this instance a file. The path is not in the
  // event: call takePendingOpenPath to claim it. Returns an unsubscribe function.
  onOpenPathAvailable: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("ms:open-path-available", handler);
    return () => ipcRenderer.removeListener("ms:open-path-available", handler);
  },

  // Copy an image (as data-URL) to the OS clipboard via the main process.
  // Required because `navigator.clipboard.write` is disabled on file:// origins,
  // and the `clipboard` module is only available in the main process.
  copyImageToClipboard: async (dataUrl) => {
    try {
      return await ipcRenderer.invoke("clipboard:image", dataUrl);
    } catch {
      return false;
    }
  },

  // Copy plain text to the OS clipboard (via main).
  copyTextToClipboard: async (text) => {
    try {
      return await ipcRenderer.invoke("clipboard:text", String(text ?? ""));
    } catch {
      return false;
    }
  },

  // Copy text and its HTML rendering together, so pasting into Word keeps the
  // table. `navigator.clipboard.write` is the web equivalent and file:// blocks it.
  copyTableToClipboard: async (text, html) => {
    try {
      return await ipcRenderer.invoke("clipboard:html", { text: String(text ?? ""), html: String(html ?? "") });
    } catch {
      return false;
    }
  },
});
