import type { CompiledComponent, CompiledElement, CompiledSegment, ResolvedState, RGB, BoneStateDef } from "./types";
import { parseStateToken, mixRGB } from "./color";

/** Matches compiler.ts's DEFAULT_FRAME_DURATION; used only as a divide-by-zero
 * backstop for components that declare an invalid FrameDuration. */
const FALLBACK_FRAME_DURATION = 1 / 24;

interface BoneRuntime {
	angle: number; // degrees, [0, 360)
	headingToEnd: boolean; // Sweep only: currently travelling toward sweepEnd vs sweepStart
	pauseRemaining: number; // Sweep only: seconds left dwelling at the current endpoint
}

/** Moves `current` toward `target` at `speed` degrees/second, always
 * travelling in the commanded `direction` (>=0 = increasing angle, <0 =
 * decreasing), wrapping through 0/360 as needed -- e.g. direction=-1 from
 * 10 toward 350 travels 10->0->350, not the "shorter" way through 180.
 * Snaps exactly to `target` once within one step's reach. */
function stepToward(current: number, target: number, speed: number, direction: number, dtSeconds: number): number {
	const maxStep = Math.max(0, speed) * dtSeconds;
	const cur = ((current % 360) + 360) % 360;
	const tgt = ((target % 360) + 360) % 360;
	if (direction >= 0) {
		const dist = (tgt - cur + 360) % 360;
		if (dist <= maxStep) return tgt;
		return (cur + maxStep) % 360;
	}
	const dist = (cur - tgt + 360) % 360;
	if (dist <= maxStep) return tgt;
	return (cur - maxStep + 360) % 360;
}

/** Advances a bone's rotation runtime by one tick according to its
 * currently active BoneStateDef. */
function stepBoneRuntime(rt: BoneRuntime, def: BoneStateDef, dt: number) {
	const speed = def.speed ?? 0;
	if (def.activity === "Rotate") {
		rt.angle = (rt.angle + speed * dt + 360) % 360;
	} else if (def.activity === "Fixed") {
		rt.angle = stepToward(rt.angle, def.target ?? 0, speed, def.direction ?? 1, dt);
	} else if (def.activity === "Sweep") {
		if (rt.pauseRemaining > 0) {
			rt.pauseRemaining = Math.max(0, rt.pauseRemaining - dt);
			return;
		}
		const baseDir = def.direction ?? 1;
		const dir = rt.headingToEnd ? baseDir : -baseDir;
		const target = rt.headingToEnd ? (def.sweepEnd ?? 0) : (def.sweepStart ?? 0);
		const next = stepToward(rt.angle, target, speed, dir, dt);
		rt.angle = next;
		if (next === (((target % 360) + 360) % 360)) {
			rt.pauseRemaining = def.sweepPause ?? 0;
			rt.headingToEnd = !rt.headingToEnd;
		}
	}
	// "Spot" and unrecognized activities: hold the current angle (Spot is
	// explicitly noted as still under development upstream).
}

/** Resolves a bone's AngleOutputMap at its current angle: the state from
 * the last breakpoint at or before the angle, wrapping circularly (an
 * angle before the first breakpoint uses the last one, continuing its
 * "zone" through the 360/0 seam) -- e.g. breakpoints at 0/25/135/225/335
 * mean angle 10 still reads as the 335 zone's state. */
function resolveAngleOutput(map: Array<{ angle: number; state: string }>, angle: number): string | undefined {
	if (map.length === 0) return undefined;
	const sorted = [...map].sort((a, b) => a.angle - b.angle);
	const norm = ((angle % 360) + 360) % 360;
	let result = sorted[sorted.length - 1].state;
	for (const bp of sorted) {
		if (bp.angle <= norm) result = bp.state;
		else break;
	}
	return result;
}

interface Activation {
	key: string | null;
	channel: string | null;
	sequenceName: string | null;
	order?: number;
	phaseDegrees?: number;
	since: number; // ms, simulation clock
}

