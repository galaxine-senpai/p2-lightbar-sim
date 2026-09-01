// Minimal stand-in for Node's `fs` module, just enough for fengari (and its
// transitive `tmp` dependency) to evaluate at module-load time without
// throwing. Real file I/O is never exercised by this app -- we only load
// component/vehicle Lua source strings, never call Lua's `io.*` file
// functions, and never touch the OS temp-file helpers these stubs back.
export const constants = {
	O_RDONLY: 0,
	O_WRONLY: 1,
	O_RDWR: 2,
	O_CREAT: 64,
	O_EXCL: 128,
	O_TRUNC: 512,
	O_APPEND: 1024,
};

function unsupported() {
	throw new Error("fs is not available in the browser");
}

export const readFileSync = unsupported;
export const writeSync = unsupported;
export const openSync = unsupported;
export const closeSync = unsupported;
export const readSync = unsupported;
export const existsSync = () => false;
export const open = unsupported;
export const close = unsupported;
export const mkdir = unsupported;
export const mkdirSync = unsupported;
export const realpath = unsupported;
export const realpathSync = unsupported;
export const rm = unsupported;
export const rmSync = unsupported;
export const rmdir = unsupported;
export const rmdirSync = unsupported;
export const stat = unsupported;
export const statSync = unsupported;
export const unlink = unsupported;
export const unlinkSync = unsupported;

export default {
	constants,
	readFileSync,
	writeSync,
	openSync,
	closeSync,
	readSync,
	existsSync,
	open,
	close,
	mkdir,
	mkdirSync,
	realpath,
	realpathSync,
	rm,
	rmSync,
	rmdir,
	rmdirSync,
	stat,
	statSync,
	unlink,
	unlinkSync,
};
