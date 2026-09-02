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
	/** True when the primary component compiles to zero drawable
	 * (2D/Mesh/Projected) elements -- the viewer has nothing to show. Filled
	 * by classifyLibrary(); undefined until then. */
	unsupported?: boolean;
	/** Distinct element template groups the primary component uses (e.g.
	 * ["Bone", "Sound"]). Filled by classifyLibrary(). */
	elementTypes?: string[];
}

/** Pseudo-category for the filter UI. */
export const UNSUPPORTED_CATEGORY = "Unsupported";

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

let classified = false;

/** One-time pass: compile every primary component and record whether it has
 * any drawable element and which element groups it uses. Compiling also
 * warms compiledCache, so the first click on any component is instant
 * afterward. Safe to call repeatedly. */
export function classifyLibrary(): void {
	if (classified) return;
	classified = true;
	for (const entry of library) {
		try {
			const compiled = compileLibraryComponent(entry.id);
			const groups = [...new Set(compiled.elements.map((e) => e.templateGroup))].sort();
			entry.elementTypes = groups;
			entry.unsupported = !compiled.elements.some((e) => e.isVisual);
		} catch {
			// A component that won't compile still gets a row; leave it visible.
			entry.elementTypes = [];
			entry.unsupported = false;
		}
	}
}

export interface CategoryTag {
	name: string;
	/** How many components this tag reveals when selected. */
	count: number;
}

/** Filter tags with the count each reveals. Real categories count only
 * supported components -- unsupported ones never appear under them -- so the
 * numbers add up to the "All" count. The Unsupported tag counts the hidden
 * ones. Categories with no supported component are dropped. Assumes
 * classifyLibrary() has run. */
export function getCategoryTags(): CategoryTag[] {
	const counts = new Map<string, number>();
	let unsupported = 0;
	for (const e of library) {
		if (e.unsupported) unsupported++;
		else counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
	}
	const tags = [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
	if (unsupported > 0) tags.push({ name: UNSUPPORTED_CATEGORY, count: unsupported });
	return tags;
}

/** Count for the "All" tag: everything the default view shows (supported
 * components only). */
export function getSupportedCount(): number {
	return library.reduce((n, e) => n + (e.unsupported ? 0 : 1), 0);
}

/** Category names only (kept for callers that don't need counts). */
export function getCategories(): string[] {
	return getCategoryTags().map((t) => t.name);
}
