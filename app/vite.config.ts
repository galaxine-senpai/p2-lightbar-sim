import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// fengari (the in-browser Lua VM used to run real Photon2 component files)
// is a Node-oriented CJS package. Vite/esbuild's dep pre-bundler ends up
// providing SOME `process` global for it no matter what (this appears to be
// baked into esbuild's browser platform target), which flips fengari's own
// internal `typeof process !== "undefined"` feature checks into its
// Node-specific code paths (file I/O, os.platform(), etc). Rather than
// fight that, these aliases supply small but complete-enough stand-ins for
// the few things those paths touch at module-load time -- real file/OS
// access is never exercised since this app only ever loads Lua source
// strings and never calls Lua's `io.*`/`os.*` functions.
export default defineConfig({
	// Relative asset URLs so the built bundle loads from a file:// path (the
	// Electron production shell uses loadFile on dist/index.html) as well as
	// from any web host.
	base: "./",
	resolve: {
		alias: {
			fs: path.resolve(__dirname, "shims/fs.js"),
			os: path.resolve(__dirname, "shims/os.js"),
			path: path.resolve(__dirname, "shims/path.js"),
		},
	},
	define: {
		"process.env.FENGARICONF": "undefined",
	},
});
