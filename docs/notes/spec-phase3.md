# Đảo Đèn Lồng — Phase 3 Spec & Acceptance Criteria (Ticket-03, Contract v1.2)

Authoritative upstream: `.swarm/specs/ticket-03.md` (Phase 3, tag `phase-3`, Contract v1.2).  
Design record: `docs/notes/adr-0001-lantern-fuel-and-dawn-win.md`.  
Units: meters (`m`), seconds (`s`), `Y` up, fixed `60` ticks/s (`dt = 1 / 60` s).

---

## 1. Lantern Fuel (`[REPLACE]` "lit lantern accepts no more motes")

- **AC-1.1 (Initial & max fuel):** **Given** an unlit lantern (`ever_lit: false`) with `deposited = 9` and Mây carrying `>= 1` mote within `2.0 m` XZ, **when** Mây presses Interact, **then** the lantern becomes `lit = true`, `ever_lit = true`, `fuel = 100.0` (internal `6000` in `1/60` units), and `lantern_lit { lantern_id, relight: false }` is emitted.
- **AC-1.2 (Self-decay & integer precision):** **Given** a lit lantern at `fuel = 100.0` with no draining shades, **when** `60` sim ticks elapse, **then** internal fuel decreases by `1` per tick (`6000 -> 5940`) and output `fuel` is `99.0` (exact `1.0 / s` with zero floating-point drift; rounded to 1 decimal only on output).
- **AC-1.3 (Refuel math & cap):** **Given** a lit lantern with `fuel = 75.0` and Mây carrying `5` motes within `2.0 m` XZ, **when** Mây presses Interact, **then** `used = min(5, ceil((100 - 75) / 10)) = 3`, `fuel` becomes `min(100, 75 + 30) = 100.0`, `player.carried` decreases by `3`, and `refuel { lantern_id, amount: 3, fuel: 100 }` is emitted.
- **AC-1.4 (Full lantern non-selectable):** **Given** a lit lantern at `fuel = 100.0` (`used = 0`), **when** Mây presses Interact within `2.0 m` XZ with no other receivable lantern in range, **then** nothing is deposited, no `refuel` or `deposit` event is emitted, and no score is awarded.
- **AC-1.5 (Selection priority):** **Given** multiple lanterns within `2.0 m` XZ (some full, some unlit or lit with `fuel < 100`), **when** Mây presses Interact, **then** only receivable lanterns (unlit, or lit and not full) are considered; nearest XZ wins, with ties broken by smaller `id`.
- **AC-1.6 (Out of fuel):** **Given** a lit lantern whose internal fuel reaches `<= 0` during Step 2, **when** the post-Step-2 extinction pass runs, **then** `lit` becomes `false`, `fuel = 0`, `deposited = 0`, `ever_lit` remains `true`, `lantern_out { lantern_id }` is emitted, and client ambient light drops according to `0.15 + 0.55 * (lit / total)`.
- **AC-1.7 (Relight cost):** **Given** an unlit lantern with `ever_lit: true`, **when** Mây deposits `5` motes (in one or more interacts), **then** it relights to `fuel = 100.0`, increments `relit_count`, and emits `lantern_lit { lantern_id, relight: true }`. A never-lit lantern (`ever_lit: false`) still requires `10` motes.
- **AC-1.8 (Visual fuel bar & low-fuel flash):** **Given** a lit lantern in the 3D client, **when** `fuel >= 30`, **then** its fuel bar renders steadily; **when** `fuel < 30`, **then** both the lantern and its fuel bar flash at `1 Hz`.

---

## 2. Shades Drain Fuel (`[REPLACE]` "shades never enter safe zone")

- **AC-2.1 (Safe zone threshold):** **Given** a lit lantern, **when** `fuel >= 30` (including exactly `fuel === 30.0`), **then** its `6.0 m` safe zone blocks shades; **when** `fuel < 30`, **then** its safe zone is inactive and shades may enter.
- **AC-2.2 (Weak-lantern targeting for `wander` only):** **Given** a shade in state `"wander"`, **when** one or more lit lanterns have `fuel < 30`, **then** it moves toward the nearest such lantern (tie → smaller `id`); if none exist, it targets the nearest unlit lantern as before. **Given** a shade in state `"chase"`, **when** a lantern drops below `fuel = 30`, **then** the shade keeps chasing Mây and does not switch target.
- **AC-2.3 (Entering `drain` & stacking):** **Given** a `"wander"` shade approaching a lit lantern with `fuel < 30`, **when** XZ distance to that lantern is `<= 2.0 m`, **then** the shade enters state `"drain"`, stands still, and drains `5 fuel/s` (`5/60` per tick). With `k` shades draining the same lantern, total loss is `(1 + 5k) / 60` per tick (self-decay `1/s` + `5/s` per shade). Every `60` ticks while draining, `fuel_drain { lantern_id, shade_id, fuel }` is emitted.
- **AC-2.4 (Exits from `drain`):** **Given** a shade in state `"drain"`, **when**:
  - Mây enters within `6.0 m` XZ → transitions to `"chase"`.
  - Hit by Pulse → transitions to `"stunned"` (and when stun ends → `"wander"`).
  - Target lantern goes out (`!lit`), or is refueled to `fuel >= 30`, or shade is `> 2.0 m` XZ away → transitions to `"wander"`.
