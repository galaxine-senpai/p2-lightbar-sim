# Upstream finding write-up: `Vehicle.AutomaticLighting` `PARKING` mode

**Status: NOT filed.** This is for you to read and decide. Nothing was pushed to
the Photon 2 repo, nothing forked, `photon-v2-src/` untouched.

**Investigated against:** `photon-v2-src/` at commit `57d814a` ("add overexposure
simulation", 2026-08-16). This is a **shallow clone (depth 1)** — `git log` shows
exactly one commit, `git log --all` the same. So I could not check blame, commit
messages, prior reverts, or whether this code changed recently. GitHub issues/PRs
are not in a clone and I did not go online to check them.

---

## The claim, in one sentence

For every component that uses the `AutomaticHeadlights` feature, the
`Vehicle.AutomaticLighting` virtual-output mode `PARKING` can never be selected,
because `HEADLIGHTS` is listed before it and its conditions are a strict subset.

## Why I went looking

While checking whether our sim's virtual-output resolver matched upstream, the
resolver turned out to be *first matching entry in array order wins, then
`break`* — no "most specific" preference. That immediately raises the question of
whether any entry is shadowed by an earlier, looser one. `Vehicle.AutomaticLighting`
is the only multi-entry virtual output where one entry's conditions are a subset
of another's.

---

## Attempts to falsify it

I tried to break the claim six ways. Each is "what I checked → what I found".

### 1. Is there a second resolver, or any other write to `CurrentModes["Vehicle.AutomaticLighting"]`?

`grep -rniI "CurrentModes" lua/` — every write:

- `meta/lighting_component.lua:641` — `self.CurrentModes[outputChannel] = modeResult`, inside `ApplyModeUpdate`. This is the resolver. It runs `for i=1, #outputModes` and `break`s on the first entry whose conditions all pass (`:620-638`).
- `meta/lighting_component.lua:700` / `:713` / `:726` / `:729` — `ClearAllModes`, `SuspendAllModes`, `ResumeAllModes`, `SetChannelMode`. Every one of these calls `ApplyModeUpdate()` immediately afterward (`:702`, `:715`, `:733`).
- `entities/photon_controller/shared.lua:1300` — controller pushing a networked channel to a component, via `component:SetChannelMode(channel, newState)` (`:1316`) → again ends in `ApplyModeUpdate()`.

Because `ApplyModeUpdate` **unconditionally rewrites `CurrentModes[outputChannel]` for every virtual output on every call** (`:640-641`, no guard), nothing can latch a value in from the side — the resolver has the last word each time any mode changes.

`grep` for `SetChannelMode(` callers: every call site sets a **real** channel
(`Vehicle.Ambient`, `Vehicle.Transmission`, `Vehicle.Lights`, `Vehicle.Engine`,
`Vehicle.Brake`, `Emergency.Warning`, `#DEBUG`). None sets
`"Vehicle.AutomaticLighting"`. And `Component:GetNetworkedChannels`
(`lighting_component.lua:849-860`) explicitly **excludes** virtual-output channels
from networking (`if not self.VirtualOutputs[channel] then ...`), so the controller
never pushes `Vehicle.AutomaticLighting` down either.

→ **No second resolver. No side-channel write survives.**

### 2. Can a component author or vehicle profile reorder / replace the entries?

The array is built in exactly one place:
`Photon2.ComponentBuilder.SetupAutomaticVehicleLighting` (`sh_component_builder.lua:85-128`),
as a literal `{ {HEADLIGHTS…}, {PARKING…}, {DRL…} }`, then `table.Merge( data, mixin )`.

- Feature dispatch runs at compile time (`lighting_component.lua:83-84`), after the
  component body and inheritance (`data = table.Copy(data)`, `GetInherited(data)` at `:67,:71`).
- `grep -rniI "AutomaticLighting" lua/` → the string appears **only** in
  `sh_component_builder.lua`. No component or vehicle file hand-rolls a
  `Vehicle.AutomaticLighting` virtual output.
- I checked all 12+ components that set the feature
  (`photon_standard_chevcap13`, `_fpis13`, `_sgmchar15`, `_smf15018`, `_smfpiu16`,
  `_sgmdodur21`, `_sgmfpiu13`, `photon_char15_pushbar`, `photon_fedsig_ils`,
  `photon_fedsig_integrity_44`, `photon_fedsig_valor_44`, `photon_sos_mpf4`) — **none
  defines its own `COMPONENT.VirtualOutputs`** (grep count 0 for each). So
  `table.Merge` always takes the "key does not exist yet" path and copies the mixin
  array verbatim, order intact.
- Even in the hypothetical where a component *did* pre-define
  `VirtualOutputs["Vehicle.AutomaticLighting"]`, GMod `table.Merge` recurses
  position-by-position into the two arrays and overwrites `.Mode` per index
  (string vs string → overwrite), so index 1 still ends up `HEADLIGHTS`, index 2
  still `PARKING`. There is no code path that puts `PARKING` at a lower index.
- Vehicle profiles can *enable* the feature (`vehicle_equipment.lua:188`,
  `Features = entry.Features or entry.Flags`) but cannot change what
  `SetupAutomaticVehicleLighting` emits.

→ **Order is fixed HEADLIGHTS-before-PARKING in every reachable configuration.**

### 3. Is `PARKING` genuinely a strict subset of `HEADLIGHTS` in *every* state?

- `HEADLIGHTS.Conditions` = `Vehicle.Ambient ∈ {DARK}`, `Vehicle.Lights ∈ {AUTO}`
- `PARKING.Conditions` = `Vehicle.Ambient ∈ {DARK}`, `Vehicle.Lights ∈ {AUTO}`, `Vehicle.Engine ∈ {ON}`, `Vehicle.Transmission ∈ {PARK}`

The first two clauses are identical. `PARKING` adds two more. So any state that
satisfies all four `PARKING` clauses satisfies both `HEADLIGHTS` clauses. There is
**no** assignment of channel modes that passes `PARKING` and fails `HEADLIGHTS`.
The condition check is `conditionModes[ self.CurrentModes[ch] ]`
(`lighting_component.lua:627`); a `nil` current mode fails the clause, which only
makes `PARKING` *harder* to satisfy, never `HEADLIGHTS`.

I also confirmed the asymmetry is specific to `PARKING`: the third entry `DRL`
(`Vehicle.Transmission ∈ {DRIVE,REVERSE}`, `Vehicle.Lights ∈ {AUTO}`, no `DARK`
requirement) **is** reachable — daytime + driving + AUTO fails both `HEADLIGHTS`
(no `DARK`) and `PARKING`, so `DRL` wins. Only `PARKING`, wedged between its own
superset-parent and a reachable sibling, is dead.

→ **The subset relationship is absolute, not conditional.**

### 4. Single pass, or could re-entrancy / iteration order let `PARKING` through?

`ApplyModeUpdate` iterates channels with `pairs` (order irrelevant — channels are
independent) and iterates each channel's modes with `for i=1, #outputModes`
(numeric, guaranteed 1→2→3), single pass, `break` on first match
(`lighting_component.lua:620-637`). `Vehicle.AutomaticLighting`'s conditions
reference only real channels, never other virtual outputs, so there is no
dependency that a second pass could resolve differently. `#outputModes` is 3 (a
literal 3-element array, no holes).

→ **Deterministic; no pass-ordering escape hatch.**

### 5. Is it already flagged in the code?

- No `TODO`/`FIXME`/`HACK` on the `SetupAutomaticVehicleLighting` entries or on the
  resolver loop.
- There **is** a generic `-- TODO: there needs to be an actual flag system setup`
  on `lighting_component.lua:82`, immediately above the Features dispatch — so the
  whole feature area is acknowledged as provisional, but nothing calls out this
  ordering.
- The one concrete tell: inside `HEADLIGHTS.Conditions`, the line
  `--["Vehicle.Transmission"] = { "DRIVE", "REVERSE" }` is **commented out**
  (`sh_component_builder.lua:92`). If it were active, `HEADLIGHTS` would require the
  vehicle to be moving, `PARKING` (`Transmission = PARK`) would stop being a subset,
  and `PARKING` would become reachable when stopped. That reads like an
  unfinished/reverted change rather than a deliberate design.
- Shallow clone → I could not check commit history, blame, or open issues/PRs.

→ **Not marked as a known bug in-tree; weak signal it's unfinished.**

### 6. Does the dead path have any observable effect, or is it invisible?

`SetupAutomaticVehicleLighting` populates
`Inputs["Vehicle.AutomaticLighting"]["PARKING"] = table.Copy( component.Inputs["Vehicle.Lights"]["PARKING"] or {} )`
(`sh_component_builder.lua:121`). I checked the components that use the feature:
they **do** define a distinct `Vehicle.Lights.PARKING` input, different from
`HEADLIGHTS`. Examples:

- `photon_standard_chevcap13.lua:229-240` — `PARKING` drives the `Lights` segment's
  `PARKING` sequence, `HEADLIGHTS` drives its `HEADLIGHTS` sequence (different frames).
- `photon_standard_sgmdodur21.lua:298-304` — `HEADLIGHTS` lights **both** a
  `Parking` and a `Headlights` segment; `PARKING` lights only `Parking`. So the
  headlight elements themselves would be on vs off.

So the intended-but-unreachable behavior is real: an auto-lit vehicle
(`AutomaticHeadlights`), headlight switch on `AUTO`, at night, engine on, in `PARK`
should drop from full headlights to parking lights only, and instead stays on full
headlights.

**But** the trigger scenario is narrow (AI or auto-lights vehicle + `AUTO` switch +
`DARK` + `PARK` + engine `ON`), and for some components the `HEADLIGHTS` vs
`PARKING` visual delta is small. A player may never notice.

→ **Real, but low-stakes and situational.**

---

## What survived

All of it. I could not find a state, a config, a merge path, or a second code
path that lets `PARKING` win. The claim holds for the code at commit `57d814a`.

## Confidence

- **`PARKING` is unreachable given the shipped code: ~95%.** Resolver verified at
  `lighting_component.lua:620-638`; sole definition site
  `sh_component_builder.lua:88`; strict-subset conditions; `ApplyModeUpdate`
  recomputes on every mode change so nothing latches; no component overrides the
  array; no alternate resolver.
- **It's a bug rather than intentional: ~60%.** The commented-out transmission
  clause is the main evidence for "unfinished". Against: the area is explicitly
  marked provisional, and "headlights stay on when parked" is a defensible
  non-behavior.
- **Worth a maintainer's time: low.** Narrow trigger, modest visual effect,
  trivially explained if intentional.

## What would change my mind

1. A newer upstream commit (we're ~2 weeks behind on a shallow clone) that
   reorders these entries, uncomments the transmission clause, or switches the
   resolver to a specificity model. **I could not check this.** Worth a 30-second
   look at the current `sh_component_builder.lua` and `lighting_component.lua` on
   GitHub, plus a search of issues for "AutomaticLighting" / "PARKING", before
   filing.
2. An existing issue or PR already covering it → then don't file, maybe add a note.
3. A maintainer statement that headlights-when-parked is intended → then it's a
   dead-config cleanup at most, not a behavior bug.
4. Evidence that no shipped component's `Vehicle.Lights.PARKING` differs
   meaningfully from `HEADLIGHTS` → then it's invisible and not worth reporting.
   (I found counter-examples, so this seems unlikely.)

## Recommendation

Borderline. It's a **correct** finding but a **minor** one. If you file it, frame
it as "possible unreachable config, here's the trace, is this intended?" rather
than "bug". If the maintainer is responsive to small correctness notes, it's a
clean, well-traced one. If not, it's not worth the noise. Your call — that's why
this isn't filed.

---

## Draft issue text (only if you decide to file — check points 1 & 2 above first)

> **`Vehicle.AutomaticLighting` `PARKING` mode appears unreachable**
>
> `Photon2.ComponentBuilder.SetupAutomaticVehicleLighting`
> (`lua/photon-v2/sh_component_builder.lua:87-113`) defines
> `VirtualOutputs["Vehicle.AutomaticLighting"]` with `HEADLIGHTS` at index 1 and
> `PARKING` at index 2. `HEADLIGHTS.Conditions` is
> `{Vehicle.Ambient=DARK, Vehicle.Lights=AUTO}`; `PARKING.Conditions` is those two
> plus `{Vehicle.Engine=ON, Vehicle.Transmission=PARK}`.
>
> `Component:ApplyModeUpdate` (`lua/photon-v2/meta/lighting_component.lua:620-638`)
> takes the first entry whose conditions all pass and `break`s. Every state that
> satisfies `PARKING` also satisfies `HEADLIGHTS` (identical first two clauses),
> and `HEADLIGHTS` is checked first, so `Vehicle.AutomaticLighting` never resolves
> to `PARKING`. The `PARKING` sequences copied from `Vehicle.Lights.PARKING` at
> `sh_component_builder.lua:121` are dead. (`DRL`, index 3, is still reachable —
> daytime + driving + `AUTO`.)
>
> The commented-out `--["Vehicle.Transmission"] = { "DRIVE", "REVERSE" }` in
> `HEADLIGHTS.Conditions` (`:92`) would, if active, make `HEADLIGHTS` require
> motion and let `PARKING` win when parked — which suggests this may be
> unfinished.
>
> If `PARKING` is meant to engage (drop to parking lights when auto-lit and parked
> at night), options: put `PARKING` before `HEADLIGHTS`, restore a
> mutually-exclusive clause on `HEADLIGHTS`, or have the resolver prefer the
> more-specific match. If headlights-while-parked is intended, the `PARKING` entry
> and its input copy could be removed.
>
> Minor, same file: `SetVariableTiming` defaults a missing `rate` to `1/3`
> (`sh_sequence_builder.lua:384`) while the raw-table path in `Sequence.New`
> defaults `VariableFrameDuration.Rate` to `0.5` (`meta/sequence.lua:103`).
