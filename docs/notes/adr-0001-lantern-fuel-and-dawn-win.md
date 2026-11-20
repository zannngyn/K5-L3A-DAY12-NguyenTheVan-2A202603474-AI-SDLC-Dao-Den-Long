# ADR-0001: Lantern Fuel State Machine & Dawn Survival Win Rule

- **Status:** Accepted (Phase 3 / Ticket-03, Contract v1.2)
- **Date:** 2026-11-20
- **Supersedes:** Phase 2 (`ticket-02.md` / Contract v1.1) lantern permanence, permanent safe zone, and `all_lit` early-win rules.

## Context

In Phase 2 (Contract v1.1), lit lanterns stayed lit forever with a permanent `6 m` safe zone, and lighting all lanterns immediately won the Night (`reason: "all_lit"`). Skilled players could light all lanterns in ~2 minutes and end the Night early, removing late-game tension and defensive decision-making.

Ticket-03 ("Đèn cạn dầu") shifts the core game loop from *"light every lantern once"* to *"keep the island lit until dawn"*.

## Decision

### 1. Lantern Fuel State Machine (`unlit` / `lit` / `ever_lit`)
- Each lantern tracks `lit: boolean`, `ever_lit: boolean`, `deposited: number`, `relit_count: number`, and fuel.
- **Unlit (never lit, `ever_lit === false`):** Requires `10` motes to light.
- **Lit (`lit === true`):** Starts at `fuel = 100` (both on first light and relight) and sets `ever_lit = true`. While lit, fuel decays at `1.0 / s` (`1/60` per tick).
- **Refuel:** Interacting with a lit, non-full lantern deposits `used = min(carried, ceil((100 - fuel) / 10))` motes and sets `fuel = min(100, fuel + 10 * used)`, emitting `refuel { lantern_id, amount, fuel }`. Full lanterns (`used === 0`) are not selectable, emit no event, and award no score. Interact targets only receivable lanterns (unlit, or lit and not full), choosing nearest (tie → smaller `id`).
- **Extinguished (`fuel <= 0`):** Immediately after Step 2 (counter/fuel update), any lit lantern with `fuel <= 0` turns off (`lit = false`, `deposited = 0`, `fuel = 0`), keeps `ever_lit = true`, drops ambient light accordingly, and emits `lantern_out { lantern_id }`.
- **Relight (`!lit && ever_lit`):** Requires only `5` motes (instead of `10`), sets `fuel = 100`, increments `relit_count`, and emits `lantern_lit { lantern_id, relight: true }`.

### 2. Integer `1/60` Fuel Representation
- Fuel is computed internally in integer `1/60` units (`0..6000`, where `6000 === 100.0` fuel, decay is `-1`/tick, shade drain is `-5`/tick, refuel is `+600 * used` capped at `6000`).
- Conversion to float (`round(fuel60 / 60, 1 decimal)`) happens only when serializing snapshots/events.

### 3. Conditional Safe Zone & Shade `drain` State
- A lit lantern provides its `6 m` safe zone **only while `fuel >= 30`** (`fuel60 >= 1800`; `fuel === 30` keeps it). Below `30`, the safe zone is inactive.
- Refueling a lantern back to `>= 30` while shades are inside its `6 m` radius pushes them to the edge over at most `30` ticks with no damage during push-out (same rule as newly lighting a lantern).
- Shades gain a new behavior state `"drain"`:
  - Only `"wander"` shades seek weak lanterns: nearest lit lantern with `fuel < 30` (tie → smaller `id`), falling back to nearest unlit lantern if none. `"chase"` shades do not switch targets.
  - Within `2 m` XZ of that weak lantern, the shade enters `"drain"`, stands still, and drains `5 fuel/s` (`5/60` per tick, stacking across shades, in addition to the lantern's `1/s` self-decay). A `fuel_drain { lantern_id, shade_id, fuel }` event is emitted every `60` ticks while draining.
  - Exits from `"drain"`: → `"chase"` if Mây enters `<= 6 m`; → `"stunned"` if hit by Pulse; → `"wander"` if the lantern goes out, is refueled to `>= 30`, or the shade is `> 2 m` away.

### 4. Dawn Survival Win Rule (No Early Win)
- Night durations are tightened to `240 / 270 / 300 s` (Nights 1 / 2 / 3).
- **No early win:** Lighting all lanterns does not end the Night.
- **Win:** Mây is alive (`flames > 0`) when time reaches `0` (dawn) AND lit lanterns at the final tick `>= ceil(0.6 * total)` (Night 1: `3/5`, Night 2: `4/6`, Night 3: `5/7`). Emits `game_over { result: "won", reason: "dawn_survived" }`.
- **Lose:** `flames <= 0` immediately (`reason: "no_flames"`, taking priority even on the dawn tick), or time reaches `0` with lit count below threshold (`reason: "dawn"`).
- **Tick order:** Step 2 subtracts fuel (decay + drain); right after Step 2, lanterns with `fuel <= 0` extinguish; win/lose check runs at the end of every tick including the dawn tick, checking `no_flames` first.

## Alternatives Considered

1. **Floating-point fuel (`number` in `[0, 100]`):** Simpler to write, but repeated `1/60` subtractions accumulate IEEE-754 rounding error, risking off-by-one-tick extinctions and inconsistent `fuel >= 30` boundary checks across runtimes. Rejected in favor of integer `1/60` units.
2. **Keep permanent safe zone on all lit lanterns:** Would prevent shades from pressuring neglected lanterns, turning fuel into a pure timer without enemy interaction. Rejected.
3. **Hybrid early win (e.g., win if all lit with high fuel):** Still lets skilled players bypass late-Night waves and undermines the "survive to dawn" pacing. Rejected.

## Consequences

- **Positive:** Byte-identical determinism across long runs; sustained tension from start to dawn; meaningful trade-offs between lighting new lanterns, refueling weak ones, and pulsing draining shades (`+15` vs `+5` score).
- **Negative / Migration:** Breaking changes to Contract v1.1 require updating `game.contract.json`, `src/sim/**`, `src/headless/cli.ts`, HUD/renderer, and existing v1.1 tests.

## Replaced v1.1 Rules & Affected Tests

| Old v1.1 Rule | Replaced By (v1.2) | Affected Tests |
|---|---|---|
| `contract_version: "1.1"`, v1.1 tuning table | `contract_version: "1.2"` with fuel/drain/win/capacity keys | `tests/sim.test.ts` (`Contract v1.1 & Purity`) |
| Night durations `300 / 330 / 360 s` | `240 / 270 / 300 s` | `tests/sim.test.ts` (Night setup duration assertions) |
| Lit lanterns accept no more motes; `+10`/mote | Refuel up to `100`, `+5`/mote, relight `5` motes (`+40`) | `tests/sim.test.ts` (deposit/light score assertions) |
| Win immediately when all lanterns lit (`reason: "all_lit"`) | No early win; win at dawn with `>= ceil(0.6 * n)` (`reason: "dawn_survived"`) | `tests/sim.test.ts` (`no_flames > all_lit > dawn`), `tests/cli.test.ts` (`stops early on win`) |
| Score includes `floor(time_left_s) * 2` | Dawn bonus `+50 + floor(fuel)` per lit lantern + `+50` per flame; time bonus removed | `tests/sim.test.ts`, `tests/cli.test.ts` (`score: 210` / `458`) |
| Fixed `carry_capacity = 10` | Dynamic `min(20, 10 + 2 * successful_lights)` | Snapshot assertions expecting player schema |
