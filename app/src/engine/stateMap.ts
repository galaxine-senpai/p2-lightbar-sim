// Direct TypeScript port of Photon2.ComponentBuilder.StateMap
// (lua/photon-v2/sh_component_builder.lua, MIT) -- turns a StateMap DSL
// string into per-element arrays of state-slot names.
//
//   "[1] 1 5 9 13 [2] 2 6 10 14 [~SW] 3 4 7 8 15 16 17 [3] 11 [4] 12"
//
// Numeric bracket tokens ([1], [2], ...) reference COMPONENT.States slots;
// non-numeric tokens ([R], [~SW], ...) are literal state names. Multiple
// values in one bracket ("[1/2]") assign multiple slots at once. Plain
// tokens after a bracket are either a numeric element index or an
// ElementGroups name.

export function parseStateMap(
	colorMap: string,
	lightGroups: Record<string, number[]>,
	stateSlots: string[] | undefined,
): Record<number, string[]> {
	let s = colorMap.replace(/[\n\t]/g, " ").trim();
	while (s.includes("  ")) s = s.replace(/  /g, " ");
	if (s === "") return {};

	const blocks = s.split(" ");
	const result: Record<number, string[]> = {};
	let current: string[] = [];
	let validatedStateSlot = false;

	for (let block of blocks) {
		if (block === "") continue;
		if (block.startsWith("[")) {
			block = block.slice(1, block.length - 1).replace(/ /g, "");
			current = block.split("/").map((tok) => {
				const asNumber = Number(tok);
				if (tok !== "" && !Number.isNaN(asNumber)) {
					if (!validatedStateSlot) {
						if (!stateSlots) {
							throw new Error(
								"Failed to setup StateMap because StateSlots is invalid. Ensure you have COMPONENT.States = {} configured.",
							);
						}
						if (!stateSlots[asNumber - 1]) {
							throw new Error(`Failed to setup StateMap because slot [${tok}] is not defined in COMPONENT.States.`);
						}
						validatedStateSlot = true;
					}
					return stateSlots![asNumber - 1];
				}
				return tok;
			});
		} else {
			const asNumber = Number(block);
			if (block !== "" && !Number.isNaN(asNumber)) {
				result[asNumber] = current;
			} else {
				const group = lightGroups[block];
				if (!group) throw new Error(`Invalid light group [${block}]`);
				for (const elementIndex of group) {
					result[elementIndex] = current;
				}
			}
		}
	}

	return result;
}
