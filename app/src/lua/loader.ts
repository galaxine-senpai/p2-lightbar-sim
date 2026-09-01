import { lua, lauxlib, lualib, to_luastring } from "fengari";
import gmodShimSrc from "./gmod_shim.lua?raw";
import sequenceBuilderSrc from "./sequence_builder.lua?raw";
import defaultLightStatesSrc from "./default_light_states.lua?raw";
import type { RawComponent, RawState } from "../engine/types";

/**
 * GLua (Garry's Mod's Lua dialect) accepts C-style `!`, `!=`, `&&`, `||` as
 * aliases for `not`, `~=`, `and`, `or` -- standard Lua (which fengari
 * implements) does not, so a handful of real component files fail to parse
 * without translation. This walks the source character-by-character,
 * tracking string/long-string/comment context, and rewrites only the
 * operators that appear in genuine code.
 */
function translateGLua(src: string): string {
	let out = "";
	let i = 0;
	const n = src.length;
	while (i < n) {
		const c = src[i];

		// Line comment, possibly a long comment --[[ ... ]] / --[=[ ... ]=]
		if (c === "-" && src[i + 1] === "-") {
			const longOpen = /^--(\[(=*)\[)/.exec(src.slice(i));
			if (longOpen) {
				const eq = longOpen[2];
				const close = `]${eq}]`;
				const end = src.indexOf(close, i + longOpen[0].length);
				const stop = end === -1 ? n : end + close.length;
				out += src.slice(i, stop);
				i = stop;
				continue;
			}
			const nl = src.indexOf("\n", i);
			const stop = nl === -1 ? n : nl;
			out += src.slice(i, stop);
			i = stop;
			continue;
		}

		// Long string [[ ... ]] / [=[ ... ]=]
		if (c === "[") {
			const longOpen = /^(\[(=*)\[)/.exec(src.slice(i));
			if (longOpen) {
				const eq = longOpen[2];
				const close = `]${eq}]`;
				const end = src.indexOf(close, i + longOpen[0].length);
				const stop = end === -1 ? n : end + close.length;
				out += src.slice(i, stop);
				i = stop;
				continue;
			}
		}

		// Quoted strings
		if (c === '"' || c === "'") {
			const quote = c;
			let j = i + 1;
			while (j < n && src[j] !== quote) {
				if (src[j] === "\\") j++;
				j++;
			}
			const stop = Math.min(j + 1, n);
			out += src.slice(i, stop);
			i = stop;
			continue;
		}

		// Real code -- translate GLua operator aliases.
		if (c === "!" && src[i + 1] === "=") {
			out += "~=";
			i += 2;
			continue;
		}
		if (c === "!") {
			out += "not ";
			i += 1;
			continue;
		}
		if (c === "&" && src[i + 1] === "&") {
			out += "and";
			i += 2;
			continue;
		}
		if (c === "|" && src[i + 1] === "|") {
			out += "or";
			i += 2;
			continue;
		}

		out += c;
		i += 1;
	}
	return out;
}

function execChunk(L: any, name: string, src: string) {
	const r = lauxlib.luaL_loadstring(L, to_luastring(src));
	if (r !== lua.LUA_OK) {
		throw new Error(`[${name}] parse error: ${lua.lua_tojsstring(L, -1)}`);
	}
	const pr = lua.lua_pcall(L, 0, 0, 0);
	if (pr !== lua.LUA_OK) {
		throw new Error(`[${name}] runtime error: ${lua.lua_tojsstring(L, -1)}`);
	}
}

function luaToJs(L: any, idx: number, seen: Map<any, unknown> = new Map()): unknown {
	idx = lua.lua_absindex(L, idx);
	const type = lua.lua_type(L, idx);
	if (type === lua.LUA_TNIL) return undefined;
	if (type === lua.LUA_TBOOLEAN) return Boolean(lua.lua_toboolean(L, idx));
	if (type === lua.LUA_TNUMBER) return lua.lua_tonumber(L, idx);
	if (type === lua.LUA_TSTRING) return lua.lua_tojsstring(L, idx);
	if (type === lua.LUA_TFUNCTION) return undefined;
	if (type === lua.LUA_TTABLE) {
		const ptr = lua.lua_topointer(L, idx);
		if (seen.has(ptr)) return seen.get(ptr);

		lua.lua_getfield(L, idx, "__isvector");
		const isVector = lua.lua_toboolean(L, -1);
		lua.lua_pop(L, 1);
		lua.lua_getfield(L, idx, "__isangle");
		const isAngle = lua.lua_toboolean(L, -1);
		lua.lua_pop(L, 1);
		lua.lua_getfield(L, idx, "__iscolor");
		const isColor = lua.lua_toboolean(L, -1);
		lua.lua_pop(L, 1);

		const entries: Array<[unknown, unknown]> = [];
		lua.lua_pushnil(L);
		while (lua.lua_next(L, idx) !== 0) {
			const key = luaToJs(L, -2, seen);
			const value = luaToJs(L, -1, seen);
			entries.push([key, value]);
			lua.lua_pop(L, 1);
		}

		if (isVector) {
			const o = Object.fromEntries(entries as [string, number][]);
			const res = { x: o.x, y: o.y, z: o.z, __kind: "Vector" };
			seen.set(ptr, res);
			return res;
		}
		if (isAngle) {
			const o = Object.fromEntries(entries as [string, number][]);
			const res = { p: o.p, y: o.y, r: o.r, __kind: "Angle" };
			seen.set(ptr, res);
			return res;
		}
		if (isColor) {
			const o = Object.fromEntries(entries as [string, number][]);
			const res = { r: o.r, g: o.g, b: o.b, __kind: "Color" };
			seen.set(ptr, res);
			return res;
		}

		const intEntries = entries.filter(([k]) => typeof k === "number" && Number.isInteger(k)) as [number, unknown][];
		const namedEntries = entries.filter(([k]) => !(typeof k === "number" && Number.isInteger(k)));
		const isSequentialFrom1 =
			intEntries.length > 0 &&
			intEntries
				.map(([k]) => k)
				.sort((a, b) => a - b)
				.every((k, i) => k === i + 1);

		if (isSequentialFrom1) {
			// Dense 1..n integer keys become a JS array; any additional named
			// keys on the SAME Lua table (e.g. a SequenceBuilder chain's
			// IsRepeating/FrameDuration fields) are preserved as extra
			// properties on that array object, mirroring Lua's flexible tables.
			const arr: any = intEntries
				.slice()
				.sort((a, b) => a[0] - b[0])
				.map(([, v]) => v);
			seen.set(ptr, arr);
			for (const [k, v] of namedEntries) if (v !== undefined) arr[String(k)] = v;
			return arr;
		}
		const obj: Record<string, unknown> = {};
		seen.set(ptr, obj);
		for (const [k, v] of entries) if (v !== undefined) obj[String(k)] = v;
		return obj;
	}
	return undefined;
}

// Only the pure-computation standard libraries are needed to run component
// authoring files (they're plain data/logic, no file or OS access). Skipping
// luaL_openlibs' io/os/package/coroutine registration avoids pulling in
// fengari's Node-only fs/os internals, which don't have real polyfills in a
// browser bundle.
const REQUIRED_LIBS: Array<[string, any]> = [
	["_G", lualib.luaopen_base],
	[lualib.LUA_TABLIBNAME, lualib.luaopen_table],
	[lualib.LUA_STRLIBNAME, lualib.luaopen_string],
	[lualib.LUA_MATHLIBNAME, lualib.luaopen_math],
];

/** Creates a fresh Lua VM pre-loaded with the GMod/Photon2 authoring shim. */
function newBaseState(): any {
	const L = lauxlib.luaL_newstate();
	for (const [name, fn] of REQUIRED_LIBS) {
		lauxlib.luaL_requiref(L, to_luastring(name), fn, 1);
		lua.lua_pop(L, 1);
	}
	execChunk(L, "gmod_shim", gmodShimSrc);
	execChunk(L, "sequence_builder", sequenceBuilderSrc);
	execChunk(L, "default_light_states", defaultLightStatesSrc);
	return L;
}

export interface LuaLoadResult {
	component: RawComponent;
	error?: string;
}

/** Executes a Photon2 component/vehicle Lua file's source text and returns
 * the resulting COMPONENT table as a plain JS object. Each call uses a
 * fresh VM so files can't interfere with each other's globals/locals. */
export function loadComponentLua(src: string): LuaLoadResult {
	const L = newBaseState();
	try {
		execChunk(L, "component", translateGLua(src));
	} catch (e) {
		return { component: {}, error: (e as Error).message };
	}
	lua.lua_getglobal(L, "__CAPTURE");
	lua.lua_getfield(L, -1, "Component");
	const result = luaToJs(L, -1) as RawComponent;
	return { component: result ?? {} };
}

/** Runs a P2-developer-authored snippet that assigns onto `COMPONENT`
 * (e.g. `COMPONENT.Segments.MyPattern = {...}`), the same way a real
 * component file's body does, without requiring the file's usual
 * boilerplate (`local COMPONENT = Photon2.LibraryComponent()`,
 * `local sequence = Photon2.SequenceBuilder.New`) -- both are provided
 * automatically so the snippet can start straight at `COMPONENT....`. The
 * returned table is a PATCH meant to be merged onto an existing component
 * (see engine/mergePatch.ts), not a full component in its own right. */
export function runComponentPatchLua(userSrc: string): LuaLoadResult {
	const boilerplate = "local COMPONENT = Photon2.LibraryComponent()\nlocal sequence = Photon2.SequenceBuilder.New\n";
	return loadComponentLua(boilerplate + userSrc);
}

let cachedDefaultStates: Record<string, Record<string, RawState>> | null = null;

/** Extracts each element type's baseline color-state palette (ported
 * verbatim from light_2d.lua/light_mesh.lua/light_projected.lua), keyed by
 * Template group ("2D", "Mesh", "Projected") -- these are the states an
 * element has access to unless its own Template/ElementStates override
 * them. Bone/Sound/etc element types have no color palette (not applicable). */
export function getDefaultLightStatesByGroup(): Record<string, Record<string, RawState>> {
	if (cachedDefaultStates) return cachedDefaultStates;
	const L = newBaseState();
	lua.lua_getglobal(L, "Photon2");
	const read = (field: string) => {
		lua.lua_getfield(L, -1, field);
		const v = (luaToJs(L, -1) as Record<string, RawState>) ?? {};
		lua.lua_pop(L, 1);
		return v;
	};
	cachedDefaultStates = {
		"2D": read("DefaultLightStates2D"),
		Mesh: read("DefaultLightStatesMesh"),
		Projected: read("DefaultLightStatesProjected"),
	};
	return cachedDefaultStates;
}