/**
 * Runtime playback engine approximating Photon2's controller/segment logic:
 * per-segment channel priority resolution (Segment:CalculatePriorityChannel),
 * frame-index sequence stepping at each segment's FrameDuration, and
 * Order-based compositing when multiple active segments share an element.
 */
export class ComponentPlayer {
	readonly component: CompiledComponent;
	currentModes: Record<string, string | null> = {};
	simTimeMs = 0;
	private activation: Record<string, Activation> = {};
	private forced: Record<string, string | null> = {};
	private visualIntensity: Record<number, number> = {};
	private visualColor: Record<number, RGB> = {};
	private lastStatesTimeMs = 0;
	private boneRuntime: Record<number, BoneRuntime> = {};
	/** Resumable frame cursor for sequences with VariableFrameDuration, keyed
	 * by segment name. Sequence elapsed time only ever grows while an
	 * activation is held, so the sinusoidal frame walk (see
	 * `variableFrameIndex`) resumes from here instead of restarting from t=0
	 * every render. Invalidated when the segment's activation changes or on
	 * reset. */
	private vfdCursor: Record<string, { sinceMs: number; tSec: number; steps: number }> = {};

	constructor(component: CompiledComponent) {
		this.component = component;
		for (const name of Object.keys(component.segments)) {
			this.activation[name] = { key: null, channel: null, sequenceName: null, since: 0 };
		}
	}

	setMode(channel: string, mode: string | null) {
		this.currentModes[channel] = mode;
		this.evaluateVirtualOutputs();
		this.updateActivations();
	}

	getMode(channel: string): string | null {
		return this.currentModes[channel] ?? null;
	}

	/** Forces a segment to preview a specific sequence regardless of the
	 * current dashboard state (or clears the override with `null`). Used by
	 * the segment/sequence inspector for browsing patterns in isolation. */
	forceSequence(segmentName: string, sequenceName: string | null) {
		if (sequenceName === null) delete this.forced[segmentName];
		else this.forced[segmentName] = sequenceName;
		this.updateActivations();
	}

	isForced(segmentName: string): boolean {
		return this.forced[segmentName] !== undefined;
	}

	reset() {
		this.simTimeMs = 0;
		this.lastStatesTimeMs = 0;
		this.currentModes = {};
		this.visualIntensity = {};
		this.visualColor = {};
		this.boneRuntime = {};
		this.vfdCursor = {};
		for (const name of Object.keys(this.component.segments)) {
			this.activation[name] = { key: null, channel: null, sequenceName: null, since: 0 };
		}
		this.evaluateVirtualOutputs();
		this.updateActivations();
	}

	advance(dtMs: number) {
		this.simTimeMs += dtMs;
	}

	/** Resolves COMPONENT.VirtualOutputs -- condition-based derived channels
	 * (e.g. "Virtual.ParkedWarning" becomes MODE3 when Vehicle.Transmission
	 * is PARK AND Emergency.Warning is MODE3) -- into `currentModes`, exactly
	 * like a real channel, so segments that key off them (a common pattern
	 * for park-mode/night-mode/automatic-headlight variants) activate
	 * without the UI needing special-case knowledge of every component's
	 * virtual channels. Runs a few passes since a virtual output's
	 * conditions can reference another virtual output. */
	private evaluateVirtualOutputs() {
		for (let pass = 0; pass < 4; pass++) {
			let changed = false;
			for (const [channel, modes] of Object.entries(this.component.virtualOutputs)) {
				// Mirror upstream Component:ApplyModeUpdate
				// (meta/lighting_component.lua:620-638): walk the mode entries in
				// array order and take the FIRST whose conditions are all met,
				// then stop. There is no "most specific wins" preference -- an
				// earlier entry beats a later one even if the later one lists
				// more conditions. (Consequence: for the Feature-generated
				// Vehicle.AutomaticLighting, "HEADLIGHTS" -- listed first, and a
				// condition-subset of "PARKING" -- always wins, so "PARKING" is
				// unreachable, exactly as in-game.) Upstream seeds "OFF" when
				// nothing matches; we use null to mean the derived channel is
				// inactive. An entry with no conditions matches unconditionally
				// (`[].every` is vacuously true), same as upstream's empty
				// condition loop.
				let resolved: string | null = null;
				for (const entry of modes) {
					const ok = Object.entries(entry.conditions).every(([condChannel, allowed]) => {
						const val = this.currentModes[condChannel];
						return val != null && allowed.includes(val);
					});
					if (ok) {
						resolved = entry.mode;
						break;
					}
				}
				if (this.currentModes[channel] !== resolved) {
					this.currentModes[channel] = resolved;
					changed = true;
				}
			}
			if (!changed) break;
		}
	}

