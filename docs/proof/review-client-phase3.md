# Phase 3 Client Independent Review (`Ticket-03` / Contract v1.2)

- **Scope:** Read-only audit of `src/main.ts`, `src/renderer/**`, `src/hud/**`, `src/input/**`, `src/audio/**`, `src/ui/**` against `.swarm/specs/ticket-03.md` (sections 1–6) and `src/sim/types.ts` / `src/sim/sim.ts`, plus headless sanity sweep and verification suite.
- **Browser / visual playtest:** `not verified` (headless & static code review only).

---

## 1. Requirements Check Table

| Check | Result | Severity | Evidence & Notes |
| --- | --- | --- | --- |
| **1a.** Safe-zone ring only when `lit && fuel >= 30`; 1 Hz flash at `fuel < 30`; lantern turns dark immediately on `lantern_out` | **OK** | — | `src/renderer/sceneManager.ts:631-636`, `1445-1448`, `1554`, `1566-1608`. `hasSafeZone = l.fuel >= TUNING.low_fuel_threshold` gates `safeRing`/`warmDisc`; `flash1Hz` uses `sin(elapsed * 2π)` (1 Hz) on core emissive, fuel bar opacity, and pooled light; `lantern_out` immediately drops `smoothedLitRatio` and `!l.lit` switches lantern core dark and removes light candidate on the same tick. |
| **1b.** Unlit lantern squashed 20% with torn-paper look (distinguishable without color) | **OK** | — | `src/renderer/sceneManager.ts:1195-1211`, `1571-1573`, `1596-1599`. Unlit lanterns set `coreMesh.scale.set(1.06, 0.8, 1.06)` (20% vertical squash), lower `roofMesh.position.y` from `4.22` to `4.14`, and show `tornGroup` (3 dark hole cones + 3 outward torn paper flaps). |
| **1c.** HUD `carried/capacity` uses `snapshot.player.capacity`; prompt text rules (unlit, refuel with amount, none when full); lit `k/n` and need `ceil(0.6*n)` | **OK** | — | `src/hud/hud.ts:287-303`, `331-365`. Uses `snapshot.player.capacity` (up to `TUNING.capacity_max = 20`); hides prompt when `l.lit && l.fuel >= TUNING.fuel_max`; shows `E - Nap anh sang (deposited/cost)` (5 if `ever_lit`, 10 otherwise) and `E - Cham dau (+gain fuel)`; shows `${litCount} / ${totalLanterns}` and `Cần ${Math.ceil(0.6 * totalLanterns)}/${totalLanterns} đến bình minh`. *(Minor non-blocking note: `Math.round` can print `+0 fuel` when `carried === 0` or `99.5 < fuel < 100`.)* |
| **1d.** End screen uses `dawn_survived` / `dawn` / `no_flames`; score breakdown matches section 5 with no recomputation drift; no early win when all lanterns lit | **DEVIATION** | **Medium** (2 findings: 1 Medium, 1 Low) | Reasons and no-early-win flow are OK (`src/main.ts:229-263, 391-393`; `src/ui/menuController.ts:269-294`). **Drift 1 (Medium):** `src/ui/menuController.ts:315-318` computes dawn fuel bonus as `Math.floor(l.fuel)` on 1-decimal-rounded snapshot fuel, whereas `src/sim/sim.ts:1615` uses `Math.floor(l.fuel_units / 60)` — over-reports `+1` per lantern when `fuel_units % 60 ∈ {57,58,59}` (repro below: `simScore=447` vs breakdown `450`). **Drift 2 (Low):** `src/main.ts:278-285, 366-373` caches draining shades before `sim.step()`, which drifts `+10` if `interact` (Step 5) pushes a draining shade to `wander` on the same tick `pulse` (Step 7) fires (`src/sim/sim.ts:1016-1026, 1056-1066`). |
| **1e.** Colorblind toggle: shade outline/eyes `#00B3FF`, UI warning `#FFFFFF` with icon, persisted in `localStorage` with `try/catch`, applies live | **OK** | — | `src/renderer/palette.ts:74-79`, `src/renderer/sceneManager.ts:494-498, 1693, 1751-1830`, `src/hud/hud.css:37-41, 198-228, 243-260, 611-613`, `src/hud/hud.ts:11, 68, 72`, `src/ui/menuController.ts:35, 220-226, 254-258, 283-285`, `src/ui/settings.ts:34-56`, `src/main.ts:27-30, 54, 209`. *(Minor note: `.hud-lantern-req.below` at `src/hud/hud.ts:290` / `src/hud/hud.css:315-317` turns `--color-danger` without its own icon, though it only activates alongside the urgent timer which renders `WARNING_SVG`.)* |
| **1f.** Client never mutates sim state; never uses `Math.random` for anything sim reads; pause sends pause input once per press | **DEVIATION** | **Medium** (1 finding: Medium) | Sim immutability and `Math.random` isolation are OK (`Math.random` appears only in visual/audio pools: `sceneManager.ts:472-476, 791-793`, `mothCompanion.ts:216-225`, `soundEffects.ts:114`). Pause press is edge-gated (`!e.repeat` at `src/input/inputManager.ts:219-223`). **Deviation (Medium):** `src/main.ts:113-132` (`sendPauseToggleToSim`) steps the sim and drains events on resume without running `handleGameOver`, `runStats`, or audio dispatch. Resuming on the final tick (`time_left_s === 1/60`) discards `game_over`, leaves the pause menu up on a finished sim, and clicking Resume hides the menu onto a frozen canvas. |
| **1g.** Interpolation/camera consistent with respawn, night start, and pad launch snapping | **OK** | — | `src/main.ts:101, 292-301`, `src/renderer/sceneManager.ts:503-513, 569-570, 578-600, 2025-2042`, `src/sim/maps.ts:78, 86, 132`. Night start calls `scene.reset(snap)`; fall respawn exceeds `TELEPORT_SNAP_DIST_SQ` (`4.0`); all jump pads have `launch_vy` 12–14 (`vel[1] > 9.5` after 1 tick of gravity vs normal jump `6.67`), triggering `forceSnap = true` in `scene.onSimStep`. |

