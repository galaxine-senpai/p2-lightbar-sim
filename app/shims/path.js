// Minimal POSIX-style `path` stand-in (only what fengari's transitive deps
// reference; never actually exercised by this app).
export function join(...parts) {
	return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}
export function dirname(p) {
	const i = p.lastIndexOf("/");
	return i === -1 ? "." : p.slice(0, i) || "/";
}
export function basename(p, ext) {
	const b = p.slice(p.lastIndexOf("/") + 1);
	return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b;
}
export function isAbsolute(p) {
	return p.startsWith("/");
}
export function relative(from, to) {
	return to;
}
export function resolve(...parts) {
	return join(...parts);
}
export const sep = "/";

export default { join, dirname, basename, isAbsolute, relative, resolve, sep };
