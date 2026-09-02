import { loadComponentsLua, getDefaultLightStatesByGroup } from "../lua/loader";
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

export interface LibraryVariant {
	/** The component's real COMPONENT.Name. */
	id: string;
	title: string;
	base?: string;
}

export interface LibraryEntry {
	/** For a single-component file this is the file id; for a file that
	 * defines several it is the primary (first) component's COMPONENT.Name. */
	id: string;
	title: string;
	category: string;
	base?: string;
	source: string;
	/** Sibling components defined in the same file, primary excluded. Empty
	 * for a single-component file. */
	variants: LibraryVariant[];
}

const titleRe = /COMPONENT\.Title\s*=\s*(?:\[\[([\s\S]*?)\]\]|"([^"]*)"|'([^']*)')/;
const nameRe = /COMPONENT\.Name\s*=\s*(?:\[\[([\s\S]*?)\]\]|"([^"]*)"|'([^']*)')/;
const categoryRe = /COMPONENT\.Category\s*=\s*"([^"]*)"/;
const baseRe = /COMPONENT\.Base\s*=\s*"([^"]*)"/;

function firstGroup(m: RegExpExecArray | null): string | undefined {
	return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

function quickMeta(id: string, src: string): { title: string; category: string; base?: string } {
	const title = firstGroup(titleRe.exec(src));
	return {
		title: title || id,
		category: categoryRe.exec(src)?.[1] || "Uncategorized",
		base: baseRe.exec(src)?.[1],
	};
}

/** Split a multi-component file at each `Photon2.RegisterComponent(` call and
 * read each block's Name/Title/Category/Base without executing anything. The
 * Nth block (between the (N-1)th and Nth Register call) is component N's
 * definition. */
function parseMultiComponentMeta(fileId: string, src: string): Array<{ id: string; title: string; category: string; base?: string }> {
	const blocks = src.split(/Photon2\.RegisterComponent\s*\(/);
	blocks.pop(); // trailing text after the final Register call
	return blocks.map((block, i) => {
		const name = firstGroup(nameRe.exec(block)) || `${fileId}_${i + 1}`;
		// A few variant blocks omit COMPONENT.Title (it would otherwise be
		// inherited from the base); fall back to the id sans the photon_ prefix.
		const title = firstGroup(titleRe.exec(block)) || name.replace(/^photon_/, "");
		return {
			id: name,
			title,
			category: categoryRe.exec(block)?.[1] || "Uncategorized",
			base: baseRe.exec(block)?.[1],
		};
	});
}

// component id (file id, or a variant's COMPONENT.Name) -> the .lua source it lives in
const sourceByComponentId = new Map<string, string>();

export const library: LibraryEntry[] = Object.entries(componentModules)
	.map(([path, src]) => {
		const fileId = path.split("/").pop()!.replace(/\.lua$/, "");
		const isMulti = /Photon2\.RegisterComponent\s*\(/.test(src);

		if (!isMulti) {
			sourceByComponentId.set(fileId, src);
			return { id: fileId, ...quickMeta(fileId, src), source: src, variants: [] };
		}

		const parsed = parseMultiComponentMeta(fileId, src);
		if (parsed.length < 2) {
			// Not actually multi (or unparseable) -- treat as a single entry.
			sourceByComponentId.set(fileId, src);
			return { id: fileId, ...quickMeta(fileId, src), source: src, variants: [] };
		}

		sourceByComponentId.set(fileId, src);
		for (const c of parsed) sourceByComponentId.set(c.id, src);
		const [primary, ...rest] = parsed;
		return {
			id: primary.id,
			title: primary.title,
			category: primary.category,
			base: primary.base,
			source: src,
			variants: rest.map((v) => ({ id: v.id, title: v.title, base: v.base })),
		};
	})
	.sort((a, b) => a.title.localeCompare(b.title));

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
	const cached = rawCache.get(id);
	if (cached) return cached;

	const src = sourceByComponentId.get(id);
	if (!src) throw new Error(`Unknown built-in component "${id}"`);

	const { components, error } = loadComponentsLua(src);
	if (error) throw new Error(`Failed to load "${id}": ${error}`);

	// Cache every component the file produced, keyed by its real Name, so a
	// same-file sibling referenced via COMPONENT.Base resolves without a
	// second parse.
	for (const raw of components) {
		const name = typeof raw.Name === "string" ? raw.Name : undefined;
		if (name && !rawCache.has(name)) rawCache.set(name, raw);
	}
	if (!rawCache.has(id)) rawCache.set(id, components[0] ?? {});

	const found = rawCache.get(id);
	if (!found) throw new Error(`Component "${id}" not found in its file`);
	return found;
}

export function compileLibraryComponent(id: string): CompiledComponent {
	const cached = compiledCache.get(id);
	if (cached) return cached;
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
