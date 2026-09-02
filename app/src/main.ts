import "./polyfills";
import "./style.css";
import { library, compileLibraryComponent, getCategories } from "./data";
import { compileComponent } from "./engine/compiler";
import { getDefaultLightStatesByGroup } from "./lua/loader";
import { ComponentPlayer } from "./engine/player";
import { LightbarRenderer } from "./render/canvas";
import { STANDARD_CHANNELS, type CompiledComponent } from "./engine/types";
import { renderPatternEditor } from "./ui/patternEditor";
import { renderCodeEditor } from "./ui/codeEditor";
import { renderExportPanel } from "./ui/exportPanel";
import { createBlankComponent } from "./engine/blank";

const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="topbar">
    <h1>P2 Lightbar Sim</h1>
    <span class="attribution">Unofficial fan tool &middot; built-in patterns are read from the real
      <a href="https://github.com/photonle/Photon-v2" target="_blank" rel="noopener">Photon 2</a> component library (MIT) &middot; not affiliated with Photon Lighting Group</span>
  </div>
  <div class="layout">
    <div class="panel" id="library-panel">
      <div class="library-search">
        <input type="text" id="search" placeholder="Search lightbars..." />
        <div class="row wrap" id="category-filters" style="margin-top:8px;gap:4px;"></div>
      </div>
      <div class="library-list" id="library-list"></div>
      <div style="padding:8px;border-top:1px solid var(--border);">
        <button id="new-custom-btn" style="width:100%;">+ New Custom Lightbar</button>
      </div>
    </div>
    <div class="panel viewer" id="viewer-panel" style="border-right:1px solid var(--border);">
      <div class="viewer-header">
        <h2 id="viewer-title">Select a lightbar</h2>
        <div class="meta" id="viewer-meta"></div>
      </div>
      <div class="viewer-canvas-wrap"><canvas id="canvas"></canvas></div>
      <div class="viewer-toolbar">
        <button id="play-pause">Pause</button>
        <button id="reset-dash">Reset dashboard</button>
        <span class="spacer"></span>
        <span id="fps-label" style="font-size:11px;color:var(--text-dim);"></span>
      </div>
      <div class="warnings" id="warnings" style="display:none;"></div>
    </div>
    <div class="panel" id="inspector-panel">
      <div class="tabs">
        <button class="tab-btn active" data-tab="dashboard">Dashboard</button>
        <button class="tab-btn" data-tab="segments">Segments</button>
        <button class="tab-btn" data-tab="pattern">Pattern Editor</button>
        <button class="tab-btn" data-tab="code">Code Editor</button>
        <button class="tab-btn" data-tab="export">Export</button>
      </div>
      <div class="tab-content" id="tab-content"></div>
    </div>
  </div>
