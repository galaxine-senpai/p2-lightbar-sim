# Upstream divergences and known upstream issues

This tool tries to reproduce Photon 2's behaviour exactly. Where it deliberately
does something different, or where it has found a probable defect in Photon 2
itself, it is recorded here.

## Deliberate divergences from Photon 2

### Virtual output resolution: `Most specific` mode (opt-in)

**Default: faithful.** `app/src/engine/player.ts` resolves
`COMPONENT.VirtualOutputs` exactly like Photon 2's
`Component:ApplyModeUpdate` (`photon-v2-src/lua/photon-v2/meta/lighting_component.lua:620-638`):
the mode entries are walked in array order and the first entry whose conditions
are all satisfied wins. No preference is given to entries that list more
conditions.

**Opt-in alternative:** the viewer has a *Virtual output resolution* toggle.
Switching it to **Most specific** makes the entry with the greatest number of
satisfied conditions win, breaking ties toward the earlier entry. This is **not**
how the game behaves. It exists so the effect of the upstream ordering bug below
can be seen directly.

The toggle only changes the simulation. Exported `.lua` is unaffected.

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
analysis doc for what still needs checking before filing (our
`photon-v2-src/` checkout is shallow and about two weeks behind).

In this tool, switch *Virtual output resolution* to **Most specific** to make
`PARKING` reachable and see the intended behaviour.
