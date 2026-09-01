import type { CompiledComponent, RawComponent } from "../engine/types";
import { compileComponent } from "../engine/compiler";
import { getDefaultLightStatesByGroup } from "../lua/loader";
import { resolveRawComponent } from "../data";
import { STANDARD_CHANNELS } from "../engine/types";
import { deepClone } from "../engine/clone";

interface DraftElement {
	tempId: number;
	x: number;
	y: number;
	z: number;
	yaw: number;
	width: number;
	height: number;
}

interface Draft {
	newElements: DraftElement[];
	segmentName: string;
	off: "OFF" | "~OFF" | "PASS";
	frameCount: number;
	grid: Record<string, string[]>; // rowKey -> state per frame column
	frameDuration: number;
	sequenceSteps: string;
	channel: string;
	mode: string;
	customChannel: string;
	customMode: string;
}

const draftStore: Record<string, Draft> = {};
let tempIdCounter = 1;

const DEFAULT_STATE_OPTIONS = ["OFF", "~OFF", "R", "B", "G", "A", "W", "SW", "HR"];

function getDraft(component: CompiledComponent): Draft {
	if (!draftStore[component.id]) {
		draftStore[component.id] = {
			newElements: [],
			segmentName: nextSegmentName(component),
			off: "OFF",
			frameCount: 2,
			grid: {},
			frameDuration: 1 / 24,
			sequenceSteps: "1,2",
			channel: "Emergency.Warning",
			mode: "MODE1",
			customChannel: "",
			customMode: "",
		};
	}
	return draftStore[component.id];
}

function nextSegmentName(component: CompiledComponent): string {
	let n = 1;
	while (component.segments[`Custom${n}`]) n++;
	return `Custom${n}`;
}

interface Row {
	key: string;
	label: string;
	options: string[];
	kind: "existing" | "new";
	elementIndex?: number;
	draftEl?: DraftElement;
}

function getRows(component: CompiledComponent, draft: Draft): Row[] {
	const rows: Row[] = [];
	for (const el of component.elements) {
		if (!el.isVisual) continue;
		rows.push({
			key: `existing:${el.index}`,
			label: `[${el.index}] ${el.templateName}`,
			options: Object.keys(el.states).length ? Object.keys(el.states) : DEFAULT_STATE_OPTIONS,
			kind: "existing",
			elementIndex: el.index,
		});
	}
	for (const de of draft.newElements) {
		rows.push({
			key: `new:${de.tempId}`,
			label: `[new] (${de.x},${de.y},${de.z})`,
			options: DEFAULT_STATE_OPTIONS,
			kind: "new",
			draftEl: de,
		});
	}
	return rows;
}

function ensureGridRow(draft: Draft, row: Row) {
	if (!draft.grid[row.key]) draft.grid[row.key] = [];
	while (draft.grid[row.key].length < draft.frameCount) draft.grid[row.key].push("OFF");
	if (draft.grid[row.key].length > draft.frameCount) draft.grid[row.key].length = draft.frameCount;
}

