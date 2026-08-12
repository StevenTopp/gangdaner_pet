const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("gangdanerPet", {
  getManifest: () => ipcRenderer.invoke("gangdaner-pet:get-manifest"),
  getSettings: () => ipcRenderer.invoke("gangdaner-pet:get-settings"),
  updateSettings: patch => ipcRenderer.invoke("gangdaner-pet:update-settings", patch),
  sendEvent: key => ipcRenderer.invoke("gangdaner-pet:send-event", key),
  replaceAsset: key => ipcRenderer.invoke("gangdaner-pet:replace-asset", key),
  openAssetsFolder: () => ipcRenderer.invoke("gangdaner-pet:open-assets"),
  showMenu: () => ipcRenderer.invoke("gangdaner-pet:menu"),
  startDrag: () => ipcRenderer.send("gangdaner-pet:drag-start"), moveDrag: () => ipcRenderer.send("gangdaner-pet:drag-move"), endDrag: () => ipcRenderer.send("gangdaner-pet:drag-end"),
  onEvent: cb => ipcRenderer.on("gangdaner-pet:event", (_e, key) => cb(key)), onSettings: cb => ipcRenderer.on("gangdaner-pet:settings", (_e, value) => cb(value))
});
