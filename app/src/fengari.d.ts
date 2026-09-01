declare module "fengari" {
	const lua: any;
	const lauxlib: any;
	const lualib: any;
	function to_luastring(s: string): unknown;
	function to_jsstring(s: unknown): string;
	export { lua, lauxlib, lualib, to_luastring, to_jsstring };
}

declare module "*.lua?raw" {
	const content: string;
	export default content;
}
