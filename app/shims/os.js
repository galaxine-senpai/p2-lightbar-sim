// Minimal stand-in for Node's `os` module -- fengari's luaconf.js only
// needs `.platform()` to be callable at module-load time.
export function platform() {
	return "linux";
}
export function tmpdir() {
	return "/tmp";
}
export const EOL = "\n";

// Standard POSIX errno values; only needed so libraries that read
// `os.constants.errno.*` at module-load time (e.g. the `tmp` package, a
// transitive dep pulled in by fengari's os library) don't crash. Never
// actually exercised since this app never performs real file/OS calls.
export const constants = {
	errno: { EBADF: 9, ENOENT: 2, EEXIST: 17, EPERM: 1, EINVAL: 22 },
};

export default { platform, tmpdir, EOL, constants };
