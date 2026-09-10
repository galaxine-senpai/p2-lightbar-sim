# P2 Lightbar Sim

> [!WARNING]
> This was <ins>***100% vibecoded***</ins> with ***moderate human overview***, this was and is a test of claude code to see the quality of work it can output. If any of this breaks just sumbit an issue and I will look into it.

A tool for inspecting, simulating, and editing Photon 2 lightbar components, and
exporting them back to Photon 2 `.lua` files.

Photon 2 (<https://github.com/photonle/Photon-v2>) is a Garry's Mod
emergency-lighting addon whose lightbars ("components") are declarative `.lua`
files. This tool runs that lighting logic outside the game and writes the same
format back out. It is not a Garry's Mod addon and is not affiliated with the
Photon Lighting Group. Only the upstream Lua component sources are bundled — no
models, materials, or sounds — so the viewer draws stylized 2D glow shapes
rather than reproducing in-game rendering.

## Requirements

Node.js 20 or newer, and npm. A lockfile (`app/package-lock.json`) is committed;
use `npm ci` for a reproducible install.

## Run

```
cd app
npm install
npm run dev
```

`npm run dev` starts the Vite dev server and opens the app in an Electron
window, with hot reload. `npm run dev:web` runs the dev server on its own for
use in a browser at `http://localhost:5173`. After `npm run build`, `npm start`
opens the built bundle in the Electron window without a dev server.

## Build

```
cd app
npm run build
```

Runs `tsc` as a type check (`strict`, must pass) followed by `vite build`. The
`prebuild` hook regenerates `src/data/bundledBlobManifest.json` (git blob
hashes of the bundled component sources) and runs `scripts/check-html-sinks.mjs`,
which fails the build on any `innerHTML` sink that interpolates an unescaped
value. The result is a static bundle in `app/dist/` (git-ignored) with no
server component; `npm run preview` serves it locally.

## Component updates

The bundled component sources are a snapshot of the upstream Photon 2
`lua/photon-v2/library/components` directory. **Check GitHub for updates** in
the library panel (off by default) compares that directory's current git blob
hashes against the shipped manifest, with no downloads, and lists any
added / modified / removed files by title. Nothing is fetched or loaded until
you review and apply; accepted files are cached locally and re-applied on the
next launch. Every failure mode — offline, rate-limited, blocked — falls back
to the bundled snapshot, and a fetched file that does not parse is rejected
with the previous version kept. See
[`docs/upstream-divergences.md`](docs/upstream-divergences.md) for the trust
model this introduces.

## Tests

There is no automated test suite. Verification is manual:

1. `npm run build` exits clean.
2. With the dev server running and the browser console open, select each bundled
   component in turn. Each should load without a console error, render its
   elements, and respond to the dashboard channels it advertises. Compile
   warnings appear in a banner under the viewer.
3. On any component, open the Export tab, copy the output, and paste it back
   through the Code Editor (or reload it) to confirm it round-trips.

`app/src/engine/` and `app/src/lua/` are pure functions over data with no DOM
access and are the natural first target if a suite is added.

## Layout

| Path | Contents |
| --- | --- |
| `app/src/engine/` | Compile model and playback: inheritance, `StateMap`/`Frames` parsing, `Features`, `Patterns`/`Inputs` resolution, the runtime player. |
| `app/src/lua/` | In-browser Lua VM (fengari) and the GMod/Photon 2 shim. `sequence_builder.lua` and `default_light_states.lua` are copied verbatim from upstream. |
| `app/src/render/` | Canvas viewer. |
| `app/src/ui/` | Pattern editor, code editor, and export panels. |
| `app/src/data/components/` | Bundled Photon 2 component sources (MIT; see `app/PHOTON2_LICENSE.txt`). |
| `docs/` | Notes on where this tool diverges from Photon 2, and upstream bugs found along the way. |
| `photon-v2-src/`, `photon-v2-wiki/` | Local checkouts of the upstream repo and wiki, for reference. Git-ignored; independent clones, not part of this project. |

## How it works

Each component's unmodified `.lua` runs in [fengari](https://github.com/fengari-lua/fengari)
(a Lua VM compiled to JavaScript) behind a shim that provides the Photon 2
authoring API. `app/src/engine/` then reproduces Photon 2's compile step
(inheritance, the `StateMap` and `Frames` string DSLs, `Features`,
`Inputs`/`InputPriorities`), and `player.ts` mirrors the runtime controller:
channel-priority resolution, frame stepping (including sinusoidal variable
timing), `Order`-based compositing when segments share an element, intensity
ramps, and `Bone` rotation. `luaExport.ts` serializes the result back to valid
Photon 2 Lua.

## Limitations

- The viewer is a 2D schematic. Element positions and sizes come from the real
  data; the visual style does not.
- Bone-parented mesh and lens pieces are not drawn — their position depends on a
  3D bone transform this tool does not track. A rotating beacon's fixed elements
  still render, and a proxy-coloured element driven by a rotor draws a projected
  cone of light that sweeps with the rotor's angle.
- `Sound`, `Pose`, `Sequence`, `Sub`, and `Virtual` element types load and
  export but are not simulated.
- Vehicle-level assembly (multi-component profiles, siren tone sets, equipment
  variants) is out of scope; the tool works on one component at a time.
- Degree phasing on sequence references (`"SEQ:deg"`) is simulated but has no
  editor UI. The `Options`/`DefineOptions` feature is preserved on export only.

## Licensing

The bundled Lua under `app/src/data/components/` is copied from the upstream
Photon 2 repository and is MIT-licensed (`app/PHOTON2_LICENSE.txt`). That license
covers Lua code only, not art assets, which is why none are included.
