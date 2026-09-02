// Runs before the renderer loads, with context isolation on. The web app is
// self-contained and needs nothing from Node or Electron, so this only
// exposes a flag a page could use to tell it is running in the desktop
// shell. Kept as .cjs because package.json is "type": "module".
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
	isElectron: true,
	platform: process.platform,
});