	private updateActivations() {
		const { component } = this;
		for (const seg of Object.values(component.segments)) {
			if (this.forced[seg.name] !== undefined) {
				const seqName = this.forced[seg.name];
				const key = `FORCED/${seqName}`;
				const prev = this.activation[seg.name];
				if (!prev || prev.key !== key) {
					this.activation[seg.name] = { key, channel: null, sequenceName: seqName, order: 0, since: this.simTimeMs };
				}
				continue;
			}
			const candidates = [...seg.acceptedChannels].filter((ch) => {
				const mode = this.currentModes[ch];
				if (!mode) return false;
				return component.inputs[ch]?.[mode]?.[seg.name] !== undefined;
			});
			candidates.sort((a, b) => (component.inputPriorities[b] ?? 0) - (component.inputPriorities[a] ?? 0));
			const winner = candidates[0];
			let key: string | null = null;
			let channel: string | null = null;
			let sequenceName: string | null = null;
			let order: number | undefined;
			let phaseDegrees: number | undefined;
			if (winner) {
				const mode = this.currentModes[winner]!;
				const assignment = component.inputs[winner][mode][seg.name];
				key = `${winner}:${mode}/${assignment.sequence}`;
				channel = winner;
				sequenceName = assignment.sequence;
				order = assignment.order;
				phaseDegrees = assignment.phaseDegrees;
			}
			const prev = this.activation[seg.name];
			if (!prev || prev.key !== key) {
				this.activation[seg.name] = { key, channel, sequenceName, order, phaseDegrees, since: this.simTimeMs };
			}
		}
	}

	/** Compositing priority for a segment's current contribution. Segments
	 * commonly share physical elements (e.g. Whelen Edge's "Alley" and
	 * "AlleyLeft"/"AlleyRight" both touch elements 7/8) -- an idle segment
	 * must never be able to override an active one just because of
	 * iteration order, and among active segments the one driven by the
	 * higher-priority channel (per COMPONENT.InputPriorities, mirroring
	 * Segment:CalculatePriorityChannel) wins. `Order` (from the Inputs
	 * entry) only matters as a tie-break between segments driven by the
	 * SAME channel, matching the wiki's "Ordering" feature. */
	private contributionPriority(act: Activation): number {
		if (act.key?.startsWith("FORCED/")) return Number.POSITIVE_INFINITY;
		if (!act.sequenceName) return Number.NEGATIVE_INFINITY; // idle
		const base = act.channel ? (this.component.inputPriorities[act.channel] ?? 0) : 0;
		return base;
	}

