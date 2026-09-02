import "./polyfills";
import "./style.css";
import { library, compileLibraryComponent, classifyLibrary, getCategoryTags, getSupportedCount, UNSUPPORTED_CATEGORY } from "./data";
import {
	isEnabled as updatesEnabled,
	setEnabled as setUpdatesEnabled,
	loadAcceptedOverlay,
	checkForUpdates,
	applyUpdates,
	lastSyncedAt,
	type CheckResult,
	type RemoteChange,
} from "./data/remote";
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
      <div id="update-bar">
        <label class="upd-toggle"><input type="checkbox" id="upd-enabled" /> Check GitHub for updates</label>
        <button id="upd-check" class="subtle" disabled>Check now</button>
        <div id="upd-status"></div>
      </div>
      <div style="padding:8px;border-top:1px solid var(--border);">
        <button id="new-custom-btn" style="width:100%;">+ New Custom Lightbar</button>
      </div>
    </div>
    <div class="panel viewer" id="viewer-panel" style="border-right:1px solid var(--border);">
      <div class="viewer-header">
        <h2 id="viewer-title">Select a lightbar</h2>
        <div class="meta" id="viewer-meta"></div>
      </div>
      <div class="viewer-canvas-wrap"><canvas id="canvas"></canvas><div id="viewer-message" hidden></div></div>
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
  <div id="upd-modal" hidden>
    <div class="upd-modal-box">
      <h3>Component updates from Photon 2</h3>
      <p class="upd-modal-sub">Fetched from <code>github.com/photonle/Photon-v2</code> (branch <code>main</code>). Nothing is downloaded or loaded until you apply.</p>
      <div id="upd-modal-list"></div>
      <div id="upd-modal-result"></div>
      <div class="upd-modal-actions">
        <button id="upd-apply" class="primary">Apply</button>
        <button id="upd-cancel">Not now</button>
      </div>
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
	el.innerHTML = "";
	const mkBtn = (label: string, count: number, cat: string | null) => {
		const b = document.createElement("button");
		b.style.fontSize = "10.5px";
		b.style.padding = "3px 8px";
		b.append(label);
		const n = document.createElement("span");
		n.className = "tag-count";
		n.textContent = String(count);
		b.append(n);
		if (activeCategory === cat) b.classList.add("active");
		b.onclick = () => {
			activeCategory = activeCategory === cat ? null : cat;
			renderCategoryFilters();
			renderLibraryList();
		};
		el.appendChild(b);
	};
	mkBtn("All", getSupportedCount(), null);
	for (const t of getCategoryTags()) mkBtn(t.name, t.count, t.name);
}

