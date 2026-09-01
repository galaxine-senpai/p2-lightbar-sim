import type { RawComponent } from "./types";

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Merges a "patch" component (the result of running a user-authored Lua
 * snippet through Photon2.LibraryComponent()) onto a base component. Unlike
 * COMPONENT.Base inheritance (a full deep merge), a patch is additive
 * authoring: each field merges at whatever granularity a P2 developer would
 * expect when hand-editing a real file --
 *
 *  - Segments/Templates(by type)/ElementGroups/InputPriorities/Patterns:
 *    merge by NAME -- a patch segment/template/group either adds a new
 *    named entry or wholesale replaces an existing one with the same name,
 *    other entries are untouched.
 *  - Elements: merge by numeric INDEX -- `COMPONENT.Elements[5] = {...}` in
 *    the patch sets/replaces element 5 specifically, same as mutating the
 *    real array in Lua would.
 *  - Inputs: merges at CHANNEL -> MODE granularity (mirrors Photon2's own
 *    `InheritInputs` special case) so adding one mode never wipes out a
 *    channel's other modes.
 *  - Everything else (Title, Author, States, StateMap, ...): patch value
 *    overwrites if the patch defines it, base value kept otherwise.
 */
export function mergeComponentPatch(base: RawComponent, patch: RawComponent): RawComponent {
	const merged: RawComponent = { ...base };

	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) continue;

		if (key === "Elements") {
			const baseElements = (Array.isArray(base.Elements) ? [...(base.Elements as unknown[])] : []) as unknown[];
			const patchElements = value as unknown;
			if (Array.isArray(patchElements)) {
				patchElements.forEach((el, i) => {
					if (el !== undefined) baseElements[i] = el;
				});
			} else if (isPlainObject(patchElements)) {
				// Sparse table form, e.g. { ["5"] = {...} } from a converter edge case.
				for (const [idxStr, el] of Object.entries(patchElements)) {
					const idx = Number(idxStr);
					if (Number.isFinite(idx) && idx >= 1) baseElements[idx - 1] = el;
				}
			}
			merged.Elements = baseElements as RawComponent["Elements"];
			continue;
		}

		if (key === "Templates" && isPlainObject(value)) {
			const mergedTemplates: Record<string, unknown> = { ...(isPlainObject(base.Templates) ? base.Templates : {}) };
			for (const [group, byName] of Object.entries(value)) {
				if (!isPlainObject(byName)) continue;
				mergedTemplates[group] = { ...(isPlainObject(mergedTemplates[group]) ? (mergedTemplates[group] as object) : {}), ...byName };
			}
			merged.Templates = mergedTemplates as RawComponent["Templates"];
			continue;
		}

		if ((key === "ElementGroups" || key === "InputPriorities" || key === "Patterns" || key === "Segments") && isPlainObject(value)) {
			const existing = (base as Record<string, unknown>)[key];
			const existingObj: Record<string, unknown> = isPlainObject(existing) ? existing : {};
			(merged as Record<string, unknown>)[key] = { ...existingObj, ...value };
			continue;
		}

		if (key === "Inputs" && isPlainObject(value)) {
			const mergedInputs: Record<string, Record<string, unknown>> = {
				...(isPlainObject(base.Inputs) ? (base.Inputs as Record<string, Record<string, unknown>>) : {}),
			};
			for (const [channel, modes] of Object.entries(value)) {
				if (!isPlainObject(modes)) continue;
				mergedInputs[channel] = { ...(isPlainObject(mergedInputs[channel]) ? mergedInputs[channel] : {}) };
				for (const [mode, assignment] of Object.entries(modes)) {
					mergedInputs[channel][mode] = assignment;
				}
			}
			merged.Inputs = mergedInputs;
			continue;
		}

		// Everything else: patch overwrites wholesale (Title, Author, States,
		// StateMap, Model, Credits, Base, FrameDuration, ...).
		(merged as Record<string, unknown>)[key] = value;
	}

	return merged;
}
