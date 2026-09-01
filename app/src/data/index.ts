import { loadComponentLua, getDefaultLightStatesByGroup } from "../lua/loader";
import { compileComponent } from "../engine/compiler";
import type { CompiledComponent, RawComponent } from "../engine/types";

// Bundled, unmodified Photon2 component library files (Lua source, MIT
// licensed -- see PHOTON2_LICENSE.txt). Textures/models are intentionally
// NOT bundled (not MIT-licensed); the simulator renders stylized glow
// shapes instead of real materials.
const componentModules = import.meta.glob("./components/*.lua", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

export interface LibraryEntry {
	id: string;
	title: string;
	category: string;
	base?: string;
	source: string;
}

function quickMeta(id: string, src: string): { title: string; category: string; base?: string } {
	const title = /COMPONENT\.Title\s*=\s*(?:\[\[([\s\S]*?)\]\]|"([^"]*)"|'([^']*)')/.exec(src);
	const category = /COMPONENT\.Category\s*=\s*"([^"]*)"/.exec(src);
	const base = /COMPONENT\.Base\s*=\s*"([^"]*)"/.exec(src);
	const titleVal = title ? title[1] ?? title[2] ?? title[3] : id;
	return { title: titleVal || id, category: category?.[1] || "Uncategorized", base: base?.[1] };
}

export const library: LibraryEntry[] = Object.entries(componentModules)
	.map(([path, src]) => {
		const id = path.split("/").pop()!.replace(/\.lua$/, "");
		const meta = quickMeta(id, src);
		return { id, ...meta, source: src };
	})
	.sort((a, b) => a.title.localeCompare(b.title));

const byId = new Map(library.map((e) => [e.id, e]));
const rawCache = new Map<string, RawComponent>();
const compiledCache = new Map<string, CompiledComponent>();

export function resolveRawComponent(id: string): RawComponent | undefined {
	try {
		return getRaw(id);
	} catch {
		return undefined;
	}
}

function getRaw(id: string): RawComponent {
	if (rawCache.has(id)) return rawCache.get(id)!;
	const entry = byId.get(id);
	if (!entry) throw new Error(`Unknown built-in component "${id}"`);
	const { component, error } = loadComponentLua(entry.source);
	if (error) throw new Error(`Failed to load "${id}": ${error}`);
	rawCache.set(id, component);
	return component;
}

export function compileLibraryComponent(id: string): CompiledComponent {
	if (compiledCache.has(id)) return compiledCache.get(id)!;
	const defaultLightStatesByGroup = getDefaultLightStatesByGroup();
	const raw = getRaw(id);
	const compiled = compileComponent(raw, {
		id,
		defaultLightStatesByGroup,
		resolveBase: (name) => {
			try {
				return getRaw(name);
			} catch {
				return undefined;
			}
		},
	});
	compiledCache.set(id, compiled);
	return compiled;
}

export function getCategories(): string[] {
	return [...new Set(library.map((e) => e.category))].sort();
}