	private segmentFrameAssignments(seg: CompiledSegment): { priority: number; order: number; assignments: Record<number, string> } | null {
		const act = this.activation[seg.name];
		const priority = this.contributionPriority(act);
		if (act?.sequenceName) {
			const sequence = seg.sequences[act.sequenceName];
			if (!sequence || sequence.steps.length === 0)
				return { priority, order: act.order ?? 0, assignments: seg.frames[0]?.assignments ?? {} };
			const elapsedSec = Math.max(0, this.simTimeMs - act.since) / 1000;
			const stepCount = sequence.steps.length;
			let rawIndex: number;
			if (sequence.variableFrameDuration) {
				rawIndex = this.variableFrameIndex(seg.name, act.since, elapsedSec, sequence.variableFrameDuration, stepCount, sequence.isRepeating);
			} else {
				const rawDuration = sequence.frameDuration ?? seg.frameDuration;
				// A component that (invalidly) declares FrameDuration = 0 -- or a
				// non-finite value -- would otherwise divide to Infinity/NaN and
				// silently freeze the sequence on its zero frame.
				const frameDuration = rawDuration > 0 && Number.isFinite(rawDuration) ? rawDuration : FALLBACK_FRAME_DURATION;
				rawIndex = Math.floor(elapsedSec / frameDuration);
			}
			// Degree phasing (Photon2 PhaseOffset): shift the frame cursor by
			// round(stepCount * deg/360) so identical patterns on sibling
			// segments run out of step. Only meaningful for a repeating
			// sequence; a non-repeating one clamps to its last frame either way.
			const phaseOffset = act.phaseDegrees ? Math.round(stepCount * (act.phaseDegrees / 360)) : 0;
			const cursor = sequence.isRepeating
				? (((rawIndex + phaseOffset) % stepCount) + stepCount) % stepCount
				: Math.min(rawIndex, stepCount - 1);
			const frameNum = sequence.steps[cursor] ?? 0;
			const frame = seg.frames[frameNum] ?? seg.frames[0];
			return { priority, order: act.order ?? 0, assignments: frame?.assignments ?? {} };
		}
		if (seg.off === "PASS") return null; // idle + PASS: defers entirely, contributes nothing
		return { priority, order: 0, assignments: seg.frames[0]?.assignments ?? {} };
	}

	/** Frame index for a sequence whose FrameDuration oscillates (Photon2's
	 * `:SetVariableTiming(slow, fast, rate)` / `VariableFrameDuration`). The
	 * real runtime resamples the duration at the start of every frame from
	 * `Photon2.Util.DynamicTimer` (a sine sweep between `slow` and `fast` at
	 * `rate` rad/s), so there is no closed form -- this walks frame by frame
	 * accumulating durations until it passes `elapsedSec`. The walk is
	 * resumed across calls via `vfdCursor` (elapsed time only grows while the
	 * activation is held), keeping it ~O(frames since the last render). */
	private variableFrameIndex(
		segName: string,
		sinceMs: number,
		elapsedSec: number,
		vfd: { slow: number; fast: number; rate: number },
		stepCount: number,
		isRepeating: boolean,
	): number {
		// `vfd` is normalized by the compiler (finite fields, slow <= fast). The
		// extra floors here only defend a hand-built object: `slow > 0` keeps
		// the sine's minimum (`sin == -1` => fd == slow) strictly positive so
		// the walk always advances, and a finite `rate` avoids `Math.sin(NaN)`.
		const slow = vfd.slow > 0 ? vfd.slow : 0.001;
		const fast = Math.max(slow, vfd.fast);
		const rate = Number.isFinite(vfd.rate) ? vfd.rate : 0.5;

		let cache = this.vfdCursor[segName];
		if (!cache || cache.sinceMs !== sinceMs || cache.tSec > elapsedSec) {
			cache = { sinceMs, tSec: 0, steps: 0 };
			this.vfdCursor[segName] = cache;
		}

		// Non-repeating sequences clamp to the last frame, so there is no point
		// walking past it.
		const stepCap = isRepeating ? Number.POSITIVE_INFINITY : Math.max(0, stepCount - 1);
		let guard = 100_000; // safety valve for a very large time jump
		while (guard-- > 0 && cache.steps < stepCap) {
			const fd = ((Math.sin(cache.tSec * rate) + 1) / 2) * (fast - slow) + slow;
			if (cache.tSec + fd > elapsedSec) break;
			cache.tSec += fd;
			cache.steps++;
		}
		return cache.steps;
	}

