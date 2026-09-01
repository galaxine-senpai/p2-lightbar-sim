// Parser for Photon2's Frame string DSL (lua/photon-v2/meta/lighting_segment.lua
// `processFrameString`, confirmed via source research), e.g.:
//
//   "[OFF] 1 2 5 6 [~OFF] 3 4 7 8 15 16 17"
//   "[R] 1 3 5 7 [B] 2 4 6 8"
//   "GroupA:R Odd:R Even:B 1:G"
//   "1 2"                          -- implicit: uses StateMap slot #1 (wiki-documented default)
//
// A `[...]` block sets the "current" state context for subsequent bare
// tokens until the next bracket. A bracket's content is either a number
// (a COMPONENT.States/StateMap slot index, resolved per-element) or a
// literal state name string. A `name:state` token overrides the state for
// just that one token, independent of the running context. A bare token is
// either a numeric element index or an ElementGroups name.
//
// The intensity-transition syntax (`~`, optional `(gain,loss)`, optional
// `*intensity`) can wrap a StateMap slot NUMBER instead of a literal state
// name, e.g. `[~1]` -- "transition-enabled version of this element's
// StateMap slot 1" (real components use this, e.g. Whelen Legacy's DVI
// segment). Since a slot number can resolve to a different literal color
// per element, this can't be resolved once per bracket -- it's resolved
// per-element below, same as a plain numeric context.

import { parseStateToken } from "./color";

export interface FrameParseResult {
	assignments: Record<number, string>;
	elementsTouched: number[];
}

export function parseFrameString(
	frameStr: string,
	elementGroups: Record<string, number[]>,
	elementStateMap: Record<number, string[]>,
): FrameParseResult {
	let s = frameStr.replace(/[\n\t]/g, " ").trim();
	while (s.includes("  ")) s = s.replace(/  /g, " ");

	const assignments: Record<number, string> = {};
	const touched: number[] = [];
	if (s === "") return { assignments, elementsTouched: touched };

	let current: string | number = 1; // implicit default: StateMap slot #1

	const resolveContext = (elementIndex: number, ctx: string | number): string | undefined => {
		if (typeof ctx === "number") {
			const slots = elementStateMap[elementIndex];
			return slots?.[ctx - 1];
		}
		const parsed = parseStateToken(ctx);
		if (/^\d+$/.test(parsed.base)) {
			const slots = elementStateMap[elementIndex];
			const literalBase = slots?.[Number(parsed.base) - 1];
			if (literalBase === undefined) return undefined;
			let out = parsed.transitions ? "~" : "";
			if (parsed.gain !== undefined && parsed.loss !== undefined) out += `(${parsed.gain},${parsed.loss})`;
			out += literalBase;
			if (parsed.intensity !== undefined) out += `*${parsed.intensity}`;
			return out;
		}
		return ctx;
	};

	const assign = (elementIndex: number, ctx: string | number) => {
		const resolved = resolveContext(elementIndex, ctx);
		if (resolved === undefined) return;
		assignments[elementIndex] = resolved;
		touched.push(elementIndex);
	};

	for (const rawBlock of s.split(" ")) {
		if (rawBlock === "") continue;
		if (rawBlock.startsWith("[")) {
			let inner = rawBlock.slice(1, rawBlock.length - 1);
			const asNumber = Number(inner);
			current = inner !== "" && !Number.isNaN(asNumber) ? asNumber : inner;
			continue;
		}

		let key = rawBlock;
		let overrideCtx: string | number | undefined;
		const colonIdx = rawBlock.indexOf(":");
		if (colonIdx !== -1) {
			key = rawBlock.slice(0, colonIdx);
			const val = rawBlock.slice(colonIdx + 1);
			const valNum = Number(val);
			overrideCtx = val !== "" && !Number.isNaN(valNum) ? valNum : val;
		}

		const keyNum = Number(key);
		const ctx = overrideCtx !== undefined ? overrideCtx : current;
		if (key !== "" && !Number.isNaN(keyNum)) {
			assign(keyNum, ctx);
		} else {
			const group = elementGroups[key];
			if (!group) throw new Error(`Invalid light group [${key}] in frame "${frameStr}"`);
			for (const elementIndex of group) assign(elementIndex, ctx);
		}
	}

	return { assignments, elementsTouched: touched };
}
