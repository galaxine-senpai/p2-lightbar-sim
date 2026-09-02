# Upstream divergences, trust model, and known upstream issues

This tool tries to reproduce Photon 2's behaviour exactly. Where it deliberately
does something different, where fetching components from GitHub changes the
security picture, and where it has found a probable defect in Photon 2 itself,
it is recorded here.

## Deliberate divergences from Photon 2

None affecting simulation output at present. `app/src/engine/player.ts` resolves
`COMPONENT.VirtualOutputs` exactly like Photon 2's `Component:ApplyModeUpdate`
(`photon-v2-src/lua/photon-v2/meta/lighting_component.lua:620-638`): mode entries
are walked in array order and the first whose conditions are all satisfied wins,
with no preference for entries that list more conditions. (An earlier build used
a "most specific wins" heuristic; that was dropped to match the game.)

## Trust model: fetching components from GitHub

The **Check GitHub for updates** feature (opt-in, off by default) has the app
fetch and run Lua authored outside this repository, and lets component metadata
shown in the UI be controlled by that remote source rather than by files we
ship. What that does and does not expose:

- **Lua execution.** Fetched `.lua` runs in the fengari sandbox with only
  `base`/`table`/`string`/`math` opened — no `io`, `os`, `package`, `require`,
  no network, no filesystem, no DOM. The realistic worst case from a hostile
  component is denial of service (an infinite loop at load hangs the tab, a huge
  allocation OOMs it), not code execution or data exfiltration.
- **DOM.** Component strings (titles, categories, segment and channel names)
  reach the DOM only via `textContent` or `escapeHtml()`. `scripts/check-html-sinks.mjs`
  runs in `prebuild` and fails the build if any `innerHTML`/`outerHTML` sink
  interpolates an unescaped value without an explicit `// html-safe:` note, so a
  future change cannot silently turn this into an XSS sink.
- **Supply chain.** The source is `github.com/photonle/Photon-v2`, branch `main`
  (there are no upstream tags or releases to pin to). A compromise of that
  branch would let an attacker's Lua run on the next check for any user who has
  the feature enabled — blast radius as above (tab DoS + attacker-controlled
  text), not RCE.

Mitigations in place: the feature is **opt-in and off by default**; a check does
**zero downloads** (it diffs git blob hashes from the Contents API against a
shipped manifest) and shows every added / modified / removed file for review;
**nothing is fetched or applied without explicit consent**; a fetched file that
fails to parse or compile is rejected and the previous version kept; and the
bundled snapshot remains the cold-start source of truth and the fallback for
every failure (offline, rate-limited, blocked, corrupt response).

## Probable Photon 2 defects observed

### `Vehicle.AutomaticLighting` `PARKING` mode is unreachable

Full analysis: [`upstream-automatic-lighting-parking.md`](./upstream-automatic-lighting-parking.md).

Summary: `Photon2.ComponentBuilder.SetupAutomaticVehicleLighting`
(`photon-v2-src/lua/photon-v2/sh_component_builder.lua:87-113`) lists the
`HEADLIGHTS` mode before `PARKING`, and `HEADLIGHTS`'s conditions
(`Vehicle.Ambient=DARK`, `Vehicle.Lights=AUTO`) are a strict subset of
`PARKING`'s (those two plus `Vehicle.Engine=ON`, `Vehicle.Transmission=PARK`).
Because `ApplyModeUpdate` takes the first satisfied entry and stops, any state
that would satisfy `PARKING` has already matched `HEADLIGHTS`. `PARKING` can
therefore never be selected in game, for any component using the
`AutomaticHeadlights` feature.

Confidence that it is unreachable: high. Confidence that it is unintended rather
than a simplification: moderate (a commented-out transmission condition on
`HEADLIGHTS` suggests it is unfinished). Not reported upstream yet — see the
analysis doc for what still needs checking before filing (our `photon-v2-src/`
checkout is shallow and a few weeks behind).
