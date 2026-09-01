import type { RawComponent } from "../engine/types";

type RGBLike = { r: number; g: number; b: number };

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function luaString(s: string): string {
	return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function luaNumber(n: number): string {
	if (Number.isInteger(n)) return String(n);
	// Prefer readable fractions for common frame-duration style values.
	for (const denom of [24, 30, 60, 12, 8, 10, 4, 3, 2, 5, 6, 7, 9, 15, 20, 25, 40, 50]) {
		const num = n * denom;
		if (Math.abs(num - Math.round(num)) < 1e-6 && Math.round(num) === 1) return `1/${denom}`;
	}
	return String(Number(n.toFixed(6)));
}

function isIdentifier(key: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}

function keyLiteral(key: string): string {
	// Lua distinguishes numeric keys (`[1]`) from string keys (`["1"]`) --
	// Photon2's Frames/Elements/States tables are indexed by real numbers,
	// so a numeric-looking key must be emitted as a bare integer literal.
	if (/^-?\d+$/.test(key)) return `[${key}]`;
	return isIdentifier(key) ? key : `[${luaString(key)}]`;
}

/** Serializes a plain JS value into Lua source. Recognizes {__kind:"Vector"|"Angle"} tags. */
function serializeValue(v: unknown, indent: string): string {
	if (v === null || v === undefined) return "nil";
	if (typeof v === "number") return luaNumber(v);
	if (typeof v === "boolean") return String(v);
	if (typeof v === "string") return luaString(v);
	if (Array.isArray(v)) {
		if (v.length === 0) return "{}";
		const items = v.map((item) => serializeValue(item, indent + "\t"));
		if (items.every((s) => !s.includes("\n")) && items.join(", ").length < 90) {
			return `{ ${items.join(", ")} }`;
		}
		return `{\n${items.map((s) => indent + "\t" + s + ",").join("\n")}\n${indent}}`;
	}
	if (typeof v === "object") {
		const obj = v as Record<string, unknown>;
		if (obj.__kind === "Vector") return `Vector( ${luaNumber(obj.x as number)}, ${luaNumber(obj.y as number)}, ${luaNumber(obj.z as number)} )`;
		if (obj.__kind === "Angle") return `Angle( ${luaNumber(obj.p as number)}, ${luaNumber(obj.y as number)}, ${luaNumber(obj.r as number)} )`;

		// A resolved PhotonColor (from Photon2's own color chain, captured by
		// running the real Lua through fengari) -- re-emit as the genuine
		// PhotonColor(...) constructor call rather than a plain data table,
		// since Photon2's runtime expects a live PhotonColor/PhotonBlendColor
		// object (with its metatable/methods), not inert data.
		if (obj.__isphotoncolor) {
			return `PhotonColor( ${luaNumber(obj.r as number)}, ${luaNumber(obj.g as number)}, ${luaNumber(obj.b as number)} )`;
		}
		// A resolved PhotonBlendColor {From, To} pair. Invert/scale are
		// already baked into From/To by the time we captured this data, so
		// `PhotonColor(To):Blend(From):GetBlendColor()` (no further
		// Negative/Scale) reconstructs the identical resolved values through
		// the real API.
		if (obj.__isblendcolor && isPlainObject(obj.From) && isPlainObject(obj.To)) {
			const from = obj.From as RGBLike;
			const to = obj.To as RGBLike;
			return `PhotonColor( ${luaNumber(to.r)}, ${luaNumber(to.g)}, ${luaNumber(to.b)} ):Blend( { r = ${luaNumber(from.r)}, g = ${luaNumber(from.g)}, b = ${luaNumber(from.b)} } ):GetBlendColor()`;
		}

		const keys = Object.keys(obj).filter((k) => obj[k] !== undefined && k !== "__isphotoncolor" && k !== "__isblendcolor" && k !== "__kind");
		if (keys.length === 0) return "{}";
		const lines = keys.map((k) => `${indent}\t${keyLiteral(k)} = ${serializeValue(obj[k], indent + "\t")},`);
		return `{\n${lines.join("\n")}\n${indent}}`;
	}
	return "nil";
}

/** Serializes COMPONENT.Elements, treating each entry's numeric [1]/[2]/[3]
 * shortcut slots (template name / Vector / Angle) as positional. */
function serializeElements(elements: unknown[], indent: string): string {
	if (!elements || elements.length === 0) return "{}";
	const lines: string[] = [];
	elements.forEach((elRaw, i) => {
		if (!elRaw) return;
		const el = elRaw as unknown[] & Record<string, unknown>;
		const parts: string[] = [];
		if (el[0] !== undefined) parts.push(serializeValue(el[0], indent + "\t"));
		if (el[1] !== undefined) parts.push(serializeValue(el[1], indent + "\t"));
		if (el[2] !== undefined) parts.push(serializeValue(el[2], indent + "\t"));
		for (const [k, val] of Object.entries(el)) {
			if (/^\d+$/.test(k)) continue;
			parts.push(`${keyLiteral(k)} = ${serializeValue(val, indent + "\t")}`);
		}
		lines.push(`${indent}\t[${i + 1}] = { ${parts.join(", ")} },`);
	});
	return `{\n${lines.join("\n")}\n${indent}}`;
}

function serializeInputs(inputs: Record<string, Record<string, unknown>>, indent: string): string {
	const channels = Object.keys(inputs);
	if (channels.length === 0) return "{}";
	const lines: string[] = [];
	for (const channel of channels) {
		const modes = inputs[channel];
		const modeLines: string[] = [];
		for (const [mode, assignments] of Object.entries(modes)) {
			modeLines.push(`${indent}\t\t${keyLiteral(mode)} = ${serializeValue(assignments, indent + "\t\t")},`);
		}
		lines.push(`${indent}\t${keyLiteral(channel)} = {\n${modeLines.join("\n")}\n${indent}\t},`);
	}
	return `{\n${lines.join("\n")}\n${indent}}`;
}

export function serializeComponentToLua(raw: RawComponent): string {
	const lines: string[] = [];
	lines.push("if (Photon2.ReloadComponentFile()) then return end");
	lines.push("local COMPONENT = Photon2.LibraryComponent()");
	lines.push("");
	if (raw.Author) lines.push(`COMPONENT.Author = ${luaString(raw.Author)}`);
	if (raw.Base) lines.push(`COMPONENT.Base = ${luaString(raw.Base)}`);
	if (raw.Title) lines.push(`COMPONENT.Title = ${luaString(raw.Title)}`);
	if (raw.Category) lines.push(`COMPONENT.Category = ${luaString(raw.Category)}`);
	if (raw.Model) lines.push(`COMPONENT.Model = ${luaString(raw.Model)}`);
	if (raw.Credits) lines.push(`COMPONENT.Credits = ${serializeValue(raw.Credits, "")}`);
	lines.push("");

	if (raw.Templates && Object.keys(raw.Templates).length) {
		lines.push(`COMPONENT.Templates = ${serializeValue(raw.Templates, "")}`);
		lines.push("");
	}

	if (raw.Elements && (raw.Elements as unknown[]).length) {
		lines.push(`COMPONENT.Elements = ${serializeElements(raw.Elements as unknown[], "")}`);
		lines.push("");
	}

	if (raw.ElementGroups && Object.keys(raw.ElementGroups).length) {
		lines.push(`COMPONENT.ElementGroups = ${serializeValue(raw.ElementGroups, "")}`);
		lines.push("");
	}

	if (raw.States && (raw.States as unknown[]).length) {
		lines.push(`COMPONENT.States = ${serializeValue(raw.States, "")}`);
	}
	if (typeof raw.StateMap === "string" && raw.StateMap.trim()) {
		lines.push(`COMPONENT.StateMap = ${luaString(raw.StateMap)}`);
	}
	if (raw.States || raw.StateMap) lines.push("");

	if (raw.Segments && Object.keys(raw.Segments).length) {
		lines.push(`COMPONENT.Segments = ${serializeValue(raw.Segments, "")}`);
		lines.push("");
	}

	if (raw.Patterns && Object.keys(raw.Patterns).length) {
		lines.push(`COMPONENT.Patterns = ${serializeValue(raw.Patterns, "")}`);
		lines.push("");
	}

	if (raw.Inputs && Object.keys(raw.Inputs).length) {
		lines.push(`COMPONENT.Inputs = ${serializeInputs(raw.Inputs as Record<string, Record<string, unknown>>, "")}`);
		lines.push("");
	}

	if (raw.InputPriorities && Object.keys(raw.InputPriorities).length) {
		lines.push(`COMPONENT.InputPriorities = ${serializeValue(raw.InputPriorities, "")}`);
		lines.push("");
	}

	return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
