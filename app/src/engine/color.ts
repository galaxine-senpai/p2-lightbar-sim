import type { RGB, RawState, ResolvedState, BoneStateDef } from "./types";

const FALLBACK: RGB = { r: 160, g: 160, b: 160 };

/**
 * Picks a representative steady-state RGB for a state definition extracted
 * from real Photon2 data. Real states store several PhotonBlendColor
 * {From,To} pairs used for layered subtractive/additive Source-engine
 * rendering; at full intensity the visually "correct" simple color is the
 * `Blend` field when a component author supplied one (it's exactly the
 * plain PhotonColor(r,g,b) call before any blending math), and otherwise
 * `ShapeGlowColor.To` is the closest single-color approximation (the outer
 * glow color, least distorted by the inversion tricks used for the
 * lens/detail layers).
 */
export function representativeColor(state: RawState | undefined | null): RGB {
	if (!state) return FALLBACK;
	const blend = state.Blend as any;
	if (blend && typeof blend.r === "number") {
		return { r: blend.r, g: blend.g, b: blend.b };
	}
	// A bare (non-blended) PhotonColor -- e.g. Mesh/Projected's simpler
	// DrawColor/Color fields are commonly just `PhotonColor(r,g,b)` with no
	// :Blend() chain, so `.To` never gets set below.
	const plainColor = (state.DrawColor ?? state.Color) as any;
	if (plainColor && typeof plainColor.r === "number" && plainColor.To === undefined) {
		return { r: plainColor.r, g: plainColor.g, b: plainColor.b };
	}
	const candidates = [
		state.ShapeGlowColor,
		state.GlowColor,
		state.SourceDetailColor,
		state.InnerGlowColor,
		state.SourceFillColor,
		state.DrawColor,
		state.BloomColor,
		state.Color,
	];
	for (const c of candidates) {
		const to = (c as any)?.To;
		if (to && typeof to.r === "number") {
			return clampRGB(to);
		}
	}
	return FALLBACK;
}

function clampRGB(c: RGB): RGB {
	return {
		r: Math.max(0, Math.min(255, Math.round(c.r))),
		g: Math.max(0, Math.min(255, Math.round(c.g))),
		b: Math.max(0, Math.min(255, Math.round(c.b))),
	};
}

/**
 * `templateDefaults` are the ELEMENT's own IntensityGainFactor/LossFactor
 * (from its Template, e.g. a halogen template commonly sets these to tune
 * how quickly its bulb-style fade responds) -- real Photon2 states rarely
 * define these themselves, they inherit the light's own defaults unless a
 * specific state overrides them.
 */
export function resolveState(
	name: string,
	raw: RawState | undefined,
	templateDefaults?: { gainFactor?: number; lossFactor?: number },
): ResolvedState {
	const intensity = typeof raw?.Intensity === "number" ? (raw!.Intensity as number) : 1;
	const rawProxy = raw?.Proxy as { Type?: string; Key?: number; Value?: string } | undefined;
	const proxy = rawProxy && rawProxy.Type === "FROM_LIGHT" ? { key: Number(rawProxy.Key) } : undefined;
	return {
		name,
		color: representativeColor(raw),
		intensity,
		transitions: Boolean(raw?.IntensityTransitions),
		gainFactor:
			typeof raw?.IntensityGainFactor === "number" ? (raw!.IntensityGainFactor as number) : (templateDefaults?.gainFactor ?? 1),
		lossFactor:
			typeof raw?.IntensityLossFactor === "number" ? (raw!.IntensityLossFactor as number) : (templateDefaults?.lossFactor ?? 10),
		proxy,
	};
}

/** Compiles a Bone element state (motion, not color) -- see BoneStateDef. */
export function resolveBoneState(raw: RawState | undefined): BoneStateDef {
	const rawMap = raw?.AngleOutputMap as unknown[] | undefined;
	const angleOutputMap = Array.isArray(rawMap)
		? rawMap
				.map((entry) => {
					const pair = entry as unknown[];
					const angle = Number(pair?.[0]);
					const state = pair?.[1];
					return Number.isFinite(angle) && typeof state === "string" ? { angle, state } : undefined;
				})
				.filter((v): v is { angle: number; state: string } => v !== undefined)
		: undefined;

	return {
		activity: typeof raw?.Activity === "string" ? (raw.Activity as string) : "Fixed",
		target: typeof raw?.Target === "number" ? (raw.Target as number) : undefined,
		speed: typeof raw?.Speed === "number" ? (raw.Speed as number) : undefined,
		direction: typeof raw?.Direction === "number" ? (raw.Direction as number) : undefined,
		sweepStart: typeof raw?.SweepStart === "number" ? (raw.SweepStart as number) : undefined,
		sweepEnd: typeof raw?.SweepEnd === "number" ? (raw.SweepEnd as number) : undefined,
		sweepPause: typeof raw?.SweepPause === "number" ? (raw.SweepPause as number) : undefined,
		angleOutputMap,
	};
}

export function rgbToCss(c: RGB, alpha = 1): string {
	return `rgba(${c.r | 0}, ${c.g | 0}, ${c.b | 0}, ${alpha})`;
}

export function mixRGB(a: RGB, b: RGB, t: number): RGB {
	return {
		r: a.r + (b.r - a.r) * t,
		g: a.g + (b.g - a.g) * t,
		b: a.b + (b.b - a.b) * t,
	};
}

/** Parses Photon2's dynamic intensity-transition state syntax, e.g.
 * `~(0.5,1)B*0.5`, `~R`, `R*0.8`, `~B(2)`. Returns the base state name plus
 * any inline overrides; unmatched input is treated as a plain literal name. */
export interface ParsedStateToken {
	raw: string;
	base: string;
	transitions: boolean;
	gain?: number;
	loss?: number;
	intensity?: number;
}

const TOKEN_RE = /^(~)?(?:\(([\d.]+),([\d.]+)\))?(?:\((\d+(?:\.\d+)?)\))?([^*()]+?)(?:\*([\d.]+))?$/;

export function parseStateToken(raw: string): ParsedStateToken {
	const m = TOKEN_RE.exec(raw);
	if (!m) return { raw, base: raw, transitions: raw.startsWith("~") };
	const [, tilde, gainStr, lossStr, singleFactorStr, base, intensityStr] = m;
	const transitions = Boolean(tilde);
	let gain: number | undefined;
	let loss: number | undefined;
	if (gainStr && lossStr) {
		gain = parseFloat(gainStr);
		loss = parseFloat(lossStr);
	} else if (singleFactorStr) {
		gain = loss = parseFloat(singleFactorStr);
	}
	return {
		raw,
		base: base || raw,
		transitions,
		gain,
		loss,
		intensity: intensityStr ? parseFloat(intensityStr) : undefined,
	};
}