`;

// ===== State =====
let current: CompiledComponent | null = null;
let player: ComponentPlayer | null = null;
let renderer: LightbarRenderer | null = null;
let playing = true;
let activeTab: "dashboard" | "segments" | "pattern" | "code" | "export" = "dashboard";
let searchQuery = "";
let activeCategory: string | null = null;
const expandedFiles = new Set<string>();
// The render loop repaints only when something can have visibly changed: it
// advances (and redraws) every frame while playing, and otherwise only after
// an explicit invalidate() -- a new component, a dashboard/segment change, or
// a resize. A paused, settled canvas costs nothing per frame.
let needsRender = true;
function invalidate() {
	needsRender = true;
}

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
renderer = new LightbarRenderer(canvas);

// ===== Library list =====
function renderCategoryFilters() {
	const el = document.getElementById("category-filters")!;
	const cats = getCategories();
	el.innerHTML = "";
	const mkBtn = (label: string, cat: string | null) => {
		const b = document.createElement("button");
		b.textContent = label;
		b.style.fontSize = "10.5px";
		b.style.padding = "3px 8px";
		if (activeCategory === cat) b.classList.add("active");
		b.onclick = () => {
			activeCategory = activeCategory === cat ? null : cat;
			renderCategoryFilters();
			renderLibraryList();
		};
		el.appendChild(b);
	};
	mkBtn("All", null);
	for (const c of cats) mkBtn(c, c);
}

function renderLibraryList() {
	const el = document.getElementById("library-list")!;
	el.innerHTML = "";
	const q = searchQuery.trim().toLowerCase();
	const hit = (s: string) => s.toLowerCase().includes(q);
	const items = library.filter((e) => {
		if (activeCategory && e.category !== activeCategory) return false;
		if (!q) return true;
		return hit(e.title) || hit(e.id) || e.variants.some((v) => hit(v.title) || hit(v.id));
	});
	// entry/variant title/category/base are parsed straight out of component
	// Lua source -- build every row with textContent so a crafted string
	// can't inject markup into the library list.
	for (const entry of items) {
		const hasVariants = entry.variants.length > 0;
		const searchExpands = q.length > 0 && hasVariants && !hit(entry.title) && !hit(entry.id);
		const expanded = hasVariants && (expandedFiles.has(entry.id) || searchExpands);

		const div = document.createElement("div");
		div.className = "library-item" + (current?.id === entry.id ? " active" : "");
		const titleRow = document.createElement("div");
		titleRow.className = "lib-title-row";
		if (hasVariants) {
			const chevron = document.createElement("span");
			chevron.className = "lib-chevron";
			chevron.textContent = expanded ? "▾" : "▸";
			chevron.title = `${entry.variants.length + 1} variants`;
			chevron.onclick = (ev) => {
				ev.stopPropagation();
				if (expandedFiles.has(entry.id)) expandedFiles.delete(entry.id);
				else expandedFiles.add(entry.id);
				renderLibraryList();
			};
			titleRow.appendChild(chevron);
		}
		const titleDiv = document.createElement("div");
		titleDiv.textContent = hasVariants ? `${entry.title}  (${entry.variants.length + 1})` : entry.title;
		titleRow.appendChild(titleDiv);
		const catDiv = document.createElement("div");
		catDiv.className = "cat";
		catDiv.textContent = entry.base ? `${entry.category} · inherits ${entry.base}` : entry.category;
		div.append(titleRow, catDiv);
		div.onclick = () => selectLibraryComponent(entry.id);
		el.appendChild(div);

		if (!expanded) continue;
		const variants = searchExpands ? entry.variants.filter((v) => hit(v.title) || hit(v.id)) : entry.variants;
		for (const v of variants) {
			const vdiv = document.createElement("div");
			vdiv.className = "library-item variant" + (current?.id === v.id ? " active" : "");
			const vt = document.createElement("div");
			vt.textContent = v.title;
			vdiv.appendChild(vt);
			if (v.base) {
				const vc = document.createElement("div");
				vc.className = "cat";
				vc.textContent = `inherits ${v.base}`;
				vdiv.appendChild(vc);
			}
			vdiv.onclick = () => selectLibraryComponent(v.id);
			el.appendChild(vdiv);
		}
	}
	if (items.length === 0) {
		el.innerHTML = `<div class="empty-state">No matches</div>`;
	}
}

function selectLibraryComponent(id: string) {
	try {
		const compiled = compileLibraryComponent(id);
		setComponent(compiled);
	} catch (e) {
		alert(`Failed to load "${id}":\n${(e as Error).message}`);
		console.error(e);
	}
}

export function setComponent(compiled: CompiledComponent) {
	current = compiled;
	player = new ComponentPlayer(compiled);
	renderer!.setComponent(compiled);

	document.getElementById("viewer-title")!.textContent = compiled.title;
	const metaParts = [compiled.category];
	if (compiled.author) metaParts.push(`by ${compiled.author}`);
	metaParts.push(`${compiled.elements.length} elements`, `${Object.keys(compiled.segments).length} segments`);
	document.getElementById("viewer-meta")!.textContent = metaParts.join(" · ");

	const warnEl = document.getElementById("warnings")!;
	if (compiled.warnings.length) {
		warnEl.style.display = "block";
		warnEl.innerHTML = compiled.warnings.map((w) => `&#9888; ${escapeHtml(w)}`).join("<br/>");
	} else {
		warnEl.style.display = "none";
	}

	renderLibraryList();
	renderTab();
}

function escapeHtml(s: string): string {
	const d = document.createElement("div");
	d.textContent = s;
	return d.innerHTML;
}

document.getElementById("search")!.addEventListener("input", (e) => {
	searchQuery = (e.target as HTMLInputElement).value;
	renderLibraryList();
});

document.getElementById("new-custom-btn")!.addEventListener("click", () => {
	const blank = createBlankComponent();
	const compiled = compileComponent(blank, { id: "custom", defaultLightStatesByGroup: getDefaultLightStatesByGroup() });
	setComponent(compiled);
	setTab("pattern");
});

renderCategoryFilters();
renderLibraryList();

// ===== Tabs =====
document.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((btn) => {
	btn.addEventListener("click", () => setTab(btn.dataset.tab as typeof activeTab));
});

function setTab(tab: typeof activeTab) {
	activeTab = tab;
	document.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
	renderTab();
}

function renderTab() {
	// Any interaction that re-renders the inspector (mode toggles, segment
	// forcing, component swaps) can change what the canvas should show.
	invalidate();
	const el = document.getElementById("tab-content")!;
	el.innerHTML = "";
	if (!current || !player) {
		el.innerHTML = `<div class="empty-state">Select or create a lightbar to begin.</div>`;
		return;
	}
	if (activeTab === "dashboard") renderDashboard(el);
	else if (activeTab === "segments") renderSegments(el);
	else if (activeTab === "pattern")
		renderPatternEditor(el, current, (updated) => {
			setComponent(updated);
			setTab("pattern");
		});
	else if (activeTab === "code")
		renderCodeEditor(el, current, (updated) => {
			setComponent(updated);
			setTab("code");
		});
	else if (activeTab === "export") renderExportPanel(el, current);
}