export function renderPatternEditor(el: HTMLElement, component: CompiledComponent, onUpdate: (updated: CompiledComponent) => void) {
	const draft = getDraft(component);

	function rerender() {
		renderPatternEditor(el, component, onUpdate);
	}

	const rows = getRows(component, draft);
	for (const row of rows) ensureGridRow(draft, row);

	el.innerHTML = "";

	const addElWrap = document.createElement("div");
	addElWrap.innerHTML = `<div class="hint">Design a custom flash pattern for this lightbar. Existing elements are listed below;
    you can also add brand-new light elements (useful when building a lightbar from scratch).</div>`;
	el.appendChild(addElWrap);

	// New elements can always be added -- both to a from-scratch lightbar and
	// alongside an existing one's elements.
	const addBox = document.createElement("div");
	addBox.className = "row wrap";
	addBox.style.marginBottom = "10px";
	addBox.innerHTML = `
      <button id="add-element-btn">+ Add light element</button>
    `;
	el.appendChild(addBox);
	addBox.querySelector("#add-element-btn")!.addEventListener("click", () => {
		draft.newElements.push({ tempId: tempIdCounter++, x: 0, y: draft.newElements.length * 10, z: 5, yaw: 0, width: 4, height: 4 });
		rerender();
	});

	if (draft.newElements.length) {
		const list = document.createElement("div");
		list.style.marginBottom = "10px";
		for (const de of draft.newElements) {
			const row = document.createElement("div");
			row.className = "row wrap";
			row.style.marginBottom = "4px";
			row.innerHTML = `
        <span style="font-size:11px;color:var(--text-dim);width:50px;">new #${de.tempId}</span>
        ${numInput("x", de.x)} ${numInput("y", de.y)} ${numInput("z", de.z)} ${numInput("yaw", de.yaw)}
        ${numInput("width", de.width)} ${numInput("height", de.height)}
        <button data-remove="${de.tempId}" class="subtle">&times;</button>
      `;
			list.appendChild(row);
			row.querySelectorAll<HTMLInputElement>("input[data-field]").forEach((input) => {
				input.addEventListener("change", () => {
					const field = input.dataset.field as keyof DraftElement;
					(de as any)[field] = parseFloat(input.value) || 0;
				});
			});
			row.querySelector("[data-remove]")!.addEventListener("click", () => {
				draft.newElements = draft.newElements.filter((x) => x.tempId !== de.tempId);
				delete draft.grid[`new:${de.tempId}`];
				rerender();
			});
		}
		el.appendChild(list);
	}

	// ===== Segment config =====
	const cfg = document.createElement("div");
	cfg.className = "row wrap";
	cfg.style.marginBottom = "8px";
	cfg.innerHTML = `
    <div class="field-row" style="min-width:140px;">
      <label>Segment name</label>
      <input type="text" id="seg-name" value="${escapeAttr(draft.segmentName)}" />
    </div>
    <div class="field-row" style="width:90px;">
      <label>Frames</label>
      <input type="number" id="frame-count" min="1" max="16" value="${draft.frameCount}" />
    </div>
    <div class="field-row" style="width:110px;">
      <label>Frame duration (s)</label>
      <input type="number" id="frame-duration" step="0.001" value="${draft.frameDuration}" />
    </div>
    <div class="field-row" style="width:110px;">
      <label>Idle state (Off)</label>
      <select id="off-state">
        <option value="OFF" ${draft.off === "OFF" ? "selected" : ""}>OFF</option>
        <option value="~OFF" ${draft.off === "~OFF" ? "selected" : ""}>~OFF (fade)</option>
        <option value="PASS" ${draft.off === "PASS" ? "selected" : ""}>PASS (defer)</option>
      </select>
    </div>
  `;
	el.appendChild(cfg);
	(cfg.querySelector("#seg-name") as HTMLInputElement).addEventListener("change", (e) => {
		draft.segmentName = (e.target as HTMLInputElement).value.trim() || draft.segmentName;
	});
	(cfg.querySelector("#frame-count") as HTMLInputElement).addEventListener("change", (e) => {
		const v = Math.max(1, Math.min(32, parseInt((e.target as HTMLInputElement).value) || 1));
		draft.frameCount = v;
		draft.sequenceSteps = Array.from({ length: v }, (_, i) => i + 1).join(",");
		rerender();
	});
	(cfg.querySelector("#frame-duration") as HTMLInputElement).addEventListener("change", (e) => {
		draft.frameDuration = parseFloat((e.target as HTMLInputElement).value) || 1 / 24;
	});
	(cfg.querySelector("#off-state") as HTMLSelectElement).addEventListener("change", (e) => {
		draft.off = (e.target as HTMLSelectElement).value as Draft["off"];
	});

	// ===== Grid =====
	if (rows.length === 0) {
		el.appendChild(makeEl("div", "empty-state", "Add at least one light element to build a pattern."));
	} else {
		const gridWrap = document.createElement("div");
		gridWrap.className = "grid-editor";
		const table = document.createElement("table");
		const thead = document.createElement("tr");
		thead.appendChild(makeEl("th", "", "Element"));
		for (let f = 1; f <= draft.frameCount; f++) thead.appendChild(makeEl("th", "", `F${f}`));
		table.appendChild(thead);

		for (const row of rows) {
			const tr = document.createElement("tr");
			const labelTd = document.createElement("td");
			labelTd.className = "el-label";
			labelTd.textContent = row.label;
			tr.appendChild(labelTd);
			for (let f = 0; f < draft.frameCount; f++) {
				const td = document.createElement("td");
				const state = draft.grid[row.key][f];
				const cell = document.createElement("div");
				cell.className = "grid-cell";
				cell.textContent = state;
				cell.style.background = cellColor(state);
				cell.title = `Click to cycle state (${row.options.join(", ")})`;
				cell.addEventListener("click", () => {
					const idx = row.options.indexOf(draft.grid[row.key][f]);
					draft.grid[row.key][f] = row.options[(idx + 1) % row.options.length];
					rerender();
				});
				td.appendChild(cell);
				tr.appendChild(td);
			}
			table.appendChild(tr);
		}
		gridWrap.appendChild(table);
		el.appendChild(gridWrap);
	}

	// ===== Sequence steps =====
	const seqRow = document.createElement("div");
	seqRow.className = "field-row";
	seqRow.innerHTML = `
    <label>Sequence step order (frame numbers, comma-separated; 0 = off) &mdash; controls flash timing/repeats</label>
    <input type="text" id="seq-steps" value="${escapeAttr(draft.sequenceSteps)}" />
  `;
	el.appendChild(seqRow);
	(seqRow.querySelector("#seq-steps") as HTMLInputElement).addEventListener("change", (e) => {
		draft.sequenceSteps = (e.target as HTMLInputElement).value;
	});

	// ===== Input assignment =====
	const assignRow = document.createElement("div");
	assignRow.className = "row wrap";
	assignRow.style.margin = "10px 0";
	const channelOptions = [...Object.keys(STANDARD_CHANNELS), "custom"]
		.map((c) => `<option value="${c}" ${draft.channel === c ? "selected" : ""}>${c}</option>`)
		.join("");
	assignRow.innerHTML = `
    <div class="field-row">
      <label>Activate on channel</label>
      <select id="channel-select">${channelOptions}</select>
    </div>
    <div class="field-row" id="mode-field">
      <label>Mode</label>
      ${draft.channel === "custom" ? `<input type="text" id="custom-channel" placeholder="Emergency.Custom" value="${escapeAttr(draft.customChannel)}" />` : `<select id="mode-select"></select>`}
    </div>
  `;
	el.appendChild(assignRow);

	function fillModeSelect() {
		const sel = assignRow.querySelector("#mode-select") as HTMLSelectElement | null;
		if (!sel) return;
		const modes = STANDARD_CHANNELS[draft.channel] || [];
		sel.innerHTML = modes.map((m) => `<option value="${m}" ${draft.mode === m ? "selected" : ""}>${m}</option>`).join("");
		if (!modes.includes(draft.mode)) draft.mode = modes[0] || "ON";
	}
	fillModeSelect();

	(assignRow.querySelector("#channel-select") as HTMLSelectElement).addEventListener("change", (e) => {
		draft.channel = (e.target as HTMLSelectElement).value;
		rerender();
	});
	const customChannelInput = assignRow.querySelector("#custom-channel") as HTMLInputElement | null;
	customChannelInput?.addEventListener("change", (e) => (draft.customChannel = (e.target as HTMLInputElement).value.trim()));
	const modeSelect = assignRow.querySelector("#mode-select") as HTMLSelectElement | null;
	modeSelect?.addEventListener("change", (e) => (draft.mode = (e.target as HTMLSelectElement).value));

	if (draft.channel === "custom") {
		const modeField = assignRow.querySelector("#mode-field")!;
		const modeInput = document.createElement("input");
		modeInput.type = "text";
		modeInput.placeholder = "ON";
		modeInput.value = draft.customMode;
		modeInput.addEventListener("change", () => (draft.customMode = modeInput.value.trim()));
		modeField.appendChild(modeInput);
	}

	// ===== Commit =====
	const commitRow = document.createElement("div");
	commitRow.className = "row";
	commitRow.innerHTML = `<button class="primary" id="commit-btn">Add pattern to lightbar</button>`;
	el.appendChild(commitRow);
	commitRow.querySelector("#commit-btn")!.addEventListener("click", () => {
		try {
			const updated = commitDraft(component, draft, rows);
			delete draftStore[component.id];
			onUpdate(updated);
		} catch (e) {
			alert((e as Error).message);
		}
	});

	// ===== Existing custom segments (session) =====
	const existingCustom = Object.keys(component.segments).filter((n) => /^Custom\d+$/.test(n));
	if (existingCustom.length) {
		const list = document.createElement("div");
		list.style.marginTop = "14px";
		list.appendChild(makeEl("div", "label", "Segments added this session"));
		for (const name of existingCustom) {
			const item = document.createElement("div");
			item.className = "hint";
			item.textContent = `• ${name}`;
			list.appendChild(item);
		}
		el.appendChild(list);
	}
}

