import type { CompiledComponent, ResolvedState } from "../engine/types";

interface Projected {
	index: number;
	sx: number;
	sy: number;
	radius: number;
}

export class LightbarRenderer {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private projected: Projected[] = [];
	private component: CompiledComponent | null = null;

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("2D canvas context unavailable");
		this.ctx = ctx;
	}

	setComponent(component: CompiledComponent) {
		this.component = component;
		this.layout();
	}

	resize() {
		this.layout();
	}

	private layout() {
		if (!this.component) return;
		const { width, height } = this.canvas.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		this.canvas.width = Math.max(1, Math.floor(width * dpr));
		this.canvas.height = Math.max(1, Math.floor(height * dpr));
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		const visual = this.component.elements.filter((e) => e.isVisual);
		if (visual.length === 0) {
			this.projected = [];
			return;
		}
		const xs = visual.map((e) => e.position.x);
		const ys = visual.map((e) => e.position.y);
		const minX = Math.min(...xs);
		const maxX = Math.max(...xs);
		const minY = Math.min(...ys);
		const maxY = Math.max(...ys);
		const spanX = Math.max(1, maxX - minX);
		const spanY = Math.max(1, maxY - minY);

		const pad = 40;
		const availW = Math.max(1, width - pad * 2);
		const availH = Math.max(1, height - pad * 2);
		const scale = Math.min(availW / spanY, availH / spanX, 40);

		const offsetX = width / 2 - ((minY + maxY) / 2) * scale;
		const offsetY = height / 2 - ((minX + maxX) / 2) * scale;

		this.projected = visual.map((e) => {
			const w = (e.props.Width as number) ?? 4;
			const h = (e.props.Height as number) ?? 4;
			const sc = (e.props.Scale as number) ?? 1;
			const radius = Math.max(6, ((w + h) / 2) * sc * (scale / 3.2));
			return {
				index: e.index,
				sx: offsetX + e.position.y * scale,
				sy: offsetY + e.position.x * scale,
				radius,
			};
		});
	}

	draw(states: Record<number, ResolvedState>) {
		const { ctx, canvas } = this;
		const { width, height } = canvas.getBoundingClientRect();
		ctx.save();
		ctx.clearRect(0, 0, width, height);

		// Bezel background
		ctx.fillStyle = "#0a0b0d";
		ctx.fillRect(0, 0, width, height);

		if (this.projected.length === 0) {
			ctx.fillStyle = "#666";
			ctx.font = "14px system-ui, sans-serif";
			ctx.fillText("No visual (2D) elements to render", 16, 24);
			ctx.restore();
			return;
		}

		// housing outline
		const xs = this.projected.map((p) => p.sx);
		const ys = this.projected.map((p) => p.sy);
		const minX = Math.min(...xs) - 24;
		const maxX = Math.max(...xs) + 24;
		const minY = Math.min(...ys) - 24;
		const maxY = Math.max(...ys) + 24;
		ctx.fillStyle = "#141517";
		ctx.strokeStyle = "#2a2c30";
		ctx.lineWidth = 2;
		roundRect(ctx, minX, minY, maxX - minX, maxY - minY, 14);
		ctx.fill();
		ctx.stroke();

		ctx.globalCompositeOperation = "lighter";
		for (const p of this.projected) {
			const state = states[p.index];
			if (!state || state.intensity <= 0.001) continue;
			if (state.rotationAngle !== undefined) {
				drawRotatingBeamLight(ctx, p.sx, p.sy, p.radius, state, state.rotationAngle);
			} else {
				drawGlowLight(ctx, p.sx, p.sy, p.radius, state);
			}
		}
		ctx.globalCompositeOperation = "source-over";

		// Dim lens dots for off elements, for spatial reference
		for (const p of this.projected) {
			const state = states[p.index];
			if (state && state.intensity > 0.001) continue;
			ctx.beginPath();
			ctx.fillStyle = "#2c2e33";
			ctx.arc(p.sx, p.sy, Math.max(3, p.radius * 0.35), 0, Math.PI * 2);
			ctx.fill();
		}

		ctx.restore();
	}
}