	/** Which (channel, mode) is currently driving each segment -- for UI display. */
	getActiveSegmentInfo(): Record<string, { channel: string; mode: string; sequence: string } | null> {
		const out: Record<string, { channel: string; mode: string; sequence: string } | null> = {};
		for (const [name, act] of Object.entries(this.activation)) {
			if (!act.key || !act.sequenceName) {
				out[name] = null;
				continue;
			}
			if (act.key.startsWith("FORCED/")) {
				out[name] = { channel: "(forced)", mode: "", sequence: act.sequenceName };
				continue;
			}
			const mode = act.channel ? (this.currentModes[act.channel] ?? "") : "";
			out[name] = { channel: act.channel ?? "", mode, sequence: act.sequenceName };
		}
		return out;
	}

	getElementStates(): Record<number, ResolvedState> {
		const { component } = this;
		const contributions: Array<{ priority: number; order: number; assignments: Record<number, string> }> = [];
		for (const seg of Object.values(component.segments)) {
			const c = this.segmentFrameAssignments(seg);
			if (c) contributions.push(c);
		}
		// Ascending: highest-priority (and, within a tie, highest-Order)
		// contribution is applied LAST so it wins the per-element merge below.
		contributions.sort((a, b) => a.priority - b.priority || a.order - b.order);

		// A per-element "PASS" state (distinct from a segment's `Off = "PASS"`)
		// means "this segment declines to control this specific element right
		// now -- leave it to whatever else is controlling it." It must never
		// be written into the merge (an element's zero-frame is filled with
		// its segment's Off value for every element the segment ever
		// touches, so an idle/non-participating segment commonly contributes
		// "PASS" for elements that belong to a DIFFERENT mode of the same
		// segment -- e.g. FLOOD-only elements while TAKEDOWN is active).
		const stateNames: Record<number, string> = {};
		for (const c of contributions) {
			for (const [idxStr, stateName] of Object.entries(c.assignments)) {
				if (stateName === "PASS") continue;
				stateNames[Number(idxStr)] = stateName;
			}
		}

		const dt = Math.max(0, this.simTimeMs - this.lastStatesTimeMs) / 1000;
		this.lastStatesTimeMs = this.simTimeMs;

		const angleOutputByBone = this.stepBones(stateNames, dt);

		const out: Record<number, ResolvedState> = {};
		for (const el of component.elements) {
			let target = resolveDynamicState(stateNames[el.index], el);
			if (target.proxy) {
				// A "proxy state" (see ResolvedState.proxy): this element's real
				// color comes from a rotating Bone element's current
				// AngleOutput, not from this state's own (absent) color data --
				// e.g. Vision SLR's fixed indicator ring reading the color of
				// whatever's currently facing it as the beacon rotates.
				const boneKey = target.proxy.key;
				const resolved = resolveDynamicState(angleOutputByBone[boneKey], el);
				// AngleOutputMap zones are discrete (R/A/B/W snap the instant
				// the angle crosses a breakpoint), which reads as harsh
				// flicker on a fast-rotating bone -- the named states
				// involved rarely opt into the `~` transition convention
				// themselves, but a physically spinning light's apparent
				// color naturally blends across the boundary, so this always
				// fades (the same mechanism DVI's `~1`/`~2` states use) rather
				// than snapping, regardless of the resolved state's own flag.
				target = {
					...resolved,
					transitions: true,
					gainFactor: resolved.transitions ? resolved.gainFactor : 15,
					lossFactor: resolved.transitions ? resolved.lossFactor : 15,
					rotationAngle: this.boneRuntime[boneKey]?.angle,
				};
			}
			out[el.index] = this.applyTransition(el.index, target, dt);
		}
		return out;
	}