- **AC-2.5 (Refuel safe-zone push-out):** **Given** a lit lantern with `fuel < 30` and one or more shades inside its `6.0 m` radius, **when** Mây refuels the lantern to `fuel >= 30`, **then** those shades are pushed to the `6.0 m` edge over at most `30` ticks and deal no damage during push-out.

---

## 3. New Win Rule (`[REPLACE]` "win as soon as all lanterns lit")

- **AC-3.1 (Night durations):** **Given** a new Night without scenario `time_left_s` override, **when** initialized, **then** duration is `240 s` (Night 1), `270 s` (Night 2), and `300 s` (Night 3).
- **AC-3.2 (No early win):** **Given** `time_left_s > 0` and `flames > 0`, **when** all lanterns in the Night become lit, **then** `state` remains `"playing"` and no `game_over` event is emitted.
- **AC-3.3 (Dawn survival win):** **Given** `flames > 0` on the final tick (`remaining_ticks === 0`), **when** the count of lit lanterns after all updates of that tick is `>= ceil(0.6 * total)` (Night 1: `>= 3/5`, Night 2: `>= 4/6`, Night 3: `>= 5/7`), **then** `state` becomes `"won"` and `game_over { result: "won", reason: "dawn_survived" }` is emitted.
- **AC-3.4 (Dawn loss below threshold):** **Given** `flames > 0` on the final tick (`remaining_ticks === 0`), **when** lit lanterns `< ceil(0.6 * total)` (including if a lantern extinguished right after Step 2 on that tick), **then** `state` becomes `"lost"` and `game_over { result: "lost", reason: "dawn" }` is emitted.
- **AC-3.5 (No flames priority):** **Given** `flames` reaches `0` on any tick (including the dawn tick with `>= ceil(0.6 * total)` lit lanterns), **when** the end-of-tick win/lose check runs, **then** `state` becomes `"lost"` immediately with `game_over { result: "lost", reason: "no_flames" }`.
- **AC-3.6 (Tick order):** **Given** the Ticket-02 12-step tick order, **when** executing a sim tick, **then** Step 2 subtracts lantern fuel (self-decay + shade drain), immediately after Step 2 lanterns with `fuel <= 0` turn off, and Step 11 win/lose check runs after all updates of the tick (including the dawn tick).

---

## 4. Growing Capacity (New)

- **AC-4.1 (Formula & cap):** **Given** `successful_lights` successful lightings in the current Night, **when** computing carry capacity, **then** `player.capacity = min(20, 10 + 2 * successful_lights)`.
- **AC-4.2 (What counts):** **Given** a Night in progress, **when** Mây lights a never-lit lantern OR relights an `ever_lit` lantern, **then** `successful_lights` increments by `1`. Lanterns pre-set as `lit: true` in a scenario do **not** increment `successful_lights` (unless `scenario.player.successful_lights` is explicitly set).
- **AC-4.3 (Night reset & HUD):** **Given** a new Night starts, **when** initialized, **then** `successful_lights = 0` (`capacity = 10`), and the HUD displays `carried / capacity`.

---

## 5. New Score (`[REPLACE]` whole old formula)

- **AC-5.1 (Deposit / Refuel):** **Given** Mây deposits `k` motes (new light, relight, or refuel), **when** Step 5 completes, **then** `score += 5 * k`.
- **AC-5.2 (Light & Relight bonus):** **Given** a lantern finishes lighting, **when** `relight === false`, **then** `score += 100`; **when** `relight === true`, **then** `score += 40`.
- **AC-5.3 (Pulse bonus):** **Given** Pulse hits shades, **when** a hit shade was NOT in `"drain"` just before Pulse, **then** `score += 5`; **when** a hit shade WAS in `"drain"` just before Pulse, **then** `score += 15` total (not `5 + 15`).
- **AC-5.4 (Dawn win bonus & no time bonus):** **Given** the Night ends with `result: "won", reason: "dawn_survived"`, **when** final score is computed, **then** `score += sum(50 + floor(l.fuel) for lit l) + 50 * player.flames`, and no time-left bonus is added. On loss, no dawn bonus is added. Campaign total remains the sum of won Nights' scores.

