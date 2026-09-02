// Optional: check upstream Photon 2 on GitHub for component updates.
//
// Trust model (see also docs/upstream-divergences.md): with this enabled the
// app fetches and executes Lua authored outside this repo, and component
// metadata shown in the UI becomes remote-controlled. The Lua runs in the
// fengari sandbox (no io/os/network); the metadata only ever reaches the DOM
// via textContent / escapeHtml() (enforced by scripts/check-html-sinks.mjs).
// The feature is opt-in and off by default, changes are shown for review
// before anything is fetched or loaded, and the bundled snapshot stays the
// cold-start source of truth and the fallback for every failure mode.

import bundledManifest from "./bundledBlobManifest.json";
import { loadComponentsLua } from "../lua/loader";
import { library, overlayRemoteSources } from "./index";

const OWNER = "photonle";
const REPO = "Photon-v2";
const REF = "main"; // track the branch; changes are reviewed before they apply
const DIR = "lua/photon-v2/library/components";
const LIST_URL = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${DIR}?ref=${REF}`;

const LS_ENABLED = "p2sim.updates.enabled";
const LS_STATE = "p2sim.updates.state";
const BLOB_PREFIX = "p2sim.blob:";
const CACHE_NAME = "photon2-remote-v1";

type ShaMap = Record<string, string>;

interface SyncState {
	etag?: string;
	/** Blob sha of every component file we currently have applied (bundled
	 * snapshot overlaid with accepted changes). */
	have: ShaMap;
	/** Last time the local set was confirmed in sync with upstream. */
	syncedAt?: number;
	checkedAt?: number;
}

export interface RemoteChange {
	name: string; // "photon_x.lua"
	kind: "added" | "modified" | "removed";
	/** Current local title -- known for modified/removed, not for added
	 * (that needs a download). */
	title?: string;
	sha?: string;
	downloadUrl?: string;
}

export interface CheckResult {
	status: "disabled" | "up-to-date" | "changes" | "offline" | "error";
	changes: RemoteChange[];
	syncedAt?: number;
	message?: string;
}

export interface ApplyResult {
	applied: number;
	rejected: { name: string; reason: string }[];
}

// ---- enable flag ----------------------------------------------------------

export function isEnabled(): boolean {
	try {
		return localStorage.getItem(LS_ENABLED) === "1";
	} catch {
		return false;
	}
}

export function setEnabled(on: boolean): void {
	try {
		localStorage.setItem(LS_ENABLED, on ? "1" : "0");
	} catch {
		/* private mode / no storage -- feature just won't persist */
	}
}

// ---- state --------------------------------------------------------------

function loadState(): SyncState {
	try {
		const raw = localStorage.getItem(LS_STATE);
		if (raw) {
			const s = JSON.parse(raw) as SyncState;
			if (s && typeof s === "object" && s.have) return s;
		}
	} catch {
		/* fall through */
	}
	return { have: { ...(bundledManifest as ShaMap) } };
}

function saveState(s: SyncState): void {
	try {
		localStorage.setItem(LS_STATE, JSON.stringify(s));
	} catch {
		/* ignore */
	}
}

export function lastSyncedAt(): number | undefined {
	return loadState().syncedAt;
}

// ---- blob store (Cache API, falling back to localStorage) --------------

let cachePromise: Promise<Cache> | null = null;
function openCache(): Promise<Cache> | null {
	if (typeof caches === "undefined") return null;
	if (!cachePromise) cachePromise = caches.open(CACHE_NAME).catch(() => Promise.reject());
	return cachePromise;
}

async function blobGet(name: string): Promise<string | null> {
	const c = openCache();
	if (c) {
		try {
			const res = await (await c).match(BLOB_PREFIX + name);
			if (res) return await res.text();
		} catch {
			/* fall through to localStorage */
		}
	}
	try {
		return localStorage.getItem(BLOB_PREFIX + name);
	} catch {
		return null;
	}
}

async function blobSet(name: string, text: string): Promise<void> {
	const c = openCache();
	if (c) {
		try {
			await (await c).put(BLOB_PREFIX + name, new Response(text, { headers: { "content-type": "text/plain" } }));
			return;
		} catch {
			/* fall through */
		}
	}
	try {
		localStorage.setItem(BLOB_PREFIX + name, text);
	} catch {
		/* ignore -- next launch just re-fetches */
	}
}

async function blobDelete(name: string): Promise<void> {
	const c = openCache();
	if (c) {
		try {
			await (await c).delete(BLOB_PREFIX + name);
		} catch {
			/* ignore */
		}
	}
	try {
		localStorage.removeItem(BLOB_PREFIX + name);
	} catch {
		/* ignore */
	}
}

// ---- startup: re-apply already-accepted updates from cache ------------

/** Overlay any updates the user previously accepted, from local storage. No
 * network. Silently keeps the bundled version for any file whose cached body
 * is missing (e.g. storage was evicted). */
export async function loadAcceptedOverlay(): Promise<void> {
	if (!isEnabled()) return;
	const state = loadState();
	const bundled = bundledManifest as ShaMap;
	const patch: Record<string, string | null> = {};
	let repaired = false;

	for (const name of Object.keys(state.have)) {
		if (state.have[name] === bundled[name]) continue; // unchanged from bundle
		const text = await blobGet(name);
		if (text) patch[name] = text;
		else {
			// cache gone -- fall back to bundle for this file
			if (bundled[name]) state.have[name] = bundled[name];
			else delete state.have[name];
			repaired = true;
		}
	}
	for (const name of Object.keys(bundled)) {
		if (!(name in state.have)) patch[name] = null; // accepted upstream removal
	}

	if (Object.keys(patch).length) overlayRemoteSources(patch);
	if (repaired) saveState(state);
}

// ---- update check ----------------------------------------------------

function titleForFile(name: string): string | undefined {
	const fileId = name.replace(/\.lua$/, "");
	return library.find((e) => e.fileId === fileId)?.title;
}

export async function checkForUpdates(): Promise<CheckResult> {
	if (!isEnabled()) return { status: "disabled", changes: [] };

	const state = loadState();
	let res: Response;
	try {
		res = await fetch(LIST_URL, {
			cache: "no-store",
			headers: {
				Accept: "application/vnd.github+json",
				...(state.etag ? { "If-None-Match": state.etag } : {}),
			},
		});
	} catch {
		return { status: "offline", changes: [], syncedAt: state.syncedAt };
	}

	if (res.status === 304) {
		state.checkedAt = Date.now();
		state.syncedAt = state.syncedAt ?? Date.now();
		saveState(state);
		return { status: "up-to-date", changes: [], syncedAt: state.syncedAt };
	}

	if (!res.ok) {
		const rateLeft = res.headers.get("x-ratelimit-remaining");
		const msg =
			res.status === 403 && rateLeft === "0"
				? "GitHub API rate limit reached (60/hour, unauthenticated). Try again later."
				: `GitHub returned ${res.status}.`;
		return { status: "error", changes: [], message: msg, syncedAt: state.syncedAt };
	}

	let listing: Array<{ name: string; sha: string; type: string; download_url: string | null }>;
	try {
		listing = await res.json();
		if (!Array.isArray(listing)) throw new Error("unexpected listing shape");
	} catch {
		return { status: "error", changes: [], message: "Could not parse the GitHub response.", syncedAt: state.syncedAt };
	}

	const etag = res.headers.get("etag") ?? undefined;
	const remote = new Map<string, { sha: string; downloadUrl: string | null }>();
	for (const f of listing) {
		if (f.type === "file" && f.name.endsWith(".lua")) remote.set(f.name, { sha: f.sha, downloadUrl: f.download_url });
	}

	const have = state.have;
	const changes: RemoteChange[] = [];
	for (const [name, r] of remote) {
		if (!(name in have)) changes.push({ name, kind: "added", sha: r.sha, downloadUrl: r.downloadUrl ?? undefined });
		else if (have[name] !== r.sha)
			changes.push({ name, kind: "modified", title: titleForFile(name), sha: r.sha, downloadUrl: r.downloadUrl ?? undefined });
	}
	for (const name of Object.keys(have)) {
		if (!remote.has(name)) changes.push({ name, kind: "removed", title: titleForFile(name) });
	}

	state.checkedAt = Date.now();
	if (changes.length === 0) {
		// Fully in sync -- store the ETag so the next check is a free 304.
		state.etag = etag;
		state.syncedAt = Date.now();
		saveState(state);
		return { status: "up-to-date", changes: [], syncedAt: state.syncedAt };
	}
	// Changes pending: do NOT advance the ETag, so a re-check keeps seeing
	// them until they're applied (a partial apply must not be masked by a 304).
	saveState(state);
	changes.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
	return { status: "changes", changes, syncedAt: state.syncedAt };
}

// ---- apply -----------------------------------------------------------

/** Fetch and apply an accepted change set. A file that fails to parse/compile
 * is rejected and its previous version kept. */
export async function applyUpdates(changes: RemoteChange[]): Promise<ApplyResult> {
	const state = loadState();
	const patch: Record<string, string | null> = {};
	const rejected: ApplyResult["rejected"] = [];

	for (const c of changes) {
		if (c.kind === "removed") {
			patch[c.name] = null;
			delete state.have[c.name];
			await blobDelete(c.name);
			continue;
		}
		if (!c.downloadUrl || !c.sha) {
			rejected.push({ name: c.name, reason: "no download URL in the listing" });
			continue;
		}
		let text: string;
		try {
			const r = await fetch(c.downloadUrl, { cache: "no-store" });
			if (!r.ok) {
				rejected.push({ name: c.name, reason: `download failed (${r.status})` });
				continue;
			}
			text = await r.text();
		} catch {
			rejected.push({ name: c.name, reason: "download failed (offline)" });
			continue;
		}
		const { components, error } = loadComponentsLua(text);
		if (error || components.length === 0) {
			rejected.push({ name: c.name, reason: error ? `does not parse: ${error}` : "defines no component" });
			continue;
		}
		patch[c.name] = text;
		state.have[c.name] = c.sha;
		await blobSet(c.name, text);
	}

	const applied = Object.keys(patch).length;
	if (applied) overlayRemoteSources(patch);
	state.syncedAt = rejected.length === 0 ? Date.now() : state.syncedAt;
	saveState(state);
	return { applied, rejected };
}

/** Forget every accepted update. Clears stored state and cached bodies; the
 * caller should reload so the library rebuilds from the bundled snapshot. */
export async function resetToBundled(): Promise<void> {
	const state = loadState();
	for (const name of Object.keys(state.have)) {
		if (state.have[name] !== (bundledManifest as ShaMap)[name]) await blobDelete(name);
	}
	const c = openCache();
	if (c) {
		try {
			await caches.delete(CACHE_NAME);
		} catch {
			/* ignore */
		}
	}
	try {
		localStorage.removeItem(LS_STATE);
		for (let i = localStorage.length - 1; i >= 0; i--) {
			const k = localStorage.key(i);
			if (k && k.startsWith(BLOB_PREFIX)) localStorage.removeItem(k);
		}
	} catch {
		/* ignore */
	}
}
