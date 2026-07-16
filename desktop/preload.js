const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("msElectron", {
  getSources: () => ipcRenderer.invoke("ms:get-sources"),
  chooseSaveFolder: () => ipcRenderer.invoke("ms:choose-save-folder"),
  saveFile: (payload) => ipcRenderer.invoke("ms:save-file", payload),
});
