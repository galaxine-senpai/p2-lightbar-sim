import type {
	CompiledComponent,
	CompiledElement,
	CompiledFrame,
	CompiledSegment,
	CompiledSequence,
	InputAssignment,
	RawComponent,
	RawElement,
	RawPatternEntry,
	RawSegment,
	RawState,
	RawTemplate,
	Vec3,
	Ang3,
} from "./types";
import { DEFAULT_INPUT_PRIORITIES } from "./types";
import { parseStateMap } from "./stateMap";
import { parseFrameString } from "./frames";
import { resolveState, resolveBoneState } from "./color";
import { deepClone } from "./clone";

const DEFAULT_FRAME_DURATION = 1 / 24;
const ZERO_VEC: Vec3 = { x: 0, y: 0, z: 0 };
const ZERO_ANG: Ang3 = { p: 0, y: 0, r: 0 };

export interface CompileOptions {
	/** Resolves COMPONENT.Base parent references from the component library. */
	resolveBase?: (name: string) => RawComponent | undefined;
	/** Each Template group's baseline color-state palette (ported from
	 * light_2d.lua/light_mesh.lua/light_projected.lua), keyed by group
	 * ("2D", "Mesh", "Projected"). */
	defaultLightStatesByGroup?: Record<string, Record<string, RawState>>;
	id?: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}


/** table.Merge semantics: recursive for nested plain objects, everything else overwritten. */
function deepMerge(dest: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
	for (const [k, v] of Object.entries(source)) {
		if (isPlainObject(v) && isPlainObject(dest[k])) {
			deepMerge(dest[k] as Record<string, unknown>, v);
		} else {
			dest[k] = v;
		}
	}
	return dest;
}

/** COMPONENT.Base inheritance: deep merge parent -> child, except Inputs
 * channel/mode pairs the child declares fully replace the parent's
 * (Photon2.ComponentBuilder.InheritInputs special case). StateMap strings
 * concatenate. */
function resolveInheritance(
	raw: RawComponent,
	resolveBase?: (name: string) => RawComponent | undefined,
	seen: Set<string> = new Set(),
): RawComponent {
	if (!raw.Base || !resolveBase) return raw;
	if (seen.has(raw.Base)) return raw; // cycle guard (some multi-component files self-reference)
	seen.add(raw.Base);
	const parentRaw = resolveBase(raw.Base);
	if (!parentRaw) return raw;
	const parent = resolveInheritance(deepClone(parentRaw), resolveBase, seen);

	const childInputs = raw.Inputs;
	const merged = deepMerge(deepClone(parent) as Record<string, unknown>, deepClone(raw) as Record<string, unknown>) as RawComponent;

	if (childInputs) {
		merged.Inputs = merged.Inputs || {};
		for (const [channel, modes] of Object.entries(childInputs)) {
			if (!isPlainObject(modes)) continue;
			(merged.Inputs as Record<string, unknown>)[channel] = (merged.Inputs as Record<string, unknown>)[channel] || {};
			for (const [mode, val] of Object.entries(modes)) {
				((merged.Inputs as Record<string, Record<string, unknown>>)[channel])[mode] = val;
			}
		}
	}

	if (parent.StateMap && raw.StateMap) {
		merged.StateMap = `${parent.StateMap} ${raw.StateMap}`;
	}

	return merged;
}

function copySequences(inputs: Record<string, Record<string, unknown>> | undefined, channel: string, mode: string): unknown {
	const val = inputs?.[channel]?.[mode];
	return val === undefined ? {} : deepClone(val);
}

/** Applies COMPONENT.Features shorthand flags (ParkMode, NightParkMode,
 * AutomaticHeadlights, FrontNoM1) per lua/photon-v2/sh_component_builder.lua. */