---

## 2. Detailed Deviation Findings

### D1 (Medium) — End-screen dawn fuel bonus can drift from `sim.score` (`Check 1d`)
- **Location:** `src/ui/menuController.ts:315-318` vs `src/sim/sim.ts:1612-1616, 1731`
- **Cause:** `sim.ts` computes dawn lantern bonus using integer `Math.floor(l.fuel_units / 60)`, then exports `l.fuel` rounded to 1 decimal (`Math.round((units * 10) / 60) / 10`). `menuController.ts` computes `Math.floor(l.fuel)` from the rounded snapshot value.
- **Concrete failing situation:** Any lit lantern ending the night with `fuel_units % 60 ∈ {57, 58, 59}` (e.g. `2999` units = `49.9833`, exported as `fuel: 50`) awards `50 + 49 = 99` in sim, but `menuController.ts` displays `50 + 50 = 100` (`+1` drift per lantern, up to `+7` on Night 3).
- **Repro output:**
```text
{
  snapshotFuels: [ 50, 50, 50 ],
  simScore: 447,
  clientBreakdownSum: 450,
  drift: 3
}
```

### D2 (Medium) — Resume tick in `sendPauseToggleToSim` drops `game_over`, `runStats`, and SFX (`Check 1f`)
- **Location:** `src/main.ts:113-132`
- **Cause:** On resume, `sendPauseToggleToSim()` executes `sim.step({ pause: true })` (which runs a full gameplay tick in `sim.ts:571-1635`) and immediately calls `sim.drainEvents()`, passing events only to `scene.handleEvents` and `hud.onEvents` while skipping the `switch (ev.name)` handler (`runStats`, audio SFX, and `handleGameOver`). Additionally, `heldInput.pause` remains `true` until the next `requestAnimationFrame` calls `input.consumeStepInput()`, so two Esc/P presses within a single frame after resume fail to re-pause while advancing the sim by 1 tick.
- **Concrete failing situation:** Player pauses with 1 tick left before dawn (`time_left_s = 1/60`) and presses Resume (or `Esc`/`P`). `sim.step({ pause: true })` triggers `game_over` (`dawn_survived` or `dawn`), `drainEvents()` discards it, `after.state` is `"won"` or `"lost"` (neither `"paused"` nor `"playing"`), so the pause menu stays open; clicking Resume again invokes `enterPlaying()` and freezes the user on an ended game with no result screen.

### D3 (Low) — Simultaneous `interact` + `pulse` on same tick drifts draining-shade pulse breakdown (`Check 1d`)
- **Location:** `src/main.ts:278-285, 366-373` vs `src/sim/sim.ts:1016-1026, 1056-1066, 1144-1155`
- **Cause:** `main.ts` records `drainingShadesBeforeStep` prior to `sim.step()`. Inside `sim.step()`, Step 5 (`interact`) can relight or refuel a lantern to `>= 30` and transition nearby draining shades to `"wander"` before Step 7 (`pulse`) checks `shade.state === "drain"`.
- **Concrete failing situation:** Player presses `E` (relight/refuel to `>= 30`) and `Q`/RMB (`pulse`) on the same tick near a draining shade. Sim awards `+5` (non-draining), while `main.ts` attributes `+15` (`shadesPulsedDraining += 1`), causing a `+10` breakdown drift against `snap.score`.

