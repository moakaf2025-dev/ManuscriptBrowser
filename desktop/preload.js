const { contextBridge, webUtils } = require("electron");

// Modern Electron (>= 32) removed File.path. Use webUtils.getPathForFile as the official way.
contextBridge.exposeInMainWorld("msElectron", {
  getFilePath: (file) => {
    try {
      return webUtils && webUtils.getPathForFile ? webUtils.getPathForFile(file) : "";
    } catch { return ""; }
  },
});
