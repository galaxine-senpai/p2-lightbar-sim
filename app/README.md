# P2 Lightbar Sim

A standalone web app for browsing, simulating, and designing [Photon 2](https://github.com/photonle/Photon-v2) (Garry's Mod) lightbar patterns, with export to real, drop-in-ready Photon 2 component `.lua` files.

This is an unofficial fan tool, not affiliated with the Photon Lighting Group. It is not a Garry's Mod addon itself — it's a browser app that reads and writes the same `.lua` component format Photon 2 uses.

## Running it

```bash
npm install
npm run dev
```

Then open the printed `http://localhost:5173` URL. `npm run build` produces a static `dist/` folder that can be hosted anywhere (no server-side logic at all — everything runs client-side).

## How it works

Photon 2 lightbars ("components") are authored as `.lua` files with a fairly rich declarative structure: `Templates` (light types), `Elements` (physical light positions), `States`/`StateMap` (colors), `Segments` (`Frames` + `Sequences`, i.e. flash patterns), and `Inputs` (which dashboard channel/mode plays which sequence on which segment). Full semantics are documented on the [Photon 2 wiki](https://github.com/photonle/Photon-v2/wiki/Components).

To get real, byte-faithful behavior instead of a hand-reimplemented approximation, this app takes an unusual approach:

- **[fengari](https://github.com/fengari-lua/fengari)** (a Lua VM compiled to JS) runs the **actual, unmodified** Photon 2 component `.lua` files in the browser, inside a small compatibility shim (`src/lua/gmod_shim.lua`) that stubs just enough of the Garry's Mod/Photon2 authoring API (`Vector`, `Angle`, `PhotonColor`, `PhotonMaterial`, table/string helpers, etc.) for these files to execute top-to-bottom and produce their real data tables.
- `src/lua/sequence_builder.lua` and the default light-state color table in `src/lua/default_light_states.lua` are **ported verbatim** from Photon 2's own source (MIT-licensed) rather than reimplemented, so sequence timing and default R/B/A/W/etc. colors match exactly.
- `src/engine/` then reimplements Photon 2's compile-time logic in TypeScript against that raw data — the `Frames`/`StateMap` string DSL parser, zero-frame generation, `COMPONENT.Base` inheritance, `Patterns`/`Inputs`/`InputPriorities` resolution, and the `Features` shorthand flags (`ParkMode`, `AutomaticHeadlights`, etc.) — following the semantics documented in the wiki and confirmed against Photon 2's actual runtime source (`lighting_segment.lua`, `lighting_component.lua`, the controller entity).
- `src/engine/player.ts` is a small runtime that mirrors the real controller's per-segment channel-priority resolution and sequence frame-stepping, so picking dashboard modes in the "Dashboard" tab drives the same segment/sequence logic the game would.
- `src/export/luaExport.ts` serializes the (possibly edited) component back into real Photon 2 Lua syntax — including reconstructing genuine `PhotonColor(...):Blend(...):GetBlendColor()` call chains for colors, not inert data tables, so exported files work when dropped into the real addon.

All 78 bundled component files load, compile, and export→reimport cleanly through this pipeline (validated by an automated sweep during development).

### License note

Only the **Lua source** of the bundled component library (`src/data/components/*.lua`) is included, copied from the upstream repo — see `PHOTON2_LICENSE.txt`. That license explicitly covers Lua code but *not* art assets (models/materials/sounds), so none of those are bundled; the simulator instead renders stylized procedural glow graphics rather than the real in-game materials.

## Using the app

- **Library panel** (left): every built-in Photon 2 lightbar/component, searchable and filterable by category, including ones that use `COMPONENT.Base` inheritance.
- **Viewer** (center): a schematic top-down render of the selected lightbar's light elements, animated in real time.
- **Dashboard tab**: toggles the same input channels/modes Photon 2 uses in-game (`Emergency.Warning` MODE1/2/3, `Emergency.Directional`, `Emergency.Cut`, etc.) — only channels the selected component actually responds to are enabled.
- **Segments tab**: shows which segment is currently playing which sequence (and why), and lets you force-preview any individual sequence in isolation.
- **Pattern Editor tab**: build a new custom flash pattern (a new `Segment` + `Sequence`) for the current lightbar using a frame-by-frame color grid, then assign it to a channel/mode. You can also add brand-new light elements here, which is how "+ New Custom Lightbar" starts a lightbar from scratch.
- **Code Editor tab**: for anyone already familiar with Photon2 authoring, write patterns directly in real Photon2 syntax -- the exact `Frames`/`StateMap` DSL and `Photon2.SequenceBuilder` chains (`:Alternate()`, `:SteadyFlash()`, `:RoadRunner()`, `:QSwitch()`, etc. -- the full real API, since it's the genuine ported source running in a real Lua VM) real component files use. `COMPONENT` and `sequence` are pre-declared, so a snippet can start straight at `COMPONENT.Segments = {...}`. Each snippet is a patch: segments/inputs you name are added or replaced, everything else on the lightbar is left alone.
- **Export tab**: the live, real Photon 2 `.lua` source for the current component (including any custom pattern/elements you've added), ready to copy or download straight into `lua/photon-v2/library/components/` in a Photon 2 addon.

## Known limitations / scope

This first pass focuses on `2D`/`Mesh`/`Projected` light elements (the vast majority of real lightbars, including rotating beacons) and the component/lightbar authoring layer:

- **Rendering** is a stylized 2D schematic (glow blobs sized/positioned from the real element data), not a 3D/textured re-creation of Source engine rendering — intentional, since no game assets are bundled.
- **Rotating beacons** (e.g. Federal Signal Vision SLR, Code 3 MX7000) are simulated: `Bone` elements rotate/sweep/move-to-angle per their real `Activity`/`Speed`/`AngleOutputMap` data, and other elements that reference a bone's live angle via a `Proxy` state pick up its current color in real time. A bone-parented element's position is relative to a 3D bone transform this simulator doesn't track, so those specific elements (the physically-rotating mesh/lens pieces) aren't drawn -- only elements at their own fixed authored position (e.g. a beacon's static indicator ring) render. Those elements draw as a crescent (a moon-phase bite out of the bright core) whose bright sliver rotates opposite the bone's current angle, so a rotating beacon visibly reads as spinning rather than just changing color. The black bite only covers the small solid emitter core, not the soft ambient glow around it, so the light still reads as glowing while it spins. Color changes as the beacon sweeps across an `AngleOutputMap` breakpoint cross-fade smoothly (matching DVI's fade behavior) instead of snapping instantly, so the rotation doesn't flicker.
- **Non-2D/Mesh/Projected element types** (`Sound`, `Pose`, `Sequence`, `Sub`, `Virtual`) are preserved in the data model and export, but aren't visually simulated.
- **Vehicle-level assembly** (multi-component profiles, siren tone sets, equipment categories/variants) isn't implemented — this tool operates at the single-component/lightbar level.
- **Degree-based phasing** and the `Options`/`DefineOptions` custom-function feature are preserved in exported data but have no dedicated editor UI.
- A handful of real component files define more than one component per `.lua` file (e.g. Whelen Dominator's x2/x4/x6 variants); only the first (self-contained) one is loaded — the others aren't independently browsable.