function renderLibraryList() {
	const el = document.getElementById("library-list")!;
	el.innerHTML = "";
	const q = searchQuery.trim().toLowerCase();
	const hit = (s: string) => s.toLowerCase().includes(q);
	const searching = q.length > 0;
	const items = library.filter((e) => {
		if (activeCategory === UNSUPPORTED_CATEGORY) {
			if (!e.unsupported) return false;
		} else {
			// "All" or a real category: components with no 2D view stay hidden
			// unless the user is actively searching for one.
			if (e.unsupported && !searching) return false;
			if (activeCategory && e.category !== activeCategory) return false;
		}
		if (!searching) return true;
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
			const disclosure = document.createElement("span");
			disclosure.className = "lib-disclosure" + (expanded ? " expanded" : "");
			// The arrow is a CSS border triangle (::before) -- no glyph, so it
			// centres cleanly and rotates without font side-bearing drift.
			disclosure.title = `${entry.variants.length + 1} components — click to ${expanded ? "collapse" : "expand"}`;
			disclosure.onclick = (ev) => {
				ev.stopPropagation();
				if (expandedFiles.has(entry.id)) expandedFiles.delete(entry.id);
				else expandedFiles.add(entry.id);
				renderLibraryList();
			};
			titleRow.appendChild(disclosure);
		}
		const titleDiv = document.createElement("div");
		titleDiv.className = "lib-title-text";
		titleDiv.textContent = entry.title;
		titleRow.appendChild(titleDiv);
		if (hasVariants) {
			const count = document.createElement("span");
			count.className = "lib-count";
			count.textContent = String(entry.variants.length + 1);
			count.title = `${entry.variants.length + 1} variants in this file`;
			titleRow.appendChild(count);
		}
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

	// Components that compile to no drawable element -- either because every
	// element is a non-drawn type (Sound/Sub/Sequence/Virtual/...) or because
	// every light element is parented to a bone this viewer doesn't
	// position -- get an explanation instead of a blank canvas.
	const msgEl = document.getElementById("viewer-message")!;
	const els = compiled.elements;
	if (els.length > 0 && !els.some((e) => e.isVisual)) {
		const drawGroups = new Set(["2D", "Mesh", "Projected"]);
		const hasDrawableType = els.some((e) => drawGroups.has(e.templateGroup));
		const otherTypes = [...new Set(els.map((e) => e.templateGroup).filter((g) => g && g !== "Bone" && !drawGroups.has(g)))];
		msgEl.textContent =
			hasDrawableType && otherTypes.length === 0
				? `No 2D representation. Every light on this component is parented to a bone (an aimed, articulated, or rotating mount), and this viewer doesn't track bone positions. The Dashboard, Segments, Code, and Export tabs still work.`
				: `No 2D representation. This component's elements (${[...new Set(els.map((e) => e.templateGroup).filter(Boolean))].join(", ")}) are types the schematic viewer doesn't draw. The Dashboard, Segments, Code, and Export tabs still work.`;
		msgEl.hidden = false;
	} else {
		msgEl.hidden = true;
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

// ===== Component updates (opt-in, off by default) =====
let pendingChanges: RemoteChange[] = [];

function fmtAgo(ts: number | undefined): string {
	if (!ts) return "never";
	const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.round(s / 60)} min ago`;
	if (s < 86400) return `${Math.round(s / 3600)} h ago`;
	return `${Math.round(s / 86400)} d ago`;
}

function renderUpdateStatus(extra?: string) {
	const el = document.getElementById("upd-status")!;
	el.textContent = "";
	el.classList.remove("has-changes");
	if (extra !== undefined) {
		el.textContent = extra;
		return;
	}
	if (!updatesEnabled()) {
		el.textContent = "Using the bundled component snapshot.";
		return;
	}
	if (pendingChanges.length) {
		el.classList.add("has-changes");
		const link = document.createElement("button");
		link.className = "upd-review-link";
		link.textContent = `${pendingChanges.length} update${pendingChanges.length === 1 ? "" : "s"} available — review`;
		link.onclick = openUpdateModal;
		el.append(link);
		return;
	}
	el.textContent = `In sync with Photon 2 · checked ${fmtAgo(lastSyncedAt())}`;
}

function handleCheckResult(res: CheckResult) {
	if (res.status === "changes") {
		pendingChanges = res.changes;
		renderUpdateStatus();
	} else if (res.status === "offline") {
		renderUpdateStatus("Offline — using the bundled snapshot.");
	} else if (res.status === "error") {
		renderUpdateStatus(res.message ?? "Update check failed — using the bundled snapshot.");
	} else if (res.status === "up-to-date") {
		pendingChanges = [];
		renderUpdateStatus();
	}
}

function openUpdateModal() {
	const listEl = document.getElementById("upd-modal-list")!;
	const resultEl = document.getElementById("upd-modal-result")!;
	listEl.textContent = "";
	resultEl.textContent = "";
	(document.getElementById("upd-apply") as HTMLButtonElement).disabled = pendingChanges.length === 0;
	for (const c of pendingChanges) {
		const row = document.createElement("div");
		row.className = "upd-change " + c.kind;
		const tag = document.createElement("span");
		tag.className = "upd-kind";
		tag.textContent = c.kind;
		const label = document.createElement("span");
		// c.title is our local title (safe); c.name is a filename from the
		// GitHub listing -- both set as text, never interpolated into HTML.
		label.textContent = c.title ? `${c.title}` : c.name.replace(/\.lua$/, "");
		const sub = document.createElement("span");
		sub.className = "upd-file";
		sub.textContent = c.name + (c.kind === "added" ? " (new)" : "");
		row.append(tag, label, sub);
		listEl.append(row);
	}
	(document.getElementById("upd-modal") as HTMLElement).hidden = false;
}

function closeUpdateModal() {
	(document.getElementById("upd-modal") as HTMLElement).hidden = true;
}

async function applyPending() {
	const applyBtn = document.getElementById("upd-apply") as HTMLButtonElement;
	applyBtn.disabled = true;
	applyBtn.textContent = "Applying…";
	const res = await applyUpdates(pendingChanges);
	applyBtn.textContent = "Apply";

	// Rebuild everything the overlay touched.
	classifyLibrary();
	renderCategoryFilters();
	renderLibraryList();
	if (current) {
		try {
			setComponent(compileLibraryComponent(current.id));
		} catch {
			/* current component may have been removed upstream */
		}
	}

	const resultEl = document.getElementById("upd-modal-result")!;
	resultEl.textContent = "";
	const ok = document.createElement("div");
	ok.textContent =
		res.applied > 0 ? `Applied ${res.applied} update${res.applied === 1 ? "" : "s"}.` : "Nothing applied.";
	resultEl.append(ok);
	for (const r of res.rejected) {
		const bad = document.createElement("div");
		bad.className = "upd-rejected";
		bad.textContent = `Kept the current ${r.name} — ${r.reason}`;
		resultEl.append(bad);
	}
	pendingChanges = pendingChanges.filter((c) => res.rejected.some((r) => r.name === c.name));
	renderUpdateStatus();
	if (pendingChanges.length === 0) setTimeout(closeUpdateModal, res.rejected.length ? 2500 : 900);
}

document.getElementById("upd-enabled")!.addEventListener("change", (e) => {
	const on = (e.target as HTMLInputElement).checked;
	setUpdatesEnabled(on);
	(document.getElementById("upd-check") as HTMLButtonElement).disabled = !on;
	renderUpdateStatus();
	if (on) runCheck();
});
document.getElementById("upd-check")!.addEventListener("click", () => runCheck());
document.getElementById("upd-apply")!.addEventListener("click", applyPending);
document.getElementById("upd-cancel")!.addEventListener("click", closeUpdateModal);

async function runCheck() {
	const btn = document.getElementById("upd-check") as HTMLButtonElement;
	btn.disabled = true;
	renderUpdateStatus("Checking…");
	try {
		handleCheckResult(await checkForUpdates());
	} finally {
		btn.disabled = !updatesEnabled();
	}
}

// ===== Boot =====
async function boot() {
	(document.getElementById("upd-enabled") as HTMLInputElement).checked = updatesEnabled();
	(document.getElementById("upd-check") as HTMLButtonElement).disabled = !updatesEnabled();

	// Re-apply updates the user accepted in a previous session (from local
	// storage, no network) before the first classify pass.
	try {
		await loadAcceptedOverlay();
	} catch (e) {
		console.warn("could not load accepted component updates:", e);
	}

	// Compile every component once up front so tag counts and the Unsupported
	// filter are accurate from the first paint (also warms the compile cache).
	const t0 = performance.now();
	classifyLibrary();
	console.info(`classified ${library.length} components in ${(performance.now() - t0).toFixed(0)}ms`);

	renderCategoryFilters();
	renderLibraryList();
	renderUpdateStatus();

	if (updatesEnabled()) runCheck();
}
boot();

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
