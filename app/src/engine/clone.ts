/**
 * A JSON round-trip silently drops any extra NAMED properties attached to
 * an array -- which is exactly how Lua tables built by
 * Photon2.SequenceBuilder chains get represented after Lua->JS conversion
 * (a dense integer-keyed array PLUS `.IsRepeating`/`.FrameDuration`/
 * `.VariableFrameDuration` properties tacked on), and likewise an authored
 * element's `.BoneParent`/etc named override. This clones structurally
 * instead, preserving them, so a real component's explicit
 * :SetTiming()/:SetRepeating(false)/:SetVariableTiming() and
 * BoneParent-relative elements survive being cloned (during Base
 * inheritance, Features application, or a pattern-editor commit).
 */
export function deepClone<T>(v: T): T {
	if (v === null || typeof v !== "object") return v;
	if (Array.isArray(v)) {
		const out: unknown[] = v.map((item) => deepClone(item));
		for (const key of Object.keys(v)) {
			if (/^\d+$/.test(key)) continue; // already copied via map()
			(out as unknown as Record<string, unknown>)[key] = deepClone((v as unknown as Record<string, unknown>)[key]);
		}
		return out as unknown as T;
	}
	const out: Record<string, unknown> = {};
	for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
		out[k] = deepClone(val);
	}
	return out as T;
}