---

## 3. Headless Sanity Sweep

### 3.1 Nights 1–3 Full-Duration Determinism Sweep (`seed = 42`, no inputs)

Commands run:
```bash
npx tsx src/headless/cli.ts --seed 42 --night 1 --ticks 14400 --out /tmp/rev-n1-a.jsonl
npx tsx src/headless/cli.ts --seed 42 --night 1 --ticks 14400 --out /tmp/rev-n1-b.jsonl
cmp /tmp/rev-n1-a.jsonl /tmp/rev-n1-b.jsonl

npx tsx src/headless/cli.ts --seed 42 --night 2 --ticks 16200 --out /tmp/rev-n2-a.jsonl
npx tsx src/headless/cli.ts --seed 42 --night 2 --ticks 16200 --out /tmp/rev-n2-b.jsonl
cmp /tmp/rev-n2-a.jsonl /tmp/rev-n2-b.jsonl

npx tsx src/headless/cli.ts --seed 42 --night 3 --ticks 18000 --out /tmp/rev-n3-a.jsonl
npx tsx src/headless/cli.ts --seed 42 --night 3 --ticks 18000 --out /tmp/rev-n3-b.jsonl
cmp /tmp/rev-n3-a.jsonl /tmp/rev-n3-b.jsonl
```

Results:

| Night | Ticks Requested | `game_over` Event | `end` Line | Byte-Identical (`cmp` + SHA-256) |
| --- | --- | --- | --- | --- |
| **Night 1** | 14400 (240 s) | `{"type":"event","tick":14400,"name":"game_over","data":{"result":"lost","reason":"dawn"}}` | `{"type":"end","ticks":14400,"state":"lost","score":0}` | **YES** (`e8b4afb8729ddd13760e43e69243bcd76dce8a98c9cc143e109dfb8f518dd502`) |
| **Night 2** | 16200 (270 s) | `{"type":"event","tick":16200,"name":"game_over","data":{"result":"lost","reason":"dawn"}}` | `{"type":"end","ticks":16200,"state":"lost","score":0}` | **YES** (`536dfd14ebe4b4187761623363cda92f25c498a4059743c62791af5166609018`) |
| **Night 3** | 18000 (300 s) | `{"type":"event","tick":7629,"name":"game_over","data":{"result":"lost","reason":"no_flames"}}` | `{"type":"end","ticks":7629,"state":"lost","score":0}` | **YES** (`e933ae9e17c688b9d335311dfe0f4cd8b25e50fd0c4a03bb8cedf7b6b4beeb2c`) |

> **Honest note on Night 3:** With default Night 3 random shades and wind gusts and no player inputs, May is hit by shades at ticks `7449`, `7539`, and `7629` (`flames: 2 -> 1 -> 0`), ending early with `state: "lost", reason: "no_flames"` rather than reaching `dawn` at tick 18000. Both runs are byte-identical and emit a valid `end` line.

### 3.2 Night 1 Light-One-Lantern + `lantern_out` (~100 s later) Script

Saved scenario & input files:
- `docs/proof/scenarios/review-n1-light-and-out.json`:
```json
{
  "player": {
    "pos": [0, 0, 23.5],
    "carried": 10
  },
  "random_motes": false,
  "random_shades": false
}
```
- `docs/proof/scenarios/review-n1-light-and-out-inputs.json`:
```json
{
  "frames": [
    { "tick": 1, "interact": true },
    { "tick": 2, "interact": false }
  ]
}
```

Command & output:
```bash
npx tsx src/headless/cli.ts --seed 42 --night 1 --ticks 6100 \
  --scenario docs/proof/scenarios/review-n1-light-and-out.json \
  --inputs docs/proof/scenarios/review-n1-light-and-out-inputs.json \
  --snapshot-every 3000 \
  --out /tmp/rev-n1-light-out.jsonl
```
```json
{"type":"event","tick":1,"name":"night_start","data":{"night":1}}
{"type":"event","tick":2,"name":"deposit","data":{"lantern_id":"L1","amount":10,"deposited":10}}
{"type":"event","tick":2,"name":"lantern_lit","data":{"lantern_id":"L1","relight":false}}
{"type":"event","tick":6002,"name":"lantern_out","data":{"lantern_id":"L1"}}
{"type":"end","ticks":6100,"state":"playing","score":150}
```
`L1` is lit at tick `2` (`fuel = 100`) and emits `lantern_out` at tick `6002` — exactly `6000` ticks (`100.0 s`) later.

