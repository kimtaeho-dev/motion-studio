import { contextBridge, ipcRenderer } from "electron";

/** The setup window's only channel to the main process. */
contextBridge.exposeInMainWorld("setup", {
  status: () => ipcRenderer.invoke("setup:status"),
  install: () => ipcRenderer.invoke("setup:install"),
  startLogin: () => ipcRenderer.invoke("setup:login-start"),
  submitCode: (code: string) => ipcRenderer.invoke("setup:login-code", code),
  openUrl: (url: string) => ipcRenderer.invoke("setup:open-url", url),
  finish: () => ipcRenderer.invoke("setup:finish"),
  onProgress: (handler: (line: string) => void) =>
    ipcRenderer.on("setup:progress", (_event, line: string) => handler(line)),
});
