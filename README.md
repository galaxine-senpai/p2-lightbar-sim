# P2 Lightbar Sim

A standalone web app for browsing, simulating, and designing
[Photon 2](https://github.com/photonle/Photon-v2) (Garry's Mod) lightbar
patterns, with export to real, drop-in-ready Photon 2 component `.lua` files.

This is an unofficial fan tool, not affiliated with the Photon Lighting Group.
It is not a Garry's Mod addon itself — it's a browser app that reads and writes
the same `.lua` component format Photon 2 uses.

## Repository layout

| Path | What it is |
| --- | --- |
| `app/` | The actual application — a Vite + TypeScript single-page app. **This is the project.** |
| `.claude/` | Editor/dev-tool launch config. |
| `photon-v2-src/` *(gitignored)* | A local checkout of the upstream [Photon-v2](https://github.com/photonle/Photon-v2) addon, kept for reference. Not committed — it has its own git history. |
| `photon-v2-wiki/` *(gitignored)* | A local checkout of the upstream Photon-v2 wiki, kept for reference. Not committed. |

The two `photon-v2-*` directories are excluded via `.gitignore`; clone them
yourself from the upstream repo if you want the reference material alongside.

## Running it

```bash
cd app
npm install
npm run dev
```

Then open the printed `http://localhost:5173` URL. `npm run build` produces a
static `dist/` folder that can be hosted anywhere (no server-side logic —
everything runs client-side).

## How it works

Photon 2 lightbars ("components") are authored as `.lua` files with a rich
declarative structure: `Templates` (light types), `Elements` (physical light
positions), `States`/`StateMap` (colors), `Segments` (`Frames` + `Sequences`,
i.e. flash patterns), and `Inputs` (which dashboard channel/mode plays which
sequence on which segment). Full semantics are on the
[Photon 2 wiki](https://github.com/photonle/Photon-v2/wiki/Components).

To get real, byte-faithful behavior instead of a hand-reimplemented
approximation:

- **[fengari](https://github.com/fengari-lua/fengari)** (a Lua VM compiled to
  JS) runs the **actual, unmodified** Photon 2 component `.lua` files in the
  browser, inside a small compatibility shim (`app/src/lua/gmod_shim.lua`) that
  stubs just enough of the GMod/Photon 2 authoring API for these files to
  execute top-to-bottom and produce their real data tables.
- `app/src/lua/sequence_builder.lua` and `app/src/lua/default_light_states.lua`
  are **ported verbatim** from Photon 2's own MIT-licensed source, so sequence
  timing and default colors match exactly.
- `app/src/engine/` reimplements Photon 2's compile-time logic in TypeScript
  against that raw data.
- `app/src/engine/player.ts` mirrors the real controller's per-segment
  channel-priority resolution and sequence frame-stepping.
- `app/src/export/luaExport.ts` serializes the (possibly edited) component back
  into real Photon 2 Lua syntax.

See `app/README.md` for the full feature tour and known limitations.

## License

Only the **Lua source** of the bundled component library
(`app/src/data/components/*.lua`) is copied from the upstream repo — see
`app/PHOTON2_LICENSE.txt` (MIT). That license covers Lua code but not art
assets (models/materials/sounds), so none of those are bundled; the simulator
renders stylized procedural glow graphics instead.
