import type { CompiledComponent } from "../engine/types";
import { serializeComponentToLua } from "../export/luaExport";

export function renderExportPanel(el: HTMLElement, component: CompiledComponent) {
	const lua = serializeComponentToLua(component.raw);
	const fileName = `${component.id || "custom_lightbar"}.lua`;

	el.innerHTML = `
    <div class="hint">
      This generates a real Photon2 <code>COMPONENT</code> file. To use it in-game, save it as
      <code>lua/photon-v2/library/components/${escapeHtml(fileName)}</code> inside your addon
      (the filename becomes the component's ID) and restart/reload. It will then be selectable on any
      vehicle's Equipment list like any other lightbar.
    </div>
    <div class="row wrap" style="margin-bottom:8px;">
      <button id="copy-btn" class="primary">Copy to clipboard</button>
      <button id="download-btn">Download ${escapeHtml(fileName)}</button>
    </div>
    <textarea class="export-output" readonly spellcheck="false"></textarea>
  `;

	const textarea = el.querySelector("textarea.export-output") as HTMLTextAreaElement;
	textarea.value = lua;

	el.querySelector("#copy-btn")!.addEventListener("click", async () => {
		try {
			await navigator.clipboard.writeText(lua);
			flashButton(el.querySelector("#copy-btn") as HTMLButtonElement, "Copied!");
		} catch {
			textarea.select();
			document.execCommand("copy");
			flashButton(el.querySelector("#copy-btn") as HTMLButtonElement, "Copied!");
		}
	});

	el.querySelector("#download-btn")!.addEventListener("click", () => {
		const blob = new Blob([lua], { type: "text/plain" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = fileName;
		a.click();
		URL.revokeObjectURL(url);
	});
}

function flashButton(btn: HTMLButtonElement, text: string) {
	const original = btn.textContent;
	btn.textContent = text;
	setTimeout(() => (btn.textContent = original), 1200);
}

function escapeHtml(s: string): string {
	const d = document.createElement("div");
	d.textContent = s;
	return d.innerHTML;
}