function channelDrivesVirtualOutput(channel: string): boolean {
	return Object.values(current!.virtualOutputs).some((modes) => modes.some((m) => channel in m.conditions));
}

function renderDashboard(el: HTMLElement) {
	for (const [channel, modes] of Object.entries(STANDARD_CHANNELS)) {
		const group = document.createElement("div");
		group.className = "channel-group";
		const supported = modes.filter((m) => current!.inputs[channel]?.[m]);
		const indirect = channelDrivesVirtualOutput(channel);
		const label = document.createElement("div");
		label.className = "label";
		label.textContent = channel + (supported.length === 0 ? (indirect ? " (drives other channels)" : " (unused)") : "");
		group.appendChild(label);

		const row = document.createElement("div");
		row.className = "mode-buttons";
		for (const mode of modes) {
			const btn = document.createElement("button");
			btn.textContent = mode;
			const isActive = player!.getMode(channel) === mode;
			btn.classList.toggle("active", isActive);
			if (!current!.inputs[channel]?.[mode] && !indirect) btn.style.opacity = "0.35";
			btn.onclick = () => {
				player!.setMode(channel, isActive ? null : mode);
				renderTab();
			};
			row.appendChild(btn);
		}
		group.appendChild(row);
		el.appendChild(group);
	}

	const virtualChannels = Object.keys(current!.virtualOutputs);
	if (virtualChannels.length > 0) {
		const group = document.createElement("div");
		group.className = "channel-group";
		group.innerHTML = `<div class="label">Derived (virtual) channels</div>`;
		for (const channel of virtualChannels) {
			const mode = player!.getMode(channel);
			const row = document.createElement("div");
			row.style.fontSize = "12px";
			row.style.marginBottom = "3px";
			// channel and mode originate from COMPONENT.VirtualOutputs -- set as
			// text, not interpolated HTML.
			const span = document.createElement("span");
			span.style.color = mode ? "var(--good)" : "var(--text-dim)";
			span.textContent = mode ? `▶ ${channel} → ${mode}` : `${channel}: inactive`;
			row.appendChild(span);
			group.appendChild(row);
		}
		el.appendChild(group);
	}
}

function renderSegments(el: HTMLElement) {
	const info = player!.getActiveSegmentInfo();
	for (const seg of Object.values(current!.segments)) {
		const row = document.createElement("div");
		row.className = "segment-row";
		const active = info[seg.name];
		// seg.name, and the channel/mode/sequence names in `active`, all come
		// from user-editable component data (Code Editor, Pattern Editor) --
		// build these nodes with textContent so none of it is parsed as HTML.
		const nameDiv = document.createElement("div");
		nameDiv.className = "name";
		nameDiv.textContent = seg.name;
		const detailDiv = document.createElement("div");
		detailDiv.className = active ? "active-seq" : "idle";
		detailDiv.textContent = active
			? `▶ ${active.channel}${active.mode ? ":" + active.mode : ""} → ${active.sequence}`
			: "idle" + (seg.off === "PASS" ? " (pass-through)" : "");
		row.append(nameDiv, detailDiv);
		const chipRow = document.createElement("div");
		chipRow.className = "seq-chip-row";
		for (const seqName of Object.keys(seg.sequences)) {
			const chip = document.createElement("span");
			chip.className = "seq-chip" + (player!.isForced(seg.name) && active?.sequence === seqName ? " playing" : "");
			chip.textContent = seqName;
			chip.title = "Click to preview this sequence in isolation";
			chip.onclick = () => {
				const isForced = player!.isForced(seg.name) && active?.sequence === seqName;
				player!.forceSequence(seg.name, isForced ? null : seqName);
				renderTab();
			};
			chipRow.appendChild(chip);
		}
		row.appendChild(chipRow);
		el.appendChild(row);
	}
}

// ===== Controls =====
document.getElementById("play-pause")!.addEventListener("click", (e) => {
	playing = !playing;
	(e.target as HTMLButtonElement).textContent = playing ? "Pause" : "Play";
	invalidate(); // repaint the final settled frame on pause / pick straight back up on resume
});
document.getElementById("reset-dash")!.addEventListener("click", () => {
	player?.reset();
	renderTab();
});

window.addEventListener("resize", () => {
	renderer?.resize();
	invalidate();
});

// ===== Animation loop =====
let lastT = performance.now();
let frameCount = 0;
let fpsAccum = 0;
function loop(t: number) {
	const dt = Math.min(100, t - lastT);
	lastT = t;
	fpsAccum += dt;
	frameCount++;
	if (fpsAccum > 500) {
		document.getElementById("fps-label")!.textContent = `${(1000 / (fpsAccum / frameCount)).toFixed(0)} fps`;
		fpsAccum = 0;
		frameCount = 0;
	}
	if (player && renderer && (playing || needsRender)) {
		if (playing) player.advance(dt);
		const states = player.getElementStates();
		renderer.draw(states);
		needsRender = false;
	}
	requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