---

## 4. Verification Command Output (`npm run typecheck && npm test && npm run verify`)

```text
> dao-den-long@0.1.0 typecheck
> tsc --noEmit

> dao-den-long@0.1.0 test
> vitest run

 RUN  v5.1.1 /Users/zan/PROJECTS/VinUni/K5-L3-LAB-Day12-AI-SDLC

 ✓ tests/sim.test.ts (33 tests) 62ms
 ✓ tests/cli.test.ts (7 tests) 5861ms
   ✓ Headless CLI v1.2 (7)
     ✓ writes v1.2 snapshots (capacity, lantern fuel/ever_lit/relit_count, night, wind, motes/drifters/charms) and night_start event 578ms
     ✓ wins at dawn with dawn_survived, writes final snapshot, and ends with v1.2 dawn score 363ms
     ✓ continues stepping through paused state and emits paused/resumed events 425ms
     ✓ produces byte-identical output across runs for Nights 1, 2, and 3 2486ms
     ✓ exits with code 2 and stderr message on non-strictly-increasing inputs 460ms
     ✓ exits with code 2 on malformed JSON or invalid v1.1 scenario/input fields 775ms
     ✓ exits non-zero on unsupported --night or missing required CLI flags 774ms

 Test Files  2 passed (2)
      Tests  40 passed (40)

> dao-den-long@0.1.0 verify
> npm run typecheck && npm run test && bash scripts/verify.sh

 ✓ tests/sim.test.ts (33 tests) 58ms
 ✓ tests/cli.test.ts (7 tests) 5588ms
 Test Files  2 passed (2)
      Tests  40 passed (40)

PASS: scenario mote-pickup yields mote_picked at tick 43
PASS: scenario no-early-win lights all 5 lanterns without ending Night early
PASS: scenario pulse-and-hit pulses S1 then takes shade hit after stun expires
PASS: scenario dash emits dash event and travels 2.8m in 12 ticks
PASS: scenario fall-respawn triggers fall penalty (lost:4) and respawns at [0,0,0]
PASS: scenario jump-pad launches player from Night 2 JP1 and lands on Island B
PASS: scenario wind activates Night 3 gust at sim_tick 1800
PASS: scenario drifter steals 3 motes then drops them when pulsed while fleeing
PASS: scenario charm picks up C1 and allows back-to-back dashes with 0 cooldown
PASS: scenario pause-resume freezes sim_tick during pause and resumes cleanly
PASS: scenario safe-zone-push ejects shade on lantern_lit with no player damage
PASS: scenario pulse-standard hits 3D target S1, ignores out-of-range S2, awards +5 score
PASS: scenario night1-load boots Night 1 and emits night_start
PASS: scenario night2-load boots Night 2 and emits night_start
PASS: scenario night3-load boots Night 3 and emits night_start
PASS: determinism: Night 1 seed 42 runs are byte-identical
PASS: determinism: Night 2 seed 42 runs are byte-identical
PASS: determinism: Night 3 seed 42 runs are byte-identical
PASS: bad inputs file exits with code 2 and stderr message
PASS: scenario fuel-decay decays L1 at 1.0/s (99 at 60t, 90 at 600t)
PASS: scenario refuel-math skips full L1, refuels L2 with 2 motes capped at 100, ignores subsequent full interact
PASS: scenario lantern-out-relight turns off L1 at tick 30 and relights with 5 motes at tick 35
PASS: scenario safe-zone-threshold verified at fuel 30 vs 29.9
PASS: scenario shade-drain-stacking targets weak L1 and emits fuel_drain for stacked shades S1 and S2
PASS: scenario drain-transitions handles drain->stunned (+15) and drain->chase (<6m)
PASS: scenario refuel-pushout refuels L1 >= 30 and ejects shade with no player damage
PASS: scenario dawn-win-n1 wins at dawn with reason dawn_survived
PASS: scenario dawn-win-n2 wins at dawn with reason dawn_survived
PASS: scenario dawn-win-n3 wins at dawn with reason dawn_survived
PASS: scenario no-flames-dawn prioritizes no_flames over dawn_survived on dawn tick
PASS: scenario capacity-growth grows from 18 to cap 20 and respects pickup limit
PASS: scenario score-v12 matches exact v1.2 score formula (666)
PASS: scenario scenario-defaults defaults lit:true to fuel 100, ever_lit true, 0 events, 0 score
PASS: performance: Night 3 18000 ticks completed in 577ms (<= 30000ms)
ALL VERIFY CHECKS PASSED
```