function applyFeatures(raw: RawComponent): RawComponent {
	const features = raw.Features as Record<string, unknown> | undefined;
	if (!features) return raw;
	const c = deepClone(raw);
	c.Inputs = c.Inputs || {};
	c.InputPriorities = c.InputPriorities || {};
	c.VirtualOutputs = c.VirtualOutputs || {};

	const inputs = c.Inputs as Record<string, Record<string, unknown>>;
	const priorities = c.InputPriorities as Record<string, number>;
	const virtualOutputs = c.VirtualOutputs as Record<string, unknown[]>;

	if (features.AutomaticHeadlights) {
		virtualOutputs["Vehicle.AutomaticLighting"] = [
			{ Mode: "HEADLIGHTS", Conditions: { "Vehicle.Ambient": ["DARK"], "Vehicle.Lights": ["AUTO"] } },
			{
				Mode: "PARKING",
				Conditions: {
					"Vehicle.Ambient": ["DARK"],
					"Vehicle.Lights": ["AUTO"],
					"Vehicle.Engine": ["ON"],
					"Vehicle.Transmission": ["PARK"],
				},
			},
			{ Mode: "DRL", Conditions: { "Vehicle.Transmission": ["DRIVE", "REVERSE"], "Vehicle.Lights": ["AUTO"] } },
		];
		priorities["Vehicle.AutomaticLighting"] = 21;
		inputs["Vehicle.AutomaticLighting"] = {
			HEADLIGHTS: copySequences(inputs, "Vehicle.Lights", "HEADLIGHTS"),
			PARKING: copySequences(inputs, "Vehicle.Lights", "PARKING"),
			DRL: copySequences(inputs, "Vehicle.Lights", "DRL"),
		};
	}

	if (features.ParkMode) {
		const params = Array.isArray(features.ParkMode) ? (features.ParkMode as string[]) : ["Emergency.Warning", "MODE2"];
		let sequences = copySequences(inputs, params[0], params[1]);
		if (inputs["Emergency.ParkedWarning"]?.["MODE3"]) sequences = deepClone(inputs["Emergency.ParkedWarning"]["MODE3"]);
		virtualOutputs["Emergency.ParkedWarning"] = [
			{ Mode: "MODE3", Conditions: { "Vehicle.Transmission": ["PARK"], "Emergency.Warning": ["MODE3"] } },
		];
		priorities["Emergency.ParkedWarning"] = 45;
		inputs["Emergency.ParkedWarning"] = { MODE3: sequences };
	}

	if (features.NightParkMode) {
		const params = Array.isArray(features.NightParkMode)
			? (features.NightParkMode as string[])
			: ["Emergency.Warning", "MODE3"];
		let sequences = copySequences(inputs, params[0], params[1]);
		if (inputs["Emergency.NightParkedWarning"]?.["MODE3"]) sequences = deepClone(inputs["Emergency.NightParkedWarning"]["MODE3"]);
		virtualOutputs["Emergency.NightParkedWarning"] = [
			{
				Mode: "MODE3",
				Conditions: { "Vehicle.Transmission": ["PARK"], "Emergency.Warning": ["MODE3"], "Vehicle.Ambient": ["DARK"] },
			},
		];
		priorities["Emergency.NightParkedWarning"] = 46;
		inputs["Emergency.NightParkedWarning"] = { MODE3: sequences };
	}

	if (features.FrontNoM1) {
		inputs["Emergency.Warning"] = inputs["Emergency.Warning"] || {};
		inputs["Emergency.Warning"]["MODE1"] = {};
		c.Segments = c.Segments || {};
		const segments = c.Segments as Record<string, RawSegment>;
		if (!segments.FrontCut) {
			const zeroFrame: unknown[] = [];
			const elementCount = Array.isArray(c.Elements) ? c.Elements.length : 0;
			for (let i = 1; i <= elementCount; i++) zeroFrame.push([i, "OFF"]);
			segments.FrontCut = { Frames: { "0": zeroFrame }, Sequences: { CUT: [0] } };
		}
		inputs["Emergency.Cut"] = inputs["Emergency.Cut"] || {};
		inputs["Emergency.Cut"]["FRONT"] = inputs["Emergency.Cut"]["FRONT"] || {};
		(inputs["Emergency.Cut"]["FRONT"] as Record<string, string>)["FrontCut"] = "CUT";
	}

	return c;
}

