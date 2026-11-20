# Changelog

All notable changes across the 4-phase SDLC of **Đảo Đèn Lồng (Lantern Island)** are documented in this file.

---

## Phase 3 (`phase-3`) — Ticket-03 "Đèn cạn dầu" (Contract v1.2)

### Breaking Changes (v1.1 → v1.2)
- **Win rule (`[REPLACE]`):** Lighting all lanterns no longer ends the Night early. Win requires Mây alive (`flames > 0`) at dawn (`time_left_s === 0`) with lit lanterns `>= ceil(0.6 * total)` (Night 1: `3/5`, Night 2: `4/6`, Night 3: `5/7`).
- **`game_over.reason`:** Added `"dawn_survived"` for wins; `"all_lit"` is removed and no longer emitted. Loss reasons remain `"no_flames"` (checked first, even on the dawn tick) and `"dawn"` (below lit threshold at time up).
- **Score formula (`[REPLACE]`):**
  - `+5` per mote deposited (new light, relight, or refuel; previously `+10`).
  - `+100` for first lighting of a lantern; `+40` for relighting an `ever_lit` lantern.
  - Shade hit by Pulse: `+5` per shade, or `+15` total if the shade was in `"drain"` state just before being hit.
  - Dawn bonus (win only): `+50 + floor(fuel)` per lit lantern and `+50` per remaining flame.
  - Removed time-left bonus (`floor(seconds_left) * 2`).
- **Carry capacity:** Changed from fixed `10` to dynamic `capacity = min(20, 10 + 2 * successful_lights)` per Night (relights count; scenario pre-lit lanterns do not; resets to `0` successful lights at the start of each Night).
- **Lantern fuel & safe zone (`[REPLACE]`):**
  - Lit lanterns start at `fuel = 100` and decay at `1.0 fuel/s` (`1/60` per tick, computed in integer `1/60` units).
  - Lit, non-full lanterns accept refueling on Interact: `used = min(carried, ceil((100 - fuel) / 10))`, `fuel = min(100, fuel + 10 * used)`. Full lanterns (`used === 0`) are not selectable, emit no event, and give no score.
  - At `fuel <= 0`, lantern turns off (`deposited = 0`, `ever_lit = true`), ambient light drops, and `lantern_out` is emitted. Relighting an `ever_lit` lantern costs `5` motes (never-lit still costs `10`).
  - Safe zone (`6 m`) is active only while `fuel >= 30` (lost when `fuel < 30`; refueling to `>= 30` ejects shades inside `6 m` over `<= 30` ticks with no damage).
- **Shade `drain` state (`[REPLACE]`):** `"wander"` shades target the nearest lit lantern with `fuel < 30` (tie → smaller `id`), falling back to nearest unlit lantern. Within `2 m` XZ they enter `"drain"`, stand still, and drain `5 fuel/s` (stacking across shades, plus `1/s` self-decay).
- **Night durations:** Shortened from `300 / 330 / 360 s` to `240 / 270 / 300 s`.
- **Contract & Tuning (`game.contract.json`):**
  - `contract_version` bumped to `"1.2"`.
  - Updated `night1_duration_s: 240`, `night2_duration_s: 270`, `night3_duration_s: 300`, and updated `score` keys.
  - Added tuning keys: `fuel_max: 100`, `fuel_decay_per_s: 1.0`, `fuel_per_mote: 10`, `relight_cost: 5`, `win_ratio: 0.6`, `drain_per_s: 5`, `low_fuel_threshold: 30`, `capacity_max: 20`.
- **Snapshot, Scenario & Event schema:**
  - Snapshot: `lanterns[]` adds `fuel` (float, 1 decimal; `0` when unlit), `ever_lit`, `relit_count`; `player` adds `capacity`; `shades[].state` adds `"drain"`.
  - Scenario: `lanterns[]` adds `lit`, `fuel` (defaults to `100` if `lit: true` and omitted), `ever_lit`; `player` adds `successful_lights`; `shades[]` adds `target_lantern_id`.
  - Events: added `refuel { lantern_id, amount, fuel }`, `lantern_out { lantern_id }`, `fuel_drain { lantern_id, shade_id, fuel }` (every 60 ticks while draining); `lantern_lit` adds `relight: boolean`.

### Added
- **Color-blind mode ("Bảng màu dễ phân biệt"):** Persisted setting switching shade outline/eyes `#7A3CFF -> #00B3FF` and UI warning `#FF5A5F -> #FFFFFF` with a warning icon; non-color lantern cues (unlit squashed 20% with torn paper; low-fuel lantern + fuel bar flashing at `1 Hz`).
- **Design documentation:** `docs/notes/adr-0001-lantern-fuel-and-dawn-win.md` and `docs/notes/spec-phase3.md`.

---

## Phase 2 (`phase-2`) — Ticket-02 "Ba hòn đảo" (Contract v1.1)

### Changed (v1.0 → v1.1)
- Standardized all Part 1 physics/combat/scoring numbers (`player_speed: 6.0`, `carry_capacity: 10`, `lantern_cost: 10`, `pickup_radius: 1.0`, `interact_radius: 2.0`, `pulse_cost: 3`, `pulse_radius: 5.0` 3D, `invuln_s: 1.5`, `shade_speed: 4.0` / Night 3 `4.5`, `fall_enabled: true`, score on deposit `+10/mote`, etc.).
- Renamed Shade states to `spawning | wander | chase | recoil | stunned`; standardized 12-step tick order.
- Extended CLI and `Sim` to `--night 1|2|3` with v1.1 snapshot arrays (`motes`, `drifters`, `charms`) and `wind` state.

### Added
- 3-Night campaign: Night 1 **Đảo Bến**, Night 2 **Đảo Cầu** (2 islands, bamboo bridge, jump pads), Night 3 **Đảo Chuông** (3 tiers, ramps, bell tower, jump pad, periodic wind gusts).
- Dash (`Shift`), Drifter ("Gió Lạc"), Wind Charm ("Bùa Gió"), Pause menu (`Esc`/`P`), persisted Settings, WebAudio soundtrack & SFX, full HUD with off-screen lantern arrow, and standard palette.
- Harness & docs: `AGENTS.md`, `.claude/skills/headless-proof/SKILL.md`, `docs/notes/design-phase2.md`, `docs/notes/assumptions-phase2.md`, `docs/notes/ai-log.md`, `docs/proof/phase-2.md`.

---

## Phase 1 (`phase-1`) — PRD-0 (Contract v1.0)

### Added
- Pure deterministic 60 ticks/s simulation (`src/sim/**`) and headless CLI (`src/headless/cli.ts`) conforming to Test Contract v1.0 (`game.contract.json`).
- Night 1 playable 3D client (Three.js + TypeScript) with third-person camera, mote pickup, lantern lighting, Pulse stun, Shade AI, HUD, and creativity feature (**Bướm Đèn / Lantern Moth Companion**, renderer-only).
- Automated verification suite (`vitest`, `scripts/verify.sh`) and Phase 1 proof (`docs/proof/phase-1.md`).
