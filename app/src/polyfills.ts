// Must be the very first thing evaluated (see main.ts). fengari's bundled
// code references the bare `process` global directly (not via `require`),
// and this dev environment provides a partial `window.process = {env:{}}`
// on its own before any app code runs. That's enough for fengari's
// `typeof process !== "undefined"` checks to take its Node-ish code paths,
// but not enough to satisfy what they read (`.versions.node`, etc.), so we
// replace it with a fuller (still fake) shape up front. Real process/OS
// access is never exercised -- this app only ever loads Lua source strings.
const w = window as any;
w.process = {
	env: {},
	browser: true,
	version: "v0.0.0-browser",
	versions: { node: "0.0.0" },
	platform: "linux",
	argv: [],
	cwd: () => "/",
	nextTick: (fn: (...a: unknown[]) => void, ...args: unknown[]) => setTimeout(() => fn(...args), 0),
	stdin: { fd: 0 },
	stdout: { fd: 1, write: () => true },
	stderr: { fd: 2, write: () => true },
	exit: () => {},
	uptime: () => 0,
	addListener: () => w.process,
	on: () => w.process,
	once: () => w.process,
	removeListener: () => w.process,
	off: () => w.process,
	emit: () => false,
	binding: () => ({}),
};
w.global = w;