function drawGlowLight(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, state: ResolvedState) {
	const { r, g, b } = state.color;
	const alpha = Math.max(0, Math.min(1, state.intensity));

	const outerR = radius * 2.2;
	const grad = ctx.createRadialGradient(x, y, 0, x, y, outerR);
	grad.addColorStop(0, `rgba(${r},${g},${b},${0.9 * alpha})`);
	grad.addColorStop(0.4, `rgba(${r},${g},${b},${0.45 * alpha})`);
	grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
	ctx.fillStyle = grad;
	ctx.beginPath();
	ctx.arc(x, y, outerR, 0, Math.PI * 2);
	ctx.fill();

	ctx.beginPath();
	ctx.fillStyle = `rgba(255,255,255,${0.85 * alpha})`;
	ctx.arc(x, y, Math.max(2, radius * 0.28), 0, Math.PI * 2);
	ctx.fill();

	ctx.beginPath();
	ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
	ctx.arc(x, y, Math.max(3, radius * 0.55), 0, Math.PI * 2);
	ctx.fill();
}

/** A rotating beacon (a Bone-proxy-driven element -- see
 * ResolvedState.rotationAngle): a bright emitter core with a projected
 * cone/beam of light sweeping out from it in the bone's current direction,
 * plus a faint omnidirectional pool so the beacon still reads as "on" from
 * any side. The beam is a few stacked wedges -- wide and faint through
 * narrow and bright -- to fake angular falloff, each filled with a radial
 * gradient for distance falloff. Drawn under "lighter" compositing so
 * overlapping beams and glows add. */
function drawRotatingBeamLight(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, state: ResolvedState, angleDegrees: number) {
	const { r, g, b } = state.color;
	const alpha = Math.max(0, Math.min(1, state.intensity));
	const rad = (angleDegrees * Math.PI) / 180;

	// Faint omnidirectional pool so the beacon still reads as "on" from any
	// side (lens scatter / bounce), kept small so the beam dominates.
	const poolR = radius * 1.4;
	const pool = ctx.createRadialGradient(x, y, 0, x, y, poolR);
	pool.addColorStop(0, `rgba(${r},${g},${b},${0.35 * alpha})`);
	pool.addColorStop(0.55, `rgba(${r},${g},${b},${0.12 * alpha})`);
	pool.addColorStop(1, `rgba(${r},${g},${b},0)`);
	ctx.fillStyle = pool;
	ctx.beginPath();
	ctx.arc(x, y, poolR, 0, Math.PI * 2);
	ctx.fill();

	// Projected beam: many thin wedges from wide/faint to narrow/bright, so
	// the angular edge feathers instead of stepping. Each wedge also carries
	// a radial gradient for distance falloff -- a long dim tail over a bright
	// near field reads as a real projected cone.
	const beamLen = radius * 12;
	const N = 6;
	const maxHalf = 0.42;
	for (let i = 0; i < N; i++) {
		const t = i / (N - 1); // 0 = outermost/faintest, 1 = centre/brightest
		const half = maxHalf * (1 - t) + 0.04;
		const a = 0.06 + 0.32 * Math.pow(t, 1.7);
		const grad = ctx.createRadialGradient(x, y, radius * 0.55, x, y, beamLen);
		grad.addColorStop(0, `rgba(${r},${g},${b},${a * alpha})`);
		grad.addColorStop(0.3, `rgba(${r},${g},${b},${a * 0.5 * alpha})`);
		grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
		ctx.fillStyle = grad;
		ctx.beginPath();
		ctx.moveTo(x, y);
		ctx.arc(x, y, beamLen, rad - half, rad + half);
		ctx.closePath();
		ctx.fill();
	}

	// Compact emitter core with a soft halo so it doesn't read as a hard disc.
	const haloR = radius * 0.9;
	const halo = ctx.createRadialGradient(x, y, radius * 0.2, x, y, haloR);
	halo.addColorStop(0, `rgba(${r},${g},${b},${0.9 * alpha})`);
	halo.addColorStop(1, `rgba(${r},${g},${b},0)`);
	ctx.fillStyle = halo;
	ctx.beginPath();
	ctx.arc(x, y, haloR, 0, Math.PI * 2);
	ctx.fill();
	ctx.beginPath();
	ctx.fillStyle = `rgba(255,255,255,${0.95 * alpha})`;
	ctx.arc(x, y, Math.max(1.5, radius * 0.18), 0, Math.PI * 2);
	ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}