	/** Advances every "Bone" element's rotation (continuous Rotate, back-
	 * and-forth Sweep, or move-to-angle Fixed -- see BoneStateDef) and
	 * returns each one's current AngleOutput state name (from its active
	 * state's AngleOutputMap breakpoints), keyed by element index, for
	 * `proxy`-referencing elements to pick up. */
	private stepBones(stateNames: Record<number, string>, dt: number): Record<number, string> {
		const angleOutputByBone: Record<number, string> = {};
		for (const el of this.component.elements) {
			if (!el.boneStates) continue;
			const stateName = stateNames[el.index] ?? (el.props.DeactivationState as string | undefined);
			const def = stateName ? el.boneStates[stateName] : undefined;

			const rt = (this.boneRuntime[el.index] ??= { angle: 0, headingToEnd: true, pauseRemaining: 0 });
			if (def) stepBoneRuntime(rt, def, dt);

			if (def?.angleOutputMap?.length) {
				const output = resolveAngleOutput(def.angleOutputMap, rt.angle);
				if (output !== undefined) angleOutputByBone[el.index] = output;
			}
		}
		return angleOutputByBone;
	}

	/** States marked `IntensityTransitions` (the `~` prefix convention --
	 * e.g. DVI's `[~1]`/`[~2]` tokens, or a halogen template's `~OFF`
	 * DeactivationState) fade rather than snap, at the state's own
	 * IntensityGainFactor (brightening) or IntensityLossFactor (dimming) --
	 * mirroring Photon2's per-element intensity ramp. Plain (non-`~`) states
	 * still snap instantly, preserving crisp strobe flashes. */
	private applyTransition(elementIndex: number, target: ResolvedState, dt: number): ResolvedState {
		if (!target.transitions) {
			this.visualIntensity[elementIndex] = target.intensity;
			this.visualColor[elementIndex] = target.color;
			return target;
		}
		const currentIntensity = this.visualIntensity[elementIndex] ?? 0;
		const currentColor = this.visualColor[elementIndex] ?? target.color;
		const rising = target.intensity >= currentIntensity;
		const rate = Math.max(0.01, rising ? target.gainFactor : target.lossFactor);
		const factor = dt > 0 ? 1 - Math.exp(-rate * dt) : 0;

		const newIntensity = currentIntensity + (target.intensity - currentIntensity) * factor;
		const newColor = mixRGB(currentColor, target.color, factor);
		this.visualIntensity[elementIndex] = newIntensity;
		this.visualColor[elementIndex] = newColor;

		return { ...target, intensity: newIntensity, color: newColor };
	}
}

const OFF_STATE: ResolvedState = {
	name: "OFF",
	color: { r: 0, g: 0, b: 0 },
	intensity: 0,
	transitions: false,
	gainFactor: 1,
	lossFactor: 10,
};

function resolveDynamicState(stateName: string | undefined, el: CompiledElement): ResolvedState {
	if (stateName === undefined) {
		// No segment claims this element at all right now (or every segment
		// that touches it deferred via a per-element "PASS") -- fall back to
		// its template's DeactivationState (defaults to "OFF", but e.g.
		// halogen-style templates commonly use "~OFF" for a fade-out).
		const deactivation = (el.props.DeactivationState as string | undefined) ?? "OFF";
		return el.states[deactivation] ?? el.states["OFF"] ?? OFF_STATE;
	}
	const direct = el.states[stateName];
	if (direct) return direct;

	const parsed = parseStateToken(stateName);
	const base = el.states[parsed.base];
	if (!base) return el.states["OFF"] ?? OFF_STATE;
	return {
		...base,
		name: stateName,
		transitions: parsed.transitions || base.transitions,
		gainFactor: parsed.gain ?? base.gainFactor,
		lossFactor: parsed.loss ?? base.lossFactor,
		intensity: parsed.intensity ?? base.intensity,
	};
}
