const { contextBridge, webUtils, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("msElectron", {
  // Modern Electron (>= 32) removed File.path. Use webUtils.getPathForFile.
  getFilePath: (file) => {
    try {
      return webUtils && webUtils.getPathForFile ? webUtils.getPathForFile(file) : "";
    } catch { return ""; }
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
});
