# P2 Lightbar Sim

A browser application for inspecting, simulating, and editing Photon 2 lightbar
components, and for exporting them back to Photon 2 `.lua` component files.

Photon 2 is a Garry's Mod emergency-lighting addon
(<https://github.com/photonle/Photon-v2>). Its lightbars ("components") are
authored as declarative `.lua` files. This tool reads those files, runs their
lighting logic outside the game, and writes the same file format back out. It
is not a Garry's Mod addon and is not affiliated with the Photon Lighting
Group. It ships only the Lua component sources from the upstream project; no
models, materials, or sounds are included, so the viewer draws stylized 2D
glow shapes rather than reproducing in-game rendering.

## Repository layout

| Path | Contents |
| --- | --- |
| `app/` | The application. Vite + TypeScript, no backend. All runtime logic is client-side. |
| `app/src/engine/` | Compile-time model: inheritance, `StateMap`/`Frames` parsing, `Features`, `Patterns`/`Inputs` resolution. |
| `app/src/lua/` | The in-browser Lua VM setup, the GMod/Photon 2 authoring shim, and two files ported verbatim from upstream (`sequence_builder.lua`, `default_light_states.lua`). |
| `app/src/render/` | Canvas viewer. |
| `app/src/ui/` | Tab panels (pattern editor, code editor, export). |
| `app/src/data/components/` | Bundled Photon 2 component `.lua` sources (MIT; see `app/PHOTON2_LICENSE.txt`). |
| `.claude/` | Editor launch configuration. Not required to build or run. |
| `photon-v2-src/` | Local checkout of the upstream addon, kept for reference. Git-ignored. |
| `photon-v2-wiki/` | Local checkout of the upstream wiki, kept for reference. Git-ignored. |

`photon-v2-src/` and `photon-v2-wiki/` are excluded in `.gitignore`. They are
independent clones with their own history and are not part of this project.
Clone them from the upstream repository if the reference material is needed
locally; nothing in `app/` imports from them.

## Requirements

- Node.js 20 or newer (Vite 8 / TypeScript 6).
- npm. A lockfile (`app/package-lock.json`) is committed; use `npm ci` for
  reproducible installs.

## Running the simulator

```
cd app
npm install
npm run dev
```

Vite prints a local URL (default `http://localhost:5173`). The dev server
supports hot reload. From the repository root, `.claude/launch.json` runs the
same command with `--host`.

## Operating the simulator

The window has three columns: the component library (left), the viewer
(center), and the inspector (right, tabbed).

- **Library.** Every bundled component, filterable by category and searchable
  by title or id. Components that use `COMPONENT.Base` inheritance are listed
  and resolved against their parent. **+ New Custom Lightbar** starts an empty
  component and opens the Pattern Editor.
- **Viewer.** Top-down schematic of the component's 2D/Mesh/Projected light
  elements, animated from the current dashboard state. **Pause** freezes the
  animation; **Reset dashboard** clears all active channels. A frame-rate
  readout is shown for reference. The canvas only repaints when the animation
  is running or the state changes, so a paused view is idle.
- **Dashboard tab.** The input channels and modes Photon 2 exposes on the
  vehicle dashboard (`Emergency.Warning` MODE1/2/3, `Emergency.Directional`,
  `Emergency.Cut`, and so on). Only channels the selected component responds
  to are enabled. Channels marked "drives other channels" feed condition-based
  virtual outputs (park mode, automatic headlights, etc.), which are shown
  separately.
- **Segments tab.** For each segment, the sequence it is currently playing and
  the channel/mode that selected it. Clicking a sequence chip force-previews
  that sequence in isolation, ignoring the dashboard, until toggled off.
- **Pattern Editor tab.** Build a new segment and sequence with a
  frame-by-frame colour grid, choose the idle (`Off`) behaviour and frame
  timing, and assign the result to a channel/mode. New light elements can be
  added here; this is also how a from-scratch lightbar is populated. Applying a
  pattern recompiles the component in place.
- **Code Editor tab.** Write Photon 2 authoring syntax directly (the real
  `Frames`/`StateMap` DSL and `Photon2.SequenceBuilder` chains). `COMPONENT`
  and `sequence` are predeclared. The snippet is treated as a patch: named
  segments and inputs are added or replaced, everything else is left in place.
  Parse and compile errors are reported inline.
- **Export tab.** The current component serialized to a Photon 2 `.lua` file,
  including any edits made in the Pattern or Code editors. Copy it or download
  it, then place it at
  `lua/photon-v2/library/components/<id>.lua` in a Photon 2 addon. The
  filename becomes the component id.

## Building from source

```
cd app
npm run build
```

This runs `tsc` as a type check (no emit) followed by `vite build`. Output
goes to `app/dist/` (git-ignored) and is a static bundle: no server component,
deployable to any static host. `npm run preview` serves the built bundle
locally.

The `tsc` step runs with `strict` enabled and must pass for the build to
proceed.

## Tests

There is no automated test suite in this repository yet. Verification is
manual:

1. `npm run build` — type check plus production build. Must exit clean.
2. Run the dev server and open the browser console.
3. Select each bundled component in turn. Each should load without a console
   error, render its elements, and respond to the dashboard channels it
   advertises. Compile warnings, if any, are surfaced in a banner under the
   viewer.
4. On a component, open the Export tab, copy the output, and paste it into the
   Code Editor's flow (or reload it) to confirm it parses and compiles back to
   an equivalent component.

The engine and Lua-porting layers (`app/src/engine/`, `app/src/lua/`) are the
sensible first target for unit tests if a suite is added; they are pure
functions over data and do not touch the DOM.

## How it works

1. **Lua execution.** `app/src/lua/loader.ts` runs each component's unmodified
   `.lua` source in [fengari](https://github.com/fengari-lua/fengari), a Lua
   VM compiled to JavaScript. `app/src/lua/gmod_shim.lua` provides the subset
   of the Garry's Mod and Photon 2 authoring API the files call at load time
   (`Vector`, `Angle`, `PhotonColor`, table/string helpers, `SequenceBuilder`,
   and so on). GLua operator aliases (`!`, `&&`, `||`) are rewritten to
   standard Lua first. The result is the component's data tables, converted to
   plain JavaScript objects. A fresh VM is used per file.
2. **Ported sources.** `sequence_builder.lua` and `default_light_states.lua`
   are copied from Photon 2's MIT-licensed source rather than reimplemented,
   so sequence construction and default element colours match upstream.
3. **Compilation.** `app/src/engine/` reproduces Photon 2's compile-time
   behaviour in TypeScript: `COMPONENT.Base` inheritance, the `StateMap` and
   `Frames` string DSLs, zero-frame generation, `Patterns`/`Inputs`/
   `InputPriorities` resolution, and the `Features` shorthand flags.
4. **Playback.** `app/src/engine/player.ts` mirrors the runtime controller:
   per-segment channel-priority resolution, frame stepping at each sequence's
   frame duration (including sinusoidal variable timing), `Order`-based
   compositing when segments share an element, intensity-transition ramps, and
   `Bone` rotation with `AngleOutputMap` proxy colouring for rotating beacons.
5. **Export.** `app/src/export/luaExport.ts` serializes the (possibly edited)
   component back to Photon 2 Lua syntax, reconstructing `PhotonColor(...)`
   and `:Blend(...):GetBlendColor()` call chains so the output is valid input
   to the addon.

## Known limitations

- Rendering is a 2D schematic. Element sizes and positions come from the real
  data; the visual style does not.
- Bone-parented elements (mesh/lens pieces physically mounted on a rotating
  bone) are not drawn, because their position depends on a 3D bone transform
  this tool does not track. A rotating beacon's fixed elements still render,
  and rotation is indicated with a directional cue.
- `Sound`, `Pose`, `Sequence`, `Sub`, and `Virtual` element types are
  preserved through load and export but not simulated.
- Vehicle-level assembly (multi-component profiles, siren tone sets,
  equipment variants) is out of scope; the tool operates on one component at a
  time.
- Files that define more than one component only expose the first.
- Degree-based phasing and the `Options`/`DefineOptions` feature are preserved
  in exported data but have no editor UI.

## Licensing

The bundled component Lua sources under `app/src/data/components/` are copied
from the upstream Photon 2 repository and are MIT-licensed; see
`app/PHOTON2_LICENSE.txt`. That license covers Lua code only, not art assets,
which is why none are included.