---

## 6. Color-Blind Mode (New)

- **AC-6.1 (Persisted setting):** **Given** the Settings panel (Main Menu & Pause Menu), **when** the player toggles `"Bảng màu dễ phân biệt"`, **then** the preference persists across reloads in `localStorage`.
- **AC-6.2 (Color swaps & warning icon):** **Given** `"Bảng màu dễ phân biệt"` is enabled, **when** rendering scene and HUD, **then** Shade outline and eyes use `#00B3FF` (instead of `#7A3CFF`), and UI warnings use `#FFFFFF` paired with a warning icon (instead of `#FF5A5F`).
- **AC-6.3 (Non-color lantern cues):** **Given** either palette mode, **when** viewing lanterns, **then** unlit lanterns are squashed `20%` vertically and show torn paper so lit vs unlit is distinguishable without color, and lanterns with `fuel < 30` flash at `1 Hz`.

---

## 7. Contract v1.2 Schema Additions (Summary)

- `game.contract.json`: `contract_version: "1.2"`, `night1_duration_s: 240`, `night2_duration_s: 270`, `night3_duration_s: 300`, plus `fuel_max: 100`, `fuel_decay_per_s: 1.0`, `fuel_per_mote: 10`, `relight_cost: 5`, `win_ratio: 0.6`, `drain_per_s: 5`, `low_fuel_threshold: 30`, `capacity_max: 20`.
- Snapshot: `lanterns[]` adds `fuel` (1 decimal float; `0` if unlit), `ever_lit`, `relit_count`; `player` adds `capacity`; `shades[].state` adds `"drain"`.
- Scenario: `lanterns[]` adds `lit`, `fuel` (defaults to `100` if `lit: true` and omitted), `ever_lit`; `player` adds `successful_lights`; `shades[]` adds `target_lantern_id`.
- Events: `refuel { lantern_id, amount, fuel }`, `lantern_out { lantern_id }`, `fuel_drain { lantern_id, shade_id, fuel }` (every 60 ticks), `lantern_lit { lantern_id, relight }`, `game_over.reason` adds `"dawn_survived"` and removes `"all_lit"`.

---

## 8. Phase 2 Tests & Rules Affected

All affected tests must be updated with an explicit reason (never silently skipped):

| File | Existing Phase 2 Test / Rule | Why Affected by Ticket-03 | Required Update |
|---|---|---|---|
| `tests/sim.test.ts` | `Contract v1.1 & Purity` (`contract_version === "1.1"`) | Contract bumped to `"1.2"` with new tuning keys | Assert `contract_version === "1.2"` and v1.2 `TUNING` parity |
| `tests/sim.test.ts` | `loads each Night with correct ... duration` (`300 / 330 / 360`) | Night durations changed to `240 / 270 / 300 s` | Update expected `time_left_s` to `240 / 270 / 300` |
| `tests/sim.test.ts` | `deposits motes (+10/mote), lights lantern (+100)...` (`score === 110`) | Deposit score changed from `+10` to `+5`/mote; `lantern_lit` adds `relight` | Expect `score === 105`, `relight: false`, `fuel === 100`, `capacity === 12` |
| `tests/sim.test.ts` | `prioritizes no_flames > all_lit > dawn, and allows winning on exact tick time runs out` | `all_lit` removed; no early win; dawn survival requires `>= ceil(0.6 * n)` with `reason: "dawn_survived"` and dawn fuel+flame score | Update to test `no_flames > dawn_survived / dawn`, verify no early win when all lit with `time_left_s > 0`, and assert v1.2 dawn score |
| `tests/cli.test.ts` | `stops early on win, writes final off-interval snapshot, and ends with v1.1 score` (`win-lantern.json`, `score: 458`) | Lighting the last lantern with time remaining no longer triggers early win (`all_lit` removed) | Replace/update scenario & assertion to test dawn survival win (`dawn_survived`) with v1.2 score and verify all-lit mid-night keeps `state: "playing"` |
| `tests/cli.test.ts` | `writes v1.1 snapshots...` | Snapshot adds `player.capacity` and `lanterns[].{fuel, ever_lit, relit_count}` | Assert v1.2 snapshot fields |
| `tests/cli.test.ts` | `exits with code 2 on ... invalid v1.1 scenario/input fields` | `"drain"` is now a valid shade state; new v1.2 scenario fields validated | Keep invalid-state exit-2 check; add validation coverage for v1.2 scenario fields |
