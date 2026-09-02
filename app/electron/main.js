// Minimal Electron shell. In development it loads the running Vite dev
// server; in a packaged/production run it loads the static bundle from
// ../dist. The renderer is the same web app either way -- this process adds
// nothing but a window.
import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dev unless packaged, or unless `--prod` is passed (used by `npm start` to
// load the built bundle without packaging).
const isDev = !app.isPackaged && !process.argv.includes("--prod");
const DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";

/** Vite may not be listening yet when Electron starts (they boot in
 * parallel). Retry the dev-server load until it answers or we give up. */
async function loadWithRetry(win, url, attempts = 60) {
	for (let i = 0; i < attempts; i++) {
		try {
			await win.loadURL(url);
			return;
		} catch (err) {
			if (win.isDestroyed()) return;
			await new Promise((r) => setTimeout(r, 300));
		}
	}
	if (!win.isDestroyed()) {
		win.loadURL(
			"data:text/html,<body style='font:14px system-ui;padding:2rem'>Could not reach the Vite dev server at " +
				DEV_URL +
				". Start it with <code>npm run dev:web</code> or run <code>npm run dev</code>.</body>",
		);
	}
}

function createWindow() {
	const win = new BrowserWindow({
		width: 1440,
		height: 900,
		backgroundColor: "#141517",
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	// Open real links (docs, GitHub) in the system browser, not in-app.
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith("http:") || url.startsWith("https:")) {
			shell.openExternal(url);
			return { action: "deny" };
		}
		return { action: "allow" };
	});

	if (isDev) {
		loadWithRetry(win, DEV_URL);
	} else {
		win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
	}
}

app.whenReady().then(() => {
	createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
