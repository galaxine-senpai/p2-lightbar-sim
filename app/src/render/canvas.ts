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
				drawRotatingCrescentLight(ctx, p.sx, p.sy, p.radius, state, state.rotationAngle);
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

/** A rotating-beacon indicator (a Bone-proxy-driven element -- see
 * ResolvedState.rotationAngle): draws the normal glow, then paints a solid
 * BLACK crescent moon directly onto the lens -- a simplified 2D stand-in
 * for the dark, non-reflecting side of a physical rotating drum/mirror,
 * rather than a subtractive "erase to reveal the background" trick (which
 * only reads as dark by coincidence of the housing color). The crescent's
 * open side rotates to face the bone's current angle, so the light visibly
 * "faces" a direction and spins over time instead of just changing color. */
function drawRotatingCrescentLight(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, state: ResolvedState, angleDegrees: number) {
	drawGlowLight(ctx, x, y, radius, state);

	const rad = (angleDegrees * Math.PI) / 180;
	// Covers just the emitter itself (the solid core circles drawGlowLight
	// paints at ~0.55r) -- NOT the soft ambient bloom (out to ~2.2r), which
	// stays a full, uninterrupted glow around the shadowed lens.
	const bodyRadius = radius * 0.6;
	const cutOffset = bodyRadius * 0.85;
	const cutRadius = bodyRadius * 1.15;
	const cutX = x + Math.cos(rad) * cutOffset;
	const cutY = y + Math.sin(rad) * cutOffset;

	const prevOp = ctx.globalCompositeOperation;
	ctx.globalCompositeOperation = "source-over";
	ctx.beginPath();
	// Two circles wound in OPPOSITE directions in one path: with the
	// nonzero fill rule, their overlap cancels out (winding 0, left
	// unpainted) while the rest of the body circle fills solid -- the
	// standard canvas trick for a crescent/annulus cutout as one fill.
	ctx.arc(x, y, bodyRadius, 0, Math.PI * 2, false);
	ctx.arc(cutX, cutY, cutRadius, 0, Math.PI * 2, true);
	ctx.fillStyle = "#000000";
	ctx.fill();
	ctx.globalCompositeOperation = prevOp;
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
