// Guardrail: component metadata (titles, categories, segment/channel names)
// now flows in from a remote source (GitHub) when update-checking is enabled,
// not just from files we ship. Any `innerHTML` / `outerHTML` /
// `insertAdjacentHTML` / `document.write` that interpolates a value would
// turn that into a real XSS sink.
//
// This scans src/ for those sinks and fails the build if the assigned value
// interpolates (`${...}`) anything NOT wrapped in escapeHtml()/escapeAttr(),
// unless the sink's first line carries `// html-safe: <reason>`. Static
// template strings (no `${`) are fine. Handles multi-line template literals.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");

const SINK = /\.(innerHTML|outerHTML)\s*=(?!=)|\.insertAdjacentHTML\s*\(|document\.write\s*\(/;
const SAFE_INTERP = /^\s*escape(Html|Attr)\s*\(/;

function walk(dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) out.push(...walk(p));
		else if (/\.(ts|js|mjs)$/.test(name)) out.push(p);
	}
	return out;
}

/** every `${` in `text` must be immediately followed by an escape*() call */
function interpolationsAllSafe(text) {
	const parts = text.split("${").slice(1);
	return parts.every((p) => SAFE_INTERP.test(p));
}

const violations = [];
for (const file of walk(srcDir)) {
	const rel = relative(join(here, ".."), file);
	const lines = readFileSync(file, "utf8").split("\n");
	for (let i = 0; i < lines.length; i++) {
		if (!SINK.test(lines[i])) continue;
		// `// html-safe: <reason>` acknowledgement, on the sink line or just above it.
		if (lines[i].includes("// html-safe:") || (i > 0 && lines[i - 1].trim().startsWith("// html-safe:"))) continue;
		// Gather the assigned expression: this line, plus continuation lines
		// while a backtick template literal is still open.
		let span = lines[i];
		let ticks = (lines[i].match(/`/g) || []).length;
		let j = i;
		while (ticks % 2 === 1 && j + 1 < lines.length) {
			j++;
			span += "\n" + lines[j];
			ticks += (lines[j].match(/`/g) || []).length;
		}
		if (!span.includes("${")) continue; // fully static
		if (!interpolationsAllSafe(span)) {
			violations.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
		}
	}
}

if (violations.length) {
	console.error("HTML-sink guardrail: an innerHTML/outerHTML sink interpolates a value that is not escapeHtml()/escapeAttr()-wrapped and has no `// html-safe:` note:\n");
	for (const v of violations) console.error("  " + v);
	console.error("\nBuild it with textContent / DOM nodes, wrap the interpolants, or add `// html-safe: <reason>` when the interpolants are provably not string data.");
	process.exit(1);
}
console.log("html-sink guardrail: clean");
