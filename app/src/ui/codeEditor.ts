import type { CompiledComponent } from "../engine/types";
import { compileComponent } from "../engine/compiler";
import { getDefaultLightStatesByGroup, runComponentPatchLua } from "../lua/loader";
import { mergeComponentPatch } from "../engine/mergePatch";
import { resolveRawComponent } from "../data";

const DEFAULT_SNIPPET = `-- Write real Photon2 syntax here -- the exact Segments/Sequences/Inputs
-- DSL from the addon itself (Frames strings, Photon2.SequenceBuilder
-- chains, StateMap, etc). "COMPONENT" and "sequence" are already declared,
-- same as the top of a real component file.
--
-- This snippet is a PATCH: you only need to write what you're adding or
-- changing -- existing segments/inputs on this lightbar are left alone
-- unless you redefine something with the same name.

COMPONENT.Segments = {
	MyPattern = {
		Frames = {
			[1] = "[R] 1 3 5",
			[2] = "[B] 2 4 6",
		},
		Sequences = {
			["FLASH"] = sequence():Alternate( 1, 2, 6 ),
		},
	},
}

COMPONENT.Inputs = {
	["Emergency.Warning"] = {
		["MODE1"] = { MyPattern = "FLASH" },
	},
}
`;

const draftStore: Record<string, string> = {};

export function renderCodeEditor(el: HTMLElement, component: CompiledComponent, onUpdate: (updated: CompiledComponent) => void) {
	if (draftStore[component.id] === undefined) draftStore[component.id] = DEFAULT_SNIPPET;

	el.innerHTML = `
    <div class="hint">
      Author patterns using Photon2's own syntax -- the same Frames/StateMap DSL and
      <code>Photon2.SequenceBuilder</code> chains real component files use. Reference:
      <a href="https://github.com/photonle/Photon-v2/wiki/Components" target="_blank" rel="noopener">Components wiki</a>.
    </div>
    <details style="margin-bottom:10px;">
      <summary style="cursor:pointer;color:var(--text-dim);font-size:12px;">Quick syntax reference</summary>
      <div class="hint" style="margin-top:8px;">
        <b>Frames</b> (space-separated tokens; <code>[STATE]</code> sets the state for tokens until the next bracket):<br/>
        <code>[R] 1 3 5 [B] 2 4 6</code> &middot; <code>GroupName:R</code> &middot; <code>[~OFF] 7 8</code> (fade)<br/><br/>
        <b>Sequences</b> (a plain array of frame numbers, 0 = off, or a builder chain):<br/>
        <code>{ 1, 0, 1, 0, 2, 0, 2, 0 }</code><br/>
        <code>sequence():Alternate( 1, 2, 12 )</code> &middot; <code>sequence():Add(1,0):Do(3)</code> &middot;
        <code>sequence():SteadyFlash(1)</code> &middot; <code>sequence():SetTiming(1/30)</code><br/><br/>
        <b>Inputs</b>: <code>COMPONENT.Inputs["Emergency.Warning"]["MODE1"] = { SegmentName = "SequenceName" }</code>
      </div>
    </details>
    <textarea id="code-input" class="export-output" spellcheck="false" style="min-height:280px;"></textarea>
    <div class="row" style="margin:10px 0;">
      <button class="primary" id="apply-btn">Apply to lightbar</button>
      <button id="reset-snippet-btn" class="subtle">Reset to template</button>
    </div>
    <div id="code-error" style="display:none;color:#e0716f;font-size:12px;white-space:pre-wrap;background:#1c1214;border:1px solid #3a1f21;border-radius:6px;padding:8px;margin-bottom:10px;"></div>
  `;

	const textarea = el.querySelector("#code-input") as HTMLTextAreaElement;
	textarea.value = draftStore[component.id];
	textarea.addEventListener("input", () => (draftStore[component.id] = textarea.value));

	const errorBox = el.querySelector("#code-error") as HTMLDivElement;

	el.querySelector("#reset-snippet-btn")!.addEventListener("click", () => {
		textarea.value = DEFAULT_SNIPPET;
		draftStore[component.id] = DEFAULT_SNIPPET;
	});

	el.querySelector("#apply-btn")!.addEventListener("click", () => {
		errorBox.style.display = "none";
		const { component: patch, error } = runComponentPatchLua(textarea.value);
		if (error) {
			errorBox.style.display = "block";
			errorBox.textContent = error;
			return;
		}
		try {
			const mergedRaw = mergeComponentPatch(component.raw, patch);
			const updated = compileComponent(mergedRaw, {
				id: component.id,
				defaultLightStatesByGroup: getDefaultLightStatesByGroup(),
				resolveBase: (name) => resolveRawComponent(name),
			});
			onUpdate(updated);
		} catch (e) {
			errorBox.style.display = "block";
			errorBox.textContent = `Compile error: ${(e as Error).message}`;
		}
	});
}