function normalizeElement(el: RawElement): {
	templateName: string;
	position: Vec3;
	angle: Ang3;
	overrides: Record<string, unknown>;
} {
	const arr = el as unknown[];
	const templateName = String(arr[0]);
	let position = ZERO_VEC;
	let angle = ZERO_ANG;
	const overrides: Record<string, unknown> = {};

	const v = arr[1] as any;
	const a = arr[2] as any;
	if (v && v.__kind === "Vector") position = { x: v.x, y: v.y, z: v.z };
	if (a && a.__kind === "Angle") angle = { p: a.p, y: a.y, r: a.r };

	for (const [k, val] of Object.entries(el as Record<string, unknown>)) {
		if (/^\d+$/.test(k)) continue; // positional slots already handled
		overrides[k] = val;
	}
	return { templateName, position, angle, overrides };
}

function findTemplate(raw: RawComponent, templateName: string): { group: string; template: RawTemplate } | undefined {
	const templates = raw.Templates || {};
	for (const [group, byName] of Object.entries(templates)) {
		if (byName && templateName in byName) return { group, template: byName[templateName] };
	}
	return undefined;
}

function buildStatePool(
	raw: RawComponent,
	group: string,
	template: RawTemplate,
	defaultLightStatesByGroup: Record<string, Record<string, RawState>>,
): Record<string, RawState> {
	const pool: Record<string, RawState> = {};
	if (defaultLightStatesByGroup[group]) Object.assign(pool, defaultLightStatesByGroup[group]);
	const elementStates = raw.ElementStates?.[group];
	if (elementStates) Object.assign(pool, elementStates);
	if (template.States) Object.assign(pool, template.States);

	// Resolve `Inherit = "Name"` one level (sufficient for authored components observed).
	for (const [name, state] of Object.entries(pool)) {
		if (state?.Inherit && pool[state.Inherit]) {
			pool[name] = { ...pool[state.Inherit], ...state };
		}
	}
	return pool;
}

/** Port of Photon2.Util.ParseSequenceName (sh_util.lua:304): a sequence
 * reference in Inputs/Patterns may carry `:`-suffixed parts. Numeric parts
 * sum into a phase offset in degrees (taken mod 360); a non-numeric part is
 * a "named phase" and stays appended to the sequence name so it resolves to
 * a distinctly-named sequence. */
function parseSequenceRef(ref: string): { sequence: string; phaseDegrees: number } {
	const parts = ref.split(":");
	let sequence = parts[0];
	let degrees = 0;
	let named: string | undefined;
	for (let i = 1; i < parts.length; i++) {
		const n = Number(parts[i]);
		if (parts[i] !== "" && Number.isFinite(n)) degrees += n;
		else if (parts[i] !== "") named = parts[i];
	}
	if (named !== undefined) sequence = `${sequence}:${named}`;
	return { sequence, phaseDegrees: ((degrees % 360) + 360) % 360 };
}

function normalizeFramesTable(raw: unknown): Array<[number, unknown]> {
	if (Array.isArray(raw)) return raw.map((v, i) => [i + 1, v] as [number, unknown]);
	if (isPlainObject(raw)) return Object.entries(raw).map(([k, v]) => [Number(k), v] as [number, unknown]);
	return [];
}

/** Direct port of the VariableFrameDuration handling in Sequence.New
 * (meta/sequence.lua:97-115): fill any missing/non-finite field with
 * upstream's default (Slow 0.1, Fast 1, Rate 0.5), then swap so slow <= fast.
 * A finite `rate` is guaranteed here so the player's sine walk can never hit
 * `Math.sin(NaN)`. */
