const { contextBridge, webUtils, clipboard, nativeImage } = require("electron");

contextBridge.exposeInMainWorld("msElectron", {
  // Modern Electron (>= 32) removed File.path. Use webUtils.getPathForFile.
  getFilePath: (file) => {
    try {
      return webUtils && webUtils.getPathForFile ? webUtils.getPathForFile(file) : "";
    } catch { return ""; }
  },

  // Copy an image (as data-URL) to the OS clipboard via Electron's native APIs.
  // Required because `navigator.clipboard.write` is disabled on file:// origins
  // that Electron uses for packaged apps.
  copyImageToClipboard: (dataUrl) => {
    try {
      const img = nativeImage.createFromDataURL(dataUrl);
      if (!img || img.isEmpty()) return false;
      clipboard.writeImage(img);
      return true;
    } catch (e) {
      return false;
    }
  },

  // Copy plain text to the OS clipboard.
  copyTextToClipboard: (text) => {
    try {
      clipboard.writeText(String(text ?? ""));
      return true;
    } catch (e) {
      return false;
    }
  },
});