function commitDraft(component: CompiledComponent, draft: Draft, rows: Row[]): CompiledComponent {
	const raw: RawComponent = deepClone(component.raw);
	raw.Templates = raw.Templates || {};
	(raw.Templates as any)["2D"] = (raw.Templates as any)["2D"] || {};
	if (draft.newElements.length && !(raw.Templates as any)["2D"].Generic) {
		(raw.Templates as any)["2D"].Generic = {
			Width: 4,
			Height: 4,
			Scale: 1,
			Detail: "photon/common/blank",
			Shape: "photon/common/blank",
		};
	}

	const rawAny = raw as any;
	rawAny.Elements = rawAny.Elements || [];
	const elementsArr = rawAny.Elements as unknown[];
	const newIndexByTempId: Record<number, number> = {};
	for (const de of draft.newElements) {
		// Positional slots: [template, Vector, Angle]. Width/Height are added
		// below as named overrides, but only when they differ from the Generic
		// template default (4x4).
		const entry = ["Generic", { __kind: "Vector", x: de.x, y: de.y, z: de.z }, { __kind: "Angle", p: 0, y: de.yaw, r: 0 }] as any;
		if (de.width !== 4) entry.Width = de.width;
		if (de.height !== 4) entry.Height = de.height;
		elementsArr.push(entry);
		newIndexByTempId[de.tempId] = elementsArr.length;
	}

	const rowIndex = (row: Row): number => (row.kind === "existing" ? row.elementIndex! : newIndexByTempId[row.draftEl!.tempId]);

	const frameStrings: Record<string, string> = {};
	for (let f = 0; f < draft.frameCount; f++) {
		const byState: Record<string, number[]> = {};
		for (const row of rows) {
			const state = draft.grid[row.key][f] || "OFF";
			const idx = rowIndex(row);
			(byState[state] ||= []).push(idx);
		}
		const parts = Object.entries(byState).map(([state, idxs]) => `[${state}] ${idxs.join(" ")}`);
		frameStrings[String(f + 1)] = parts.join(" ");
	}

	const segName = draft.segmentName.trim() || nextSegmentName(component);
	const steps = draft.sequenceSteps
		.split(",")
		.map((s) => parseInt(s.trim(), 10))
		.filter((n) => !Number.isNaN(n));
	const sequenceName = "PATTERN";

	raw.Segments = raw.Segments || {};
	(raw.Segments as any)[segName] = {
		Off: draft.off === "OFF" ? undefined : draft.off,
		FrameDuration: draft.frameDuration,
		Frames: frameStrings,
		Sequences: { [sequenceName]: steps.length ? steps : [1] },
	};

	const channel = draft.channel === "custom" ? draft.customChannel || "Emergency.Custom" : draft.channel;
	const mode = draft.channel === "custom" ? draft.customMode || "ON" : draft.mode;

	raw.Inputs = raw.Inputs || {};
	(raw.Inputs as any)[channel] = (raw.Inputs as any)[channel] || {};
	(raw.Inputs as any)[channel][mode] = (raw.Inputs as any)[channel][mode] || {};
	(raw.Inputs as any)[channel][mode][segName] = sequenceName;

	if (draft.channel === "custom") {
		raw.InputPriorities = raw.InputPriorities || {};
		if (!(raw.InputPriorities as any)[channel]) (raw.InputPriorities as any)[channel] = 45;
	}

	return compileComponent(raw, {
		id: component.id,
		defaultLightStatesByGroup: getDefaultLightStatesByGroup(),
		resolveBase: (name) => resolveRawComponent(name),
	});
}

function numInput(field: string, value: number): string {
	return `<input type="number" data-field="${field}" value="${value}" style="width:60px;" title="${field}" />`;
}

function makeEl(tag: string, className: string, html: string): HTMLElement {
	const e = document.createElement(tag);
	if (className) e.className = className;
	e.innerHTML = html;
	return e;
}

function escapeAttr(s: string): string {
	// Full entity escape (not just `"`) so a draft field value cannot break
	// out of the attribute or inject markup, regardless of quoting context.
	return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const CELL_COLORS: Record<string, string> = {
	OFF: "#1c1e22",
	"~OFF": "#26282d",
	R: "#a11",
	B: "#137",
	G: "#173",
	A: "#a60",
	W: "#888",
	SW: "#997",
	HR: "#c33",
};

function cellColor(state: string): string {
	return CELL_COLORS[state] || "#444";
}