function normalizeVariableFrameDuration(raw: unknown): { slow: number; fast: number; rate: number } | undefined {
	if (!isPlainObject(raw)) return undefined;
	const num = (v: unknown, dflt: number) => (typeof v === "number" && Number.isFinite(v) ? v : dflt);
	let slow = num(raw.Slow, 0.1);
	let fast = num(raw.Fast, 1);
	const rate = num(raw.Rate, 0.5);
	if (slow > fast) [slow, fast] = [fast, slow];
	return { slow, fast, rate };
}

function frameValueToAssignments(
	value: unknown,
	elementGroups: Record<string, number[]>,
	elementStateMap: Record<number, string[]>,
	warnings: string[],
): Record<number, string> {
	if (typeof value === "string") {
		try {
			return parseFrameString(value, elementGroups, elementStateMap).assignments;
		} catch (e) {
			warnings.push(String((e as Error).message));
			return {};
		}
	}
	if (Array.isArray(value)) {
		const out: Record<number, string> = {};
		for (const entry of value) {
			if (!Array.isArray(entry) || entry.length < 2) continue;
			const [idx, state] = entry as [number, unknown];
			if (typeof state === "number") {
				out[idx] = elementStateMap[idx]?.[state - 1] ?? "OFF";
			} else {
				out[idx] = String(state);
			}
		}
		return out;
	}
	return {};
}

