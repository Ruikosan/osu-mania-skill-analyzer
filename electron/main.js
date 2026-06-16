const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow } = require("electron");

const cachePath = path.join(app.getPath("userData"), "Cache");
fs.mkdirSync(cachePath, { recursive: true });
app.commandLine.appendSwitch("disk-cache-dir", cachePath);

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 980,
    minHeight: 720,
    title: "osu!mania Skill Analyzer",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "..", "outputs", "index.html"));
}

app.whenReady().then(() => {
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
