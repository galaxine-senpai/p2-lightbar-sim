// Writes src/data/bundledBlobManifest.json: { "<file>.lua": "<git blob sha1>" }
// for every bundled component source. The app diffs these hashes against the
// GitHub Contents API listing (which reports the same git blob sha per file),
// so "has upstream changed a file we ship" is answered with zero downloads.
//
// git blob sha1 = sha1("blob " + <byteLength> + "\0" + <bytes>)
//
// Run by the predev / prebuild npm hooks; the result is committed so it is
// always present even without running the hook.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const componentsDir = join(here, "..", "src", "data", "components");
const outFile = join(here, "..", "src", "data", "bundledBlobManifest.json");

function gitBlobSha(buf) {
	const h = createHash("sha1");
	h.update(`blob ${buf.length}\0`);
	h.update(buf);
	return h.digest("hex");
}

const manifest = {};
for (const name of readdirSync(componentsDir).sort()) {
	if (!name.endsWith(".lua")) continue;
	// Normalise CRLF -> LF before hashing so the result matches the git blob
	// sha GitHub reports (git stores these text files with LF; a Windows
	// working tree has CRLF). The remote content we later fetch from
	// raw.githubusercontent.com is also LF.
	const text = readFileSync(join(componentsDir, name), "utf8").replace(/\r\n/g, "\n");
	manifest[name] = gitBlobSha(Buffer.from(text, "utf8"));
}

writeFileSync(outFile, JSON.stringify(manifest, null, "\t") + "\n");
console.log(`bundled-manifest: ${Object.keys(manifest).length} components hashed -> ${outFile}`);