export function compileComponent(rawInput: RawComponent, opts: CompileOptions = {}): CompiledComponent {
	const warnings: string[] = [];
	const defaultLightStatesByGroup = opts.defaultLightStatesByGroup ?? {};

	let raw = resolveInheritance(deepClone(rawInput), opts.resolveBase);
	raw = applyFeatures(raw);

	const elementGroups = (raw.ElementGroups as Record<string, number[]>) || {};
	const stateSlots = (raw.States as unknown as string[]) || [];

	let elementStateMap: Record<number, string[]> = {};
	if (typeof raw.StateMap === "string" && raw.StateMap.trim() !== "") {
		try {
			elementStateMap = parseStateMap(raw.StateMap, elementGroups, stateSlots);
		} catch (e) {
			warnings.push(String((e as Error).message));
		}
	} else if (isPlainObject(raw.StateMap)) {
		elementStateMap = raw.StateMap as unknown as Record<number, string[]>;
	}

	// ===== Elements =====
	const elementsRawValue = raw.Elements as unknown;
	let elementsRaw: RawElement[] = [];
	if (Array.isArray(elementsRawValue)) {
		elementsRaw = elementsRawValue as RawElement[];
	} else if (isPlainObject(elementsRawValue)) {
		// Sparse `{ [n] = {...} }` table form (a Lua-to-JS conversion edge
		// case): the literal numeric keys ARE the 1-based element indices, so
		// place each at its own slot rather than collapsing to iteration
		// order -- otherwise `{ [1]=.., [5]=.. }` would renumber to 1,2 and
		// every Frames/StateMap reference to element 5 would hit the wrong
		// light.
		for (const [k, v] of Object.entries(elementsRawValue)) {
			const n = Number(k);
			if (Number.isInteger(n) && n >= 1) elementsRaw[n - 1] = v as RawElement;
		}
	} else if (elementsRawValue !== undefined) {
		warnings.push("COMPONENT.Elements was not a table (likely an unsupported multi-component file); elements skipped.");
	}
	const elements: CompiledElement[] = [];
	elementsRaw.forEach((elRaw, i) => {
		if (!elRaw) return;
		const index = i + 1;
		const { templateName, position, angle, overrides } = normalizeElement(elRaw);
		const found = findTemplate(raw, templateName);
		if (!found) {
			warnings.push(`Element [${index}] references unknown template "${templateName}"`);
			return;
		}
		const { group, template } = found;
		const props: RawTemplate = { ...template, ...overrides };
		delete (props as any).States;
		const statePool = buildStatePool(raw, group, template, defaultLightStatesByGroup);

		let states: CompiledElement["states"] = {};
		let boneStates: CompiledElement["boneStates"];
		if (group === "Bone") {
			boneStates = {};
			for (const [name, state] of Object.entries(statePool)) {
				boneStates[name] = resolveBoneState(state);
			}
		} else {
			const templateDefaults = {
				gainFactor: typeof props.IntensityGainFactor === "number" ? (props.IntensityGainFactor as number) : undefined,
				lossFactor: typeof props.IntensityLossFactor === "number" ? (props.IntensityLossFactor as number) : undefined,
			};
			for (const [name, state] of Object.entries(statePool)) {
				states[name] = resolveState(name, state, templateDefaults);
			}
		}

		// Elements parented to a rotating Bone (`BoneParent = N`) are
		// positioned relative to that bone's live transform, which this
		// simulator doesn't track (no 3D model) -- their authored Vector is
		// meaningless in world space, so they're excluded from rendering
		// rather than drawn in the wrong place. Elements at their own
		// authored position (including a Bone's OTHER, unparented indicator
		// lights, e.g. a rotating beacon's fixed ring LEDs) render normally.
		const isBoneParented = overrides.BoneParent !== undefined;
		const isVisual = (group === "2D" || group === "Mesh" || group === "Projected") && !isBoneParented;

		elements.push({
			index,
			templateGroup: group,
			templateName,
			position,
			angle,
			props,
			states,
			boneStates,
			isVisual,
		});
	});

	// ===== Segments =====
	const segments: Record<string, CompiledSegment> = {};
	for (const [segName, segRaw] of Object.entries(raw.Segments || {})) {
		const off = (segRaw as RawSegment).Off || "OFF";
		const frameDuration = (segRaw as RawSegment).FrameDuration ?? raw.FrameDuration ?? DEFAULT_FRAME_DURATION;
		const framesEntries = normalizeFramesTable((segRaw as RawSegment).Frames);

		const parsedFrames: Record<number, Record<number, string>> = {};
		const elementsUsed = new Set<number>();
		for (const [frameNum, value] of framesEntries) {
			const assignments = frameValueToAssignments(value, elementGroups, elementStateMap, warnings);
			parsedFrames[frameNum] = assignments;
			for (const idx of Object.keys(assignments)) elementsUsed.add(Number(idx));
		}

		// Auto-generate / fill zero frame per documented semantics.
		if (!parsedFrames[0]) {
			const zero: Record<number, string> = {};
			for (const idx of elementsUsed) zero[idx] = off;
			parsedFrames[0] = zero;
		} else {
			for (const idx of elementsUsed) {
				if (!(idx in parsedFrames[0])) parsedFrames[0][idx] = off;
			}
		}
		// Fill missing elements in every other frame from frame 0.
		for (const [frameNum, assignments] of Object.entries(parsedFrames)) {
			if (frameNum === "0") continue;
			for (const idx of elementsUsed) {
				if (!(idx in assignments)) assignments[idx] = parsedFrames[0][idx];
			}
		}

		const frames: Record<number, CompiledFrame> = {};
		for (const [frameNum, assignments] of Object.entries(parsedFrames)) {
			frames[Number(frameNum)] = { assignments };
		}

		const sequences: Record<string, CompiledSequence> = {};
		for (const [seqName, seqRaw] of Object.entries((segRaw as RawSegment).Sequences || {})) {
			const arr = (Array.isArray(seqRaw) ? seqRaw : []) as number[] & Record<string, unknown>;
			sequences[seqName] = {
				name: seqName,
				steps: [...arr],
				frameDuration: typeof arr.FrameDuration === "number" ? arr.FrameDuration : undefined,
				variableFrameDuration: normalizeVariableFrameDuration(arr.VariableFrameDuration),
				isRepeating: arr.IsRepeating === undefined ? true : Boolean(arr.IsRepeating),
			};
		}

		segments[segName] = {
			name: segName,
			off,
			frameDuration,
			frames,
			sequences,
			elementsUsed: [...elementsUsed].sort((a, b) => a - b),
			acceptedChannels: new Set(),
		};
	}

	// ===== Patterns =====
	const patterns: Record<string, RawPatternEntry[]> = {};
	for (const [name, entries] of Object.entries(raw.Patterns || {})) {
		patterns[name] = (entries as unknown[]).map((e) => {
			const arr = e as unknown[];
			return [String(arr[0]), String(arr[1])] as RawPatternEntry;
		});
	}

	function expandPattern(patternName: string, orderOverride?: number): Record<string, InputAssignment> {
		const out: Record<string, InputAssignment> = {};
		const entries = patterns[patternName];
		if (!entries) {
			warnings.push(`Unknown pattern "${patternName}"`);
			return out;
		}
		for (const [segment, sequenceRef] of entries) {
			const { sequence, phaseDegrees } = parseSequenceRef(sequenceRef);
			out[segment] = { sequence, order: orderOverride, phaseDegrees: phaseDegrees || undefined };
		}
		return out;
	}

	function unwrapPositional(val: unknown): { value: unknown; order?: number } {
		if (typeof val === "string") return { value: val };
		if (isPlainObject(val)) {
			const order = typeof val.Order === "number" ? val.Order : undefined;
			const positional = (val["1"] as unknown) ?? undefined;
			return { value: positional, order };
		}
		return { value: undefined };
	}

	// ===== Inputs =====
	const inputs: CompiledComponent["inputs"] = {};
	for (const [channel, modes] of Object.entries(raw.Inputs || {})) {
		inputs[channel] = inputs[channel] || {};
		for (const [mode, modeVal] of Object.entries(modes as Record<string, unknown>)) {
			const assignments: Record<string, InputAssignment> = {};
			if (typeof modeVal === "string") {
				Object.assign(assignments, expandPattern(modeVal));
			} else if (isPlainObject(modeVal)) {
				for (const [key, val] of Object.entries(modeVal)) {
					if (/^\d+$/.test(key)) {
						const { value, order } = unwrapPositional(val);
						if (typeof value === "string") Object.assign(assignments, expandPattern(value, order));
					} else {
						const { value, order } = unwrapPositional(val);
						if (typeof value === "string") {
							const { sequence, phaseDegrees } = parseSequenceRef(value);
							assignments[key] = { sequence, order, phaseDegrees: phaseDegrees || undefined };
						}
					}
				}
			}
			inputs[channel][mode] = assignments;
			for (const segName of Object.keys(assignments)) {
				segments[segName]?.acceptedChannels.add(channel);
			}
		}
	}

	const inputPriorities: Record<string, number> = { ...DEFAULT_INPUT_PRIORITIES, ...(raw.InputPriorities || {}) };

	const virtualOutputs: Record<string, { mode: string; conditions: Record<string, string[]> }[]> = {};
	for (const [channel, modes] of Object.entries(raw.VirtualOutputs || {})) {
		if (!Array.isArray(modes)) continue;
		virtualOutputs[channel] = modes.map((m) => ({
			mode: (m as { Mode: string }).Mode,
			conditions: (m as { Conditions: Record<string, string[]> }).Conditions || {},
		}));
	}

	return {
		id: opts.id || raw.Name || "component",
		title: raw.Title || opts.id || "Untitled Component",
		category: raw.Category || "Lightbar",
		author: raw.Author,
		credits: raw.Credits,
		model: raw.Model,
		elements,
		segments,
		inputs,
		inputPriorities,
		virtualOutputs,
		patterns,
		elementGroups,
		stateSlots,
		stateMapRaw: typeof raw.StateMap === "string" ? raw.StateMap : undefined,
		warnings,
		raw: rawInput,
	};
}
