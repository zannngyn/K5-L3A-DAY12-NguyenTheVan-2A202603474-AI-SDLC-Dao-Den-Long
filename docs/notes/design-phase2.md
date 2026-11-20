# Dao Den Long (Lantern Island) — Phase 2 Implementation Spec ("Ba hon dao")

Authoritative upstream: `.swarm/specs/ticket-02.md` (Phase 2, Contract v1.1, tag `phase-2`) and `.swarm/specs/prd-and-contract.md` (v1.0 base).  
Supersedes: `.swarm/specs/design.md` (Phase 1).  
Units: meters (`m`), seconds (`s`), `Y` up, fixed `60` ticks/s (`dt = 1 / 60` s). Angles measured from `+X` axis via `x = r * cos(θ), z = r * sin(θ)`.

---

## 1. Tuning Table v1.1 (`game.contract.json`)

`contract_version` is `"1.1"`. All v1.0 keys are retained; 5 new keys are added (`dash_speed`, `dash_duration_s`, `dash_cooldown_s`, `night2_duration_s`, `night3_duration_s`).

| Key | v1.1 Value | Unit / Type | v1.0 → v1.1 Note |
| --- | ---: | --- | --- |
| `player_speed` | `6.0` | m/s | Changed from `7.0`; `7.2` m/s while Wind Charm is active |
| `carry_capacity` | `10` | motes | Changed from `5` (1 full load lights 1 lantern) |
| `lantern_cost` | `10` | motes | Changed from `5`; partial deposits persist |
| `lantern_count_night1` | `5` | count | Unchanged (Night 2 = `6`, Night 3 = `7`) |
| `pickup_radius` | `1.0` | m | Changed from `1.8`; also requires `|player.y - mote.y| <= 1.5` m |
| `interact_radius` | `2.0` | m | Changed from `3.0`; XZ distance to nearest unlit lantern |
| `pulse_cost` | `3` | motes | Changed from `1`; `< 3` carried = silent no-op |
| `pulse_radius` | `5.0` | m | Changed from `8.0`; **3D** distance from `(player.x, player.y + 0.8, player.z)` to target center |
| `night1_duration_s` | `300` | s | Changed from `240` (`18,000` ticks) |
| `night2_duration_s` | `330` | s | **New** (`19,800` ticks) |
| `night3_duration_s` | `360` | s | **New** (`21,600` ticks) |
| `flames` | `3` | HP | Unchanged; refilled to `3` at the start of each Night |
| `invuln_s` | `1.5` | s | Changed from `2.0` (`90` ticks after shade hit or fall respawn) |
| `hit_drop_ratio` | `0.5` | ratio | Concept changed: drops `Math.floor(carried * 0.5)` motes onto ground ring `1.5–2.5` m around Mây (`ttl = 480` ticks, pickable from next tick) instead of `ceil` extinguished |
| `pulse_stun_s` | `2.0` | s | Changed from `2.5` (`120` ticks); refreshes if already stunned |
| `pulse_push_m` | `4.0` | m | Changed from `6.0`; pushed horizontally over first `15` ticks (stops on obstacle), not instant |
| `pulse_cooldown_s` | `3.0` | s | Unchanged (`180` ticks) |
| `safe_radius` | `6.0` | m | Concept refined: shades outside blocked at `6.0` m edge; shade inside when lantern is just lit is pushed to edge over `<= 30` ticks with no damage during push-out |
| `shade_speed` | `4.0` | m/s | Changed from `4.5` (Night 1 & 2 = `4.0` m/s; Night 3 = `4.5` m/s) |
| `shade_hit_radius` | `1.0` | m | Changed from `1.2`; also requires `|player.y - shade.y| <= 1.5` m |
| `fall_enabled` | `true` | bool | Changed from `false`; `Y < -10` triggers fall penalty + `60`-tick wait + respawn |
| `dash_speed` | `14.0` | m/s | **New** |
| `dash_duration_s` | `0.2` | s | **New** (`12` ticks) |
| `dash_cooldown_s` | `1.5` | s | **New** (`90` ticks measured from dash start; `0` while Wind Charm active) |
| `score.per_mote` | `10` | pts | Concept changed: awarded per mote **deposited**, not on pickup |
| `score.per_lantern` | `100` | pts | Unchanged |
| `score.per_stun` | `5` | pts | Changed from `25`; awarded per shade hit by Pulse each time (even if already stunned) |
| `score.per_second_left` | `2` | pts/s | Unchanged (`Math.floor(time_left_s) * 2` on win) |
| `score.per_flame_left` | `50` | pts | Changed from `100` (`50 * flames` on win) |

### Additional Internal Sim Constants

| Constant | Value | Notes |
| --- | ---: | --- |
| `tick_rate_hz` | `60` | Fixed timestep `dt = 1 / 60` s |
| `accel_time_s` | `0.1` | Reach max run speed or stop in `6` ticks |
| `jump_velocity` | `7.0` | m/s upward velocity (grounded only) |
| `gravity` | `20.0` | m/s² downward acceleration (`-20` m/s²) |
| `fall_y_threshold` | `-10.0` | m; triggers fall once per fall |
| `fall_respawn_wait_ticks` | `60` | `1.0` s wait before respawn at start |
| `pickup_height_diff_m` | `1.5` | Max `|player.y - mote.y|` for mote & charm pickup |
| `shade_hit_height_diff_m` | `1.5` | Max `|player.y - shade.y|` for shade contact |
| `pulse_origin_y_offset_m` | `0.8` | Pulse 3D sphere center = `player.y + 0.8` |
| `pulse_push_ticks` | `15` | `4.0 / 15` m/tick horizontal push |
| `mote_initial_count` | `20` | Distinct spawn points at start |
| `mote_cap` | `30` | Active motes cap for scheduled spawns |
| `mote_spawn_interval_ticks` | `240` | Spawn 1 at `sim_tick = 240, 480, ...` |
| `dropped_mote_ttl_ticks` | `480` | `8.0` s lifetime |
| `dropped_mote_ring_min_m` | `1.5` | Inner drop ring radius |
| `dropped_mote_ring_max_m` | `2.5` | Outer drop ring radius |
| `shade_detect_radius_m` | `12.0` | `wander -> chase` XZ radius |
| `shade_lose_radius_m` | `18.0` | `chase -> wander` XZ radius |
| `shade_recoil_dist_m` | `2.0` | Recoil distance after hitting Mây |
| `shade_recoil_ticks` | `60` | `2.0 / 60` m/tick over `60` ticks |
| `shade_spawn_state_ticks` | `30` | `0.5` s in `"spawning"` for scheduled spawns |
| `shade_min_player_dist_m` | `15.0` | Min XZ distance from player for shade spawn |
| `safe_zone_push_max_ticks` | `30` | Max ticks to eject a shade caught inside newly lit lantern |
| `drifter_speed_chase` | `7.0` | m/s (also flee speed) |
| `drifter_speed_idle` | `2.0` | m/s |
| `drifter_cap` | `2` | Max active Drifters (Nights 2 & 3) |
| `drifter_spawn_interval_ticks` | `1200` | `sim_tick = 1200, 2400, ...` |
| `drifter_aggro_motes` | `5` | Min `player.carried` for `idle -> chase` |
| `drifter_aggro_radius_m` | `15.0` | Max XZ distance for `idle -> chase` |
| `drifter_touch_radius_m` | `1.2` | XZ steal radius |
| `drifter_steal_max` | `3` | Steals `Math.min(3, player.carried)` |
| `drifter_flee_ticks` | `240` | Flee duration after steal or pulse-on-chase |
| `drifter_drop_vanish_ticks` | `120` | Vanish duration after pulse-on-flee-with-loot |
| `charm_duration_ticks` | `600` | `10.0` s |
| `charm_speed_m_s` | `7.2` | Run speed while Wind Charm active |
| `charm_respawn_ticks` | `2700` | `45.0` s after pickup |
| `wind_cycle_ticks` | `1800` | `30.0` s period (Night 3) |
| `wind_gust_ticks` | `300` | `5.0` s active gust |
| `wind_warn_ticks` | `120` | `2.0` s pre-gust warning |
| `wind_push_speed_m_s` | `2.0` | Wind push velocity |
| `max_step_up_m` | `0.4` | Max terrain height increase per tick (ramps OK, 3 m walls blocked) |

---

## 2. Exact Per-Tick Order & Core Mechanics

Tick `0` snapshot is the state immediately after scenario setup (0 events emitted, score `0`).  
`Sim` tracks two counters: `tick` (total `step()` calls while not `"won"`/`"lost"`) and `sim_tick` (gameplay steps executed while unpaused). If `state === "won" || state === "lost"`, `step()` is a no-op.

### Mandatory 12-Step Order

1. **Read Input & Pause Handling**
   - Compute `nextTick = this.tick + 1`.
   - Merge present fields of `StepInput` (`move`, `cam_yaw_deg`, `jump`, `interact`, `pulse`, `dash`, `pause`) onto `heldInput`; absent fields keep prior values. Defaults before first frame: `move: [0, 0]`, `cam_yaw_deg: 0`, all booleans `false`.
   - Compute rising edges (`!prev && next`) for `jump`, `interact`, `pulse`, `dash`, `pause`.
   - **Pause check (first)**:
     - If `state === "playing"` and `pausePressed`: set `state = "paused"`, emit `paused {}` at `tick = nextTick`, set `this.tick = nextTick`, **stop the step here** (skip steps 2–11; `sim_tick` unchanged).
     - If `state === "paused"` and `!pausePressed`: set `this.tick = nextTick`, **stop the step here** (skip steps 2–11; `sim_tick` unchanged).
     - If `state === "paused"` and `pausePressed`: set `state = "playing"`, emit `resumed {}` at `tick = nextTick`, and proceed to Step 2 on this tick.
   - Commit `this.tick = nextTick` and `this.sim_tick += 1`.
   - If `this.sim_tick === 1`, emit `night_start { night }` at `tick = nextTick`.

2. **Decrement Counters**
   - Clear `spawned_this_tick = false` on all existing motes, shades, and drifters (so entities spawned/dropped on the previous tick become interactable now).
   - `remaining_ticks = Math.max(0, remaining_ticks - 1)`; `time_left_s = remaining_ticks / 60`.
   - Decrement by `1` (if `> 0`): `pulse_cd_ticks`, `dash_cd_ticks`, `invuln_ticks`, `charm_ticks`.
   - `fall_respawn_ticks`: if `> 0`, decrement by `1`; when it reaches `0`, respawn Mây at `nightConfig(night).playerStart`, `vel = [0, 0, 0]`, `grounded = true`, `facing = [0, 1]`, `invuln_ticks = 90`.
   - **Shades**: for each shade, decrement `state_ticks_left` if `> 0`; when it reaches `0` for `"spawning"`, `"stunned"`, or `"recoil"`, set `state = "wander"`. Decrement `safe_push_ticks_left` if `> 0`.
   - **Drifters**: for each drifter with `state === "flee"`, decrement `flee_ticks_left`; if `<= 0`, remove drifter from `drifters`.
   - **Dropped motes**: for each mote with `kind === "dropped"`, decrement `ttl_ticks`; if `<= 0`, remove mote from `motes`.
   - **Charms**: for each charm with `!available`, decrement `respawn_ticks`; when it reaches `0`, set `available = true`.
   - **Wind schedule** (Night 3 when `wind_enabled === true`): see Wind Schedule below.

3. **Move Mây (Jump, Dash, Jump Pads, Wind) & Fall Check**
   - If `fall_respawn_ticks > 0`: skip all movement and fall checks (`vel = [0, 0, 0]`, `grounded = false`).
   - Otherwise execute in order:
     1. Compute world move vector `(wx, wz)` from clamped/normalized `move` rotated by `cam_yaw_deg`:
        `wx = mx * cos(θ) + mz * sin(θ)`, `wz = -mx * sin(θ) + mz * cos(θ)`.
        If `hypot(wx, wz) > 1e-6`, update `facing = [wx / len, wz / len]`.
     2. **Dash activation**: if `dashPressed && dash_ticks_left === 0 && (dash_cd_ticks === 0 || charm_ticks > 0)`:
        - `dash_dir = hypot(wx, wz) > 1e-6 ? [wx / len, wz / len] : facing`.
        - `dash_ticks_left = 12`.
        - `dash_cd_ticks = charm_ticks > 0 ? 0 : 90` (measured from dash start).
        - `launch_locked = false`.
        - Emit `dash {}` at `tick = nextTick`.
     3. **Horizontal velocity**:
        - If `dash_ticks_left > 0`: `vx = dash_dir[0] * 14.0`, `vz = dash_dir[1] * 14.0`.
        - Else if `launch_locked`: keep `vx, vz` unchanged (move keys do not override).
        - Else (**Acceleration model**):
          - `maxSpeed = charm_ticks > 0 ? 7.2 : 6.0`
          - `targetVx = wx * maxSpeed`, `targetVz = wz * maxSpeed`
          - `dvx = targetVx - vx`, `dvz = targetVz - vz`, `dvLen = Math.hypot(dvx, dvz)`
          - `maxDv = (maxSpeed / 0.1) * dt` (`= maxSpeed / 6`, i.e. `1.0` m/s/tick normally, `1.2` m/s/tick with charm — accelerates from `0` to `maxSpeed` or stops to `0` in exactly `0.1` s / `6` ticks, both on ground and in air)
          - If `dvLen <= maxDv`: `vx = targetVx`, `vz = targetVz`
          - Else: `vx += (dvx / dvLen) * maxDv`, `vz += (dvz / dvLen) * maxDv`
     4. **Jump**: if `jumpPressed && grounded && dash_ticks_left === 0 && !launch_locked`:
        - `vy = 7.0`, `grounded = false`.
     5. **Jump Pads**: for each jump pad in the night's map:
        - If `!launch_locked && distXZ(player.pos, pad.pos) <= pad.radius && Math.abs(player.pos[1] - pad.pos[1]) <= 0.5 && (grounded || vy <= 0)`:
          - `dash_ticks_left = 0`
          - `vx = pad.dir[0] * pad.launch_vh`, `vz = pad.dir[1] * pad.launch_vh`, `vy = pad.launch_vy`
          - `launch_locked = true`, `grounded = false`.
     6. **Wind displacement** (Night 3 when `wind.active && !launch_locked`):
        - `windDx = Math.cos(wind.dir_deg * Math.PI / 180) * 2.0 * dt`
        - `windDz = Math.sin(wind.dir_deg * Math.PI / 180) * 2.0 * dt`
     7. **Horizontal integration & collision**:
        - Candidate `nx = x + vx * dt + windDx`, `nz = z + vz * dt + windDz`.
        - Resolve Night 3 Bell Tower cylinder (`r = 2.0`, `y < 14.0`) and Tier vertical walls (`getGroundHeight(night, nx, nz) > y + 0.4`) via radial push-out (bell tower) and axis-slide `(nx, z)` / `(x, nz)` fallback `(x, z)` (tier walls).
     8. **Vertical integration & grounded resolution**:
        - `prevY = y`.
        - If `dash_ticks_left > 0 && !grounded`: `vy = 0` (air dash keeps height).
        - Else: `vy -= 20.0 * dt`; `y += vy * dt`.
        - Query `h = getGroundHeight(night, x, z)`.
        - **Grounded definition**:
          - If `h !== null && y <= h && prevY >= h - 0.4`: `y = h`, `vy = 0`, `grounded = true`, `launch_locked = false`.
          - Else if `h !== null && grounded && y > h && (y - h) <= 0.35`: snap `y = h`, `vy = 0`, `grounded = true` (smooth ramp descent; stepping off a 3 m tier ledge has `y - h = 3.0 > 0.35` so Mây falls).
          - Else: `grounded = false`.
     9. **Dash tick decrement**:
        - If `dash_ticks_left > 0`: decrement `dash_ticks_left` by `1`; when it reaches `0`, clamp horizontal speed `hypot(vx, vz)` to `maxSpeed` so post-dash stopping remains `<= 0.1` s.
     10. **Fall check**:
        - If `y < -10.0`:
          - `flames = Math.max(0, flames - 1)`
          - `lost = carried`, `carried = 0`
          - Emit `player_hit { by: "fall", flames, dropped: 0, lost }` at `tick = nextTick`.
          - If `flames > 0`: set `fall_respawn_ticks = 60`, `vel = [0, 0, 0]`, `grounded = false`, `dash_ticks_left = 0`, `launch_locked = false`. (If `flames === 0`, Step 11 immediately ends the game as `lost / no_flames`.)

4. **Pick Up Motes and Charms**
   - Skip if `fall_respawn_ticks > 0`.
   - **Motes** (ascending `id`): skip if `spawned_this_tick`. If `carried < 10 && distXZ(player.pos, mote.pos) <= 1.0 && Math.abs(player.pos[1] - mote.pos[1]) <= 1.5`: remove mote, `carried += 1`, emit `mote_picked { carried }`. (No score on pickup.)
   - **Charms** (ascending `id`): if `charm.available && distXZ(player.pos, charm.pos) <= 1.0 && Math.abs(player.pos[1] - charm.pos[1]) <= 1.5`: set `charm.available = false`, `charm.respawn_ticks = 2700`, `player.charm_ticks = 600` (refreshes if already active), `player.dash_cd_ticks = 0`, emit `charm_picked { charm_id: charm.id, charm_ticks: 600 }`.

5. **Interact with Lanterns**
   - Skip if `fall_respawn_ticks > 0`.
   - If `interactPressed && carried > 0`: find nearest unlit lantern (`!lit`) with `distXZ(player.pos, lantern.pos) <= 2.0` (tie-break: ascending `id`).
   - `amount = Math.min(carried, 10 - lantern.deposited)`.
   - `carried -= amount`, `lantern.deposited += amount`, `score += amount * 10`.
   - Emit `deposit { lantern_id, amount, deposited }`.
   - If `lantern.deposited >= 10`:
     - `lantern.lit = true`, `score += 100`, emit `lantern_lit { lantern_id }`.
     - For every shade with `distXZ(shade.pos, lantern.pos) < 6.0`: set `safe_push_ticks_left = 30`, `safe_push_lantern_id = lantern.id`.

6. **Update Safe Zones**
   - For each shade with `safe_push_ticks_left > 0`:
     - Let `l` be the lit lantern with `id === safe_push_lantern_id` (or nearest lit lantern containing the shade).
     - Let `d = distXZ(shade.pos, l.pos)`. If `d >= 6.0`, set `safe_push_ticks_left = 0`.
     - Otherwise push radially away from `l.pos` (coincident -> `(+1, 0)`) by `Math.max(shadeSpeed * dt, (6.001 - d) / safe_push_ticks_left)` so the shade exits the `6.0` m radius within at most `30` ticks. Clamp to walkable terrain/obstacles. While `safe_push_ticks_left > 0`, shade deals no damage.

7. **Pulse (Tỏa Sáng)**
   - Skip if `fall_respawn_ticks > 0`.
   - If `pulsePressed && carried >= 3 && pulse_cd_ticks === 0`:
     - `carried -= 3`, `pulse_cd_ticks = 180`.
     - `origin = [player.x, player.y + 0.8, player.z]`.
     - **Shades** (ascending `id`): for each shade with `dist3D(origin, shade.pos) <= 5.0`:
       - `state = "stunned"`, `state_ticks_left = 120`, `pulse_push_ticks_left = 15`.
       - `pulse_push_dir = normalizeXZ(shade.pos - player.pos)` (if coincident, `[1, 0]`).
       - Add `shade.id` to `stunned_ids`.
     - `score += 5 * stunned_ids.length`.
     - Emit `pulse { stunned_ids }`.
     - **Drifters** (ascending `id`): for each drifter with `dist3D(origin, drifter.pos) <= 5.0`:
       - If `drifter.state === "chase"`: set `state = "flee"`, `flee_ticks_left = 240`.
       - Else if `drifter.state === "flee" && drifter.stolen > 0`:
         - Spawn `drifter.stolen` dropped motes (`kind: "dropped"`, `ttl_ticks = 480`, `spawned_this_tick = true`) at `[drifter.pos[0], getGroundHeight(night, drifter.pos[0], drifter.pos[2]) ?? 0, drifter.pos[2]]`.
         - Emit `drifter_drop { drifter_id: drifter.id, amount: drifter.stolen }`.
         - `drifter.stolen = 0`, `drifter.flee_ticks_left = 120`.

8. **Move Shades and Drifters**
   - Execute Shade AI (Section 3) in ascending `id` order.
   - Execute Drifter AI (Section 4.1) in ascending `id` order.

9. **Contacts (Drifter first, then Shades ascending `id`)**
   - Skip if `fall_respawn_ticks > 0`.
   - **Drifters** (ascending `id`): for each drifter with `state === "chase" && !has_stolen && !spawned_this_tick && distXZ(drifter.pos, player.pos) <= 1.2`:
     - Ignores `invuln_ticks` and lantern safe zones.
     - `amount = Math.min(3, player.carried)`; `player.carried -= amount`; `drifter.stolen = amount`; `drifter.has_stolen = true`; `drifter.state = "flee"`; `drifter.flee_ticks_left = 240`.
     - Emit `drifter_steal { drifter_id: drifter.id, amount, carried: player.carried }`.
   - **Shades** (ascending `id`, only if `invuln_ticks === 0`):
     - On first shade with `state` in `{"wander", "chase"}` AND `safe_push_ticks_left === 0` AND `!spawned_this_tick` AND `distXZ(player.pos, shade.pos) <= 1.0` AND `Math.abs(player.pos[1] - shade.pos[1]) <= 1.5`:
       - `flames = Math.max(0, flames - 1)`.
       - `dropped = Math.floor(carried * 0.5)`; `carried -= dropped`.
       - Spawn `dropped` motes (`kind: "dropped"`, `ttl_ticks = 480`, `spawned_this_tick = true`) at random points on ring `r ∈ [1.5, 2.5]` m around `player.pos` via `rng()` (`angle = rng() * 2π`, `r = 1.5 + rng()`; if `getGroundHeight(night, x, z) === null`, fallback to `player.pos`).
       - `invuln_ticks = 90`.
       - Shade enters `"recoil"`: `state = "recoil"`, `state_ticks_left = 60`, `recoil_dir = normalizeXZ(shade.pos - player.pos)` (coincident -> `[1, 0]`).
       - Emit `player_hit { by: "shade", flames, dropped }`.
       - Break (max 1 flame lost per tick).

10. **Spawn Motes, Shades, Drifters by Schedule**
    - All entities created here get `spawned_this_tick = true` (interactable starting next tick).
    - **Motes** (`random_motes === true`): if `sim_tick > 0 && sim_tick % 240 === 0 && motes.length < 30`:
      - Collect free spawn points from `nightConfig(night).moteSpawnPoints` (free = no active mote within `0.5` m XZ).
      - If non-empty: pick index `Math.floor(rng() * free.length)`, spawn `M{nextMoteNum++}` with `kind: "random"`, `ttl_ticks: null`. Else skip.
    - **Shades** (`random_shades === true`):
      - Count to spawn: `2` at `sim_tick === 300`; `1` when `sim_tick > 300 && (sim_tick - 300) % interval === 0` (`interval`: Night 1 = `480`, Night 2 = `420`, Night 3 = `360`; `cap`: Night 1 = `6`, Night 2 = `8`, Night 3 = `10`).
      - For each spawn while `shades.length < cap`: filter `shadeSpawnPoints` to points with `distXZ(pt, player.pos) >= 15.0` AND `distXZ(pt, litLantern.pos) >= 6.0` for all lit lanterns. If empty, skip. Else pick index `Math.floor(rng() * valid.length)`, spawn `S{nextShadeNum++}` at `[pt[0], pt[1] + 1.0, pt[2]]`, `state = "spawning"`, `state_ticks_left = 30`, emit `shade_spawned { id }`.
    - **Drifters** (`random_drifters === true`, Nights 2 & 3):
      - If `sim_tick > 0 && sim_tick % 1200 === 0 && drifters.length < 2`:
        - Pick index `Math.floor(rng() * shadeSpawnPoints.length)` from `shadeSpawnPoints`, spawn `D{nextDrifterNum++}` at `[pt[0], pt[1] + 1.2, pt[2]]`, `state = "idle"`, `stolen = 0`, `has_stolen = false`.

11. **Win / Lose Check** (priority: `no_flames` > `all_lit` > `dawn`)
    1. If `player.flames <= 0`: `state = "lost"`, emit `game_over { result: "lost", reason: "no_flames" }`.
    2. Else if `lanterns.every(l => l.lit)`:
       - `score += Math.floor(time_left_s) * 2 + player.flames * 50`.
       - `state = "won"`, emit `game_over { result: "won", reason: "all_lit" }`.
    3. Else if `remaining_ticks <= 0`: `time_left_s = 0`, `state = "lost"`, emit `game_over { result: "lost", reason: "dawn" }`.

12. **Write Snapshot if Due**
    - Headless runner writes snapshot when `tick % snapshotEvery === 0` (including `tick === 0` and paused ticks).

### Terrain Height Query `getGroundHeight(night, x, z): number | null`

- **Night 1**: `x*x + z*z <= 1600` → `0.0`; else `null`.
- **Night 2**: `x*x + z*z <= 784` (Island A) OR `(x - 70)*(x - 70) + z*z <= 784` (Island B) OR (`26 <= x <= 44 && -2 <= z <= 2`, bamboo bridge) → `0.0`; else `null`.
- **Night 3**:
  - Let `r = Math.hypot(x, z)`. If `r > 45.0` → `null`.
  - If `r <= 8.0` → `6.0` (Tier 2; Bell Tower cylinder `r <= 2.0` is solid obstacle up to `Y = 14.0`).
  - If `z > 0 && r >= 12.0 && r <= 24.0` → `3.0` (Tier 1).
  - Ramps (`θ ∈ {30°, 150°}`, `u = [cos θ, sin θ]`, `v = [-sin θ, cos θ]`): `s = x*u[0] + z*u[1]`, `perp = |x*v[0] + z*v[1]|`. If `23.5 <= s <= 30.0 && perp <= 1.5` → `Math.min(3.0, Math.max(0.0, 3.0 * (30.0 - s) / 6.0))` (extending `s` to `23.5` eliminates any chord-arc seam at `r = 24`).
  - Else → `0.0` (Tier 0).

### Wind Schedule (Night 3, `wind_enabled === true`)

- Period `1800` ticks (`30` s). Let `phase = sim_tick % 1800`.
- **Warning start** (`sim_tick >= 1680 && phase === 1680`): draw `next_wind_dir_deg = rng() * 360`. Renderer displays flying leaves + warning wind audio while `sim_tick >= 1680 && phase >= 1680`.
- **Gust active** (`sim_tick >= 1800 && phase < 300`): `wind = { active: true, dir_deg: current_wind_dir_deg }` (latched from `next_wind_dir_deg` when `phase === 0`).
- **Inactive**: `wind = { active: false, dir_deg: phase >= 1680 ? next_wind_dir_deg : 0 }`.
- On Nights 1 & 2 (or `wind_enabled: false`): `wind = { active: false, dir_deg: 0 }`.

---

## 3. Shade State Machine

Exact snapshot state names (Contract v1.1): `"spawning" | "wander" | "chase" | "recoil" | "stunned"`.  
Shade center `pos[1]` sits at `groundY + 1.0`. Speed: `4.0` m/s (Nights 1 & 2), `4.5` m/s (Night 3).

```
[scheduled spawn] -> spawning (30 ticks) -> wander <-> chase (detect <= 12 m / lose > 18 m)
                                              |         |
                                        [hit Mây]    [hit Mây]
                                              v         v
                                           recoil (60 ticks, 2 m away) -> wander

[any state, hit by Pulse (3D <= 5 m)] -> stunned (120 ticks; push 4 m over first 15 ticks) -> wander
```

- **`spawning`**: `30` ticks (`0.5` s) for scheduled spawns; stationary, cannot hit Mây. Scenario-loaded shades start in `"wander"` (or `scenario.shades[].state` if specified).
- **`wander`**:
  - If `fall_respawn_ticks === 0 && distXZ(shade.pos, player.pos) <= 12.0`: transition to `"chase"` immediately before moving.
  - Else deterministic wander via `rng()`: hold `wander_dir` and `wander_ticks_left`; when `<= 0`, draw `angle = rng() * 2π`, `wander_dir = [cos(angle), sin(angle)]`, `wander_ticks_left = 60 + Math.floor(rng() * 120)`. Move at `0.5 * shade_speed * dt`. If blocked by safe zone, obstacle, or island edge, set `wander_ticks_left = 0` so a new direction is drawn next tick.
- **`chase`**:
  - If `fall_respawn_ticks > 0 || distXZ(shade.pos, player.pos) > 18.0`: transition to `"wander"`.
  - Else move toward `player.pos` on XZ by `Math.min(distToPlayer, shade_speed * dt)`.
- **`recoil`**:
  - Entered on hitting Mây (`60` ticks). Moves along `recoil_dir` by `2.0 / 60` m/tick (`2.0` m total). Cannot hit Mây. Transitions to `"wander"` at `0`.
- **`stunned`**:
  - Entered (or refreshed) on Pulse (`state_ticks_left = 120`, `pulse_push_ticks_left = 15`).
  - While `pulse_push_ticks_left > 0`: move along `pulse_push_dir` by `4.0 / 15` m/tick (`4.0` m total); decrement `pulse_push_ticks_left`. If the step hits an obstacle (bell tower, tier vertical wall, or `getGroundHeight === null`), stop at the obstacle and set `pulse_push_ticks_left = 0`.
  - Cannot hit Mây. Transitions to `"wander"` at `0`.
- **Safe-zone exclusion**:
  - For shades NOT in `safe_push_ticks_left > 0`: after any horizontal move (`wander`, `chase`, `recoil`), run 2 passes over lit lanterns (ascending `id`); if `distXZ(shade.pos, l.pos) < 6.0`, project radially to `6.001` m.
  - Shades with `safe_push_ticks_left > 0` are pushed outward in Step 6 (at most `30` ticks, no damage) and skip `wander`/`chase` movement in Step 8.
- **Terrain following**: shades cannot cross cloud sea (`getGroundHeight === null`), Bell Tower (`r <= 2.0`), or climb vertical tier walls (`h > prevGroundY + 0.4`); they may follow ramps and step down tiers. Update `shade.pos[1] = groundY + 1.0`.

---

## 4. Part 3 Feature Rules & Testable Acceptance Criteria

### 4.1 Drifter ("Gió Lạc") — Nights 2 & 3
- **Given** Night 2 or 3 with `random_drifters: true`, **when** `sim_tick` reaches `1200` and `2400`, **then** `D1` and `D2` spawn at mist points in state `"idle"` and no 3rd Drifter spawns while 2 are active.
- **Given** an `"idle"` Drifter within `15.0` m XZ of Mây, **when** `player.carried >= 5`, **then** the Drifter switches to `"chase"` and moves toward Mây at `7.0` m/s; **when** `player.carried < 5` or distance `> 15.0` m, **then** it returns to `"idle"` (`2.0` m/s drift).
- **Given** a `"chase"` Drifter touching Mây (`distXZ <= 1.2` m) even while `invuln === true` or inside a lit lantern's safe zone, **when** Step 9 runs, **then** it steals `min(3, carried)` motes, emits `drifter_steal { drifter_id, amount, carried }`, does not cost a flame, switches to `"flee"` at `7.0` m/s away from Mây, and vanishes after `240` ticks with the loot.
- **Given** a Drifter that has already stolen once, **when** it is fleeing, **then** it never steals again.
- **Given** a `"chase"` Drifter within `5.0` m 3D of Pulse origin, **when** Mây pulses, **then** the Drifter switches to `"flee"` (`240` ticks) without stealing.
- **Given** a `"flee"` Drifter carrying `stolen > 0` motes within `5.0` m 3D of Pulse origin, **when** Mây pulses, **then** all `stolen` motes drop in place as `kind: "dropped"` motes (`ttl = 480` ticks), `drifter_drop { drifter_id, amount }` is emitted, `stolen` becomes `0`, and the Drifter vanishes after `120` ticks.

### 4.2 Wind Charm ("Bùa Gió") — Nights 2 & 3
- **Given** an available Wind Charm (`C1` on Night 2 at `[35,0,0]`; `C1, C2` on Night 3 at `[±30,0,25]`), **when** Mây moves within `1.0` m XZ and `<= 1.5` m Y, **then** the charm becomes unavailable (`respawn_s = 45.0`), `charm_s = 10.0` (`600` ticks), and `charm_picked { charm_id, charm_ticks: 600 }` is emitted.
- **Given** `charm_s > 0`, **when** Mây runs, **then** max run speed is `7.2` m/s; **when** Mây dashes, **then** dash is `14.0` m/s for `12` ticks with `dash_cd_s = 0` (must release and press dash again; pressing while dashing is ignored).
- **Given** `charm_s > 0` and another available charm is picked up, **when** Step 4 runs, **then** `charm_ticks` refreshes to `600`.
- **Given** an unavailable charm, **when** `2700` sim ticks elapse after pickup, **then** `available` becomes `true` and `respawn_s` becomes `0`.

### 4.3 3-Night Chain
- **Given** the player opens the app, **when** clicking Play from Main Menu, **then** the flow proceeds `Main Menu -> Night 1 Intro (island name "Đảo Bến" + line from "Ông Đăng") -> Play Night 1 -> Result Screen -> Night 2 Intro ("Đảo Cầu") -> Play Night 2 -> Result Screen -> Night 3 Intro ("Đảo Chuông") -> Play Night 3 -> Dawn Screen`.
- **Given** the player wins Night 3, **when** the Dawn Screen opens, **then** it displays the total campaign score (`sum of won Nights' scores`) and a button to return to Main Menu or replay.
- **Given** the player loses any Night, **when** the Result Screen opens, **then** it offers **Retry Night** (restarts that Night with 3 flames and `0` night score, preserving prior won Nights' total) and **Back to Menu**.

### 4.4 Pause Menu (`Esc` / `P`)
- **Given** active gameplay (`state === "playing"`), **when** the user presses `Esc` or `P`, **then** `Sim` enters `state = "paused"`, emits `paused {}`, freezes `sim_tick`, clock, cooldowns, spawns, and TTLs, and shows the Pause Overlay with 4 buttons: **Resume**, **Restart Night**, **Settings**, **Back to Menu**.
- **Given** `state === "paused"`, **when** the user presses `Esc`/`P` or clicks **Resume**, **then** `Sim` emits `resumed {}`, hides the overlay, and resumes simulation from the exact frozen state.

### 4.5 Settings & Persistence
- **Given** the Settings panel (accessible from Main Menu and Pause Menu), **when** the user adjusts **Volume** (`0–100%`) or **Mouse Sensitivity** (`0.2–3.0x`), **then** audio gain and camera yaw/pitch sensitivity update immediately and are saved to `localStorage` (`dao_den_long_settings_v1`).
- **Given** saved settings in `localStorage`, **when** the browser page is reloaded, **then** the saved Volume and Mouse Sensitivity values are restored automatically.

### 4.6 Audio
- **Given** active gameplay with volume `> 0`, **when** each gameplay event occurs, **then** the client plays distinct procedural/WebAudio sounds for: night background music (ambient loop), `mote_picked` / `charm_picked`, `lantern_lit`, `pulse`, `player_hit` (shade or fall), jump, `dash`, `game_over` (`won`), `game_over` (`lost`), `shade_spawned`, wind gust warning (Night 3), and last-10-seconds countdown tick (`time_left_s <= 10`, once per integer second).

### 4.7 Full HUD & Off-Screen Lantern Arrow
- **Given** `state === "playing"`, **when** the HUD renders, **then** it displays:
  - **Top-left**: 3 Flame icons (active vs extinguished).
  - **Top-center**: Clock `MM:SS`, turning danger red (`#FF5A5F`) and blinking when `time_left_s <= 30`.
  - **Top-right**: Lanterns lit `k/n` and current `score`.
  - **Bottom-center**: 10-slot mote bar showing `carried / 10` (gold/cream filled slots).
  - **Bottom-right**: Dash and Pulse cooldown icons with remaining seconds / ready state (Dash shows infinity/charm glow while `charm_s > 0`).
  - **Context prompt**: `"E — Nap anh sang (x/10)"` displayed when within `2.0` m XZ of an unlit lantern (`x = lantern.deposited`).
  - **Off-screen arrow**: when the nearest unlit lantern projects outside the camera viewport (or behind the camera), a directional edge arrow points toward it; hidden when the nearest unlit lantern is on-screen or all lanterns are lit.

### 4.8 Standard Palette & Ambient Light
- **Given** the 3D scene and HUD, **when** rendered, **then** listed materials/UI match Ticket-02 hex colors within `±10%` per RGB channel:
  - Night sky / mist: `#0E1430` / `#1B2350`
  - Grass / sand / wood / cloud sea: `#2F5D50` / `#C9B48A` / `#6B4A2F` / `#12384A`
  - Lit lantern / core / unlit: `#FFB347` / `#FFE9B0` / `#5B5F6E`
  - Mote core / halo: `#FFF6C2` / `#FFE58A`
  - Shade body / outline / stunned: `#120A1A` / `#7A3CFF` / `#3A3450`
  - Mây's shirt / scarf & Wind Charm: `#E8E2D0` / `#C8102E`
  - Gold outline & score / Drifter: `#F2C14E` / `#8FA3B8`
  - Danger UI / UI text: `#FF5A5F` / `#F5F1E6`
- **Given** `k` lit lanterns out of `n` total, **when** updating scene lighting, **then** ambient light intensity equals `0.15 + 0.55 * (k / n)`.

---

## 5. Map Data Tables

Angle convention for all ring formulas: `pt(cx, cz, r, deg, y) = [cx + r * cos(deg°), y, cz + r * sin(deg°)]`.  
Initial 20 motes are selected from each Night's ordered `moteSpawnPoints` list via partial Fisher-Yates shuffle (`i = 0..19`, `j = i + Math.floor(rng() * (N - i))`), assigning IDs `M1..M20` in selection order.

### Night 1 — "Đảo Bến" (`duration = 300 s`, `shade_speed = 4.0`, `shade_interval = 480`, `shade_cap = 6`, `wind = false`, `drifters = false`)
- **Geometry**: Single circular island centered `(0, 0, 0)`, radius `40` m, `Y = 0`. Start `[0, 0, 0]` facing `+Z`.
- **Lanterns (`L1..L5`)**: `L1 [0, 0, 25]`, `L2 [23.8, 0, 7.7]`, `L3 [14.7, 0, -20.2]`, `L4 [-14.7, 0, -20.2]`, `L5 [-23.8, 0, 7.7]`.
- **Mote spawn points (`24`, ordered)**:
  1. Indices `0..7`: `pt(0, 0, 12, k * 45, 0)` for `k = 0..7` (`0°, 45°, ..., 315°`).
  2. Indices `8..23`: `pt(0, 0, 33, k * 22.5, 0)` for `k = 0..15` (`0°, 22.5°, ..., 337.5°`).
- **Shade spawn points (`12`, ordered)**: `pt(0, 0, 37, 15 + k * 30, 0)` for `k = 0..11` (`15°, 45°, ..., 345°`).
- **Jump pads / Charms**: none.

### Night 2 — "Đảo Cầu" (`duration = 330 s`, `shade_speed = 4.0`, `shade_interval = 420`, `shade_cap = 8`, `wind = false`, `drifters = true`)
- **Geometry**: Island A center `(0, 0, 0)` radius `28` m; Island B center `(70, 0, 0)` radius `28` m; bamboo bridge `x ∈ [26, 44], z ∈ [-2, 2]`, `Y = 0`, no rails. Start `[0, 0, 0]` facing `+Z`.
- **Lanterns (`L1..L6`)**: `L1 [0, 0, 20]`, `L2 [17, 0, -10]`, `L3 [-17, 0, -10]`, `L4 [70, 0, 20]`, `L5 [87, 0, -10]`, `L6 [53, 0, -10]`.
- **Mote spawn points (`24`, ordered)**:
  1. Indices `0..3`: Island A inner `pt(0, 0, 10, k * 90, 0)` (`k = 0..3`).
  2. Indices `4..11`: Island A outer `pt(0, 0, 22, k * 45, 0)` (`k = 0..7`).
  3. Indices `12..15`: Island B inner `pt(70, 0, 10, k * 90, 0)` (`k = 0..3`).
  4. Indices `16..23`: Island B outer `pt(70, 0, 22, k * 45, 0)` (`k = 0..7`).
- **Shade spawn points (`16`, ordered)**:
  1. Indices `0..7`: Island A `pt(0, 0, 26, 22.5 + k * 45, 0)` (`k = 0..7`).
  2. Indices `8..15`: Island B `pt(70, 0, 26, 22.5 + k * 45, 0)` (`k = 0..7`).
- **Jump pads (`2`)**:
  - `JP1`: pos `[20, 0, 18]`, radius `1.0`, `launch_vy = 14.0`, `launch_vh = 24.0`, `dir = normalizeXZ([70 - 20, 0 - 18])` = `[0.94089, -0.33872]`.
  - `JP2`: pos `[50, 0, -18]`, radius `1.0`, `launch_vy = 14.0`, `launch_vh = 24.0`, `dir = normalizeXZ([0 - 50, 0 - (-18)])` = `[-0.94089, 0.33872]`.
- **Charms (`1`)**: `C1 [35, 0, 0]`.

### Night 3 — "Đảo Chuông" (`duration = 360 s`, `shade_speed = 4.5`, `shade_interval = 360`, `shade_cap = 10`, `wind = true`, `drifters = true`)
- **Geometry**: Circular island center `(0, 0, 0)`, radius `45` m. Default player start `[0, 0, -12]` facing `+Z` (outside the solid Bell Tower at `(0, 0)` on Tier 2).
- **Tiers & Obstacles**:
  - Tier 0: `r <= 45`, `Y = 0`.
  - Tier 1: `z > 0 && 12 <= r <= 24`, `Y = 3`.
  - Tier 2: `r <= 8`, `Y = 6`.
  - Ramps (2): width `3.0` m, angles `30°` and `150°`, foot at `r = 30` (`Y = 0`), top at `r = 24` (`Y = 3`).
  - Bell Tower: cylinder center `(0, 0)`, radius `2.0` m, base `Y = 6`, top `Y = 14` (height `8` m), solid & not climbable.
- **Lanterns (`L1..L7`)**: `L1 [0, 6, 6]`, `L2 [18, 3, 10]`, `L3 [-18, 3, 10]`, `L4 [35, 0, -10]`, `L5 [-35, 0, -10]`, `L6 [20, 0, -35]`, `L7 [-20, 0, -35]`.
- **Mote spawn points (`30`, ordered)**:
  1. Indices `0..17`: Tier 0 `pt(0, 0, 34, k * 20, 0)` (`k = 0..17`).
  2. Indices `18..25`: Tier 1 `pt(0, 0, 18, (k + 1) * 20, 3)` (`k = 0..7`: `20°, 40°, ..., 160°`).
  3. Indices `26..29`: Tier 2 `pt(0, 0, 5, 45 + k * 90, 6)` (`k = 0..3`: `45°, 135°, 225°, 315°`).
- **Shade spawn points (`16`, ordered)**: `pt(0, 0, 43, k * 22.5, 0)` for `k = 0..15`.
- **Jump pads (`1`)**: `JP1`: pos `[0, 3, 13]`, radius `1.0`, `launch_vy = 12.0`, `launch_vh = 8.0`, `dir = [0, -1]`.
- **Charms (`2`)**: `C1 [30, 0, 25]`, `C2 [-30, 0, 25]`.

---

## 6. Sim v1.1 TypeScript Interface Sketch & Renderer Exports

Exports marked **`[Renderer-allowed]`** may be imported by `src/renderer/` and `src/ui/`. Internal sim helpers (RNG, AI steppers, collision resolvers) are **`[Sim-internal]`**.

```ts
// [Renderer-allowed] Core types
export type Vec3 = [number, number, number];
export type NightNumber = 1 | 2 | 3;
export type GameState = "playing" | "paused" | "won" | "lost";
export type ShadeBehaviorState = "spawning" | "wander" | "chase" | "recoil" | "stunned";
export type DrifterBehaviorState = "idle" | "chase" | "flee";
export type MoteKind = "random" | "dropped";

export interface StepInput {
  move?: [number, number];
  cam_yaw_deg?: number;
  jump?: boolean;
  interact?: boolean;
  pulse?: boolean;
  dash?: boolean;
  pause?: boolean;
}

export interface ScenarioConfig {
  player?: {
    pos?: Vec3;
    carried?: number;
    flames?: number;
    invuln_ticks?: number;
    dash_cd_ticks?: number;
    pulse_cd_ticks?: number;
    charm_ticks?: number;
  };
  random_motes?: boolean;
  random_shades?: boolean;
  random_drifters?: boolean;
  wind_enabled?: boolean;
  motes?: Array<Vec3 | { id?: string; pos: Vec3; kind?: MoteKind; ttl_ticks?: number }>;
  shades?: Array<{ id?: string; pos: Vec3; state?: ShadeBehaviorState; state_ticks_left?: number }>;
  lanterns?: Array<{ id: string; pos?: Vec3; deposited?: number; lit?: boolean }>;
  drifters?: Array<{ id?: string; pos: Vec3; state?: DrifterBehaviorState; stolen?: number; flee_ticks_left?: number }>;
  charms?: Array<{ id?: string; pos: Vec3; available?: boolean; respawn_ticks?: number }>;
  time_left_s?: number;
}

export interface SimOptions {
  seed: number;
  night?: NightNumber; // default 1
  scenario?: ScenarioConfig;
}

export interface PlayerState {
  pos: Vec3;
  vel: Vec3;
  grounded: boolean;
  flames: number;
  carried: number;
  invuln: boolean;
  dash_cd_s: number;
  pulse_cd_s: number;
  charm_s: number;
}

export interface LanternState { id: string; pos: Vec3; lit: boolean; deposited: number; }
export interface ShadeState { id: string; pos: Vec3; state: ShadeBehaviorState; }
export interface MoteState { id: string; pos: Vec3; kind: MoteKind; ttl_s: number | null; }
export interface DrifterState { id: string; pos: Vec3; state: DrifterBehaviorState; stolen: number; }
export interface CharmState { id: string; pos: Vec3; available: boolean; respawn_s: number; }
export interface WindState { active: boolean; dir_deg: number; }

export interface SimSnapshot {
  type: "snapshot";
  tick: number;
  sim_tick: number;
  night: NightNumber;
  state: GameState;
  time_left_s: number;
  score: number;
  wind: WindState;
  player: PlayerState;
  lanterns: LanternState[];
  shades: ShadeState[];
  motes_active: number;
  motes: MoteState[];
  drifters: DrifterState[];
  charms: CharmState[];
}

export type SimEvent =
  | { type: "event"; tick: number; name: "night_start"; data: { night: NightNumber } }
  | { type: "event"; tick: number; name: "paused"; data: Record<string, never> }
  | { type: "event"; tick: number; name: "resumed"; data: Record<string, never> }
  | { type: "event"; tick: number; name: "dash"; data: Record<string, never> }
  | { type: "event"; tick: number; name: "mote_picked"; data: { carried: number } }
  | { type: "event"; tick: number; name: "charm_picked"; data: { charm_id: string; charm_ticks: number } }
  | { type: "event"; tick: number; name: "deposit"; data: { lantern_id: string; amount: number; deposited: number } }
  | { type: "event"; tick: number; name: "lantern_lit"; data: { lantern_id: string } }
  | { type: "event"; tick: number; name: "pulse"; data: { stunned_ids: string[] } }
  | { type: "event"; tick: number; name: "drifter_steal"; data: { drifter_id: string; amount: number; carried: number } }
  | { type: "event"; tick: number; name: "drifter_drop"; data: { drifter_id: string; amount: number } }
  | { type: "event"; tick: number; name: "player_hit"; data: { by: "shade"; flames: number; dropped: number } | { by: "fall"; flames: number; dropped: number; lost: number } }
  | { type: "event"; tick: number; name: "shade_spawned"; data: { id: string } }
  | { type: "event"; tick: number; name: "game_over"; data: { result: "won" | "lost"; reason: "all_lit" | "dawn" | "no_flames" } };

export interface EndLine { type: "end"; ticks: number; state: GameState; score: number; }

// [Renderer-allowed] Map geometry & config helpers
export interface JumpPadDef { id: string; pos: Vec3; radius: number; launch_vy: number; launch_vh: number; dir: [number, number]; }
export interface RampDef { angle_deg: number; r_foot: number; r_top: number; y_foot: number; y_top: number; width: number; }
export interface NightConfig {
  night: NightNumber;
  name: string;
  introLine: string;
  duration_s: number;
  playerStart: Vec3;
  shade_speed: number;
  shade_spawn_interval_ticks: number;
  shade_cap: number;
  drifters_enabled: boolean;
  wind_enabled: boolean;
  lanterns: ReadonlyArray<{ id: string; pos: Vec3 }>;
  moteSpawnPoints: ReadonlyArray<Vec3>;
  shadeSpawnPoints: ReadonlyArray<Vec3>;
  jumpPads: ReadonlyArray<JumpPadDef>;
  charms: ReadonlyArray<{ id: string; pos: Vec3 }>;
  geometry: MapGeometry;
}
export interface MapGeometry {
  islands: ReadonlyArray<{ center: [number, number]; radius: number; y: number }>;
  bridge?: { xMin: number; xMax: number; zMin: number; zMax: number; y: number };
  tiers?: {
    tier1: { rMin: number; rMax: number; y: number; zMin: number };
    tier2: { radius: number; y: number };
    ramps: ReadonlyArray<RampDef>;
    bellTower: { center: [number, number]; radius: number; yBase: number; height: number };
  };
}

// [Renderer-allowed] Public exports from src/sim/index.ts
export declare class Sim {
  constructor(options: SimOptions);
  step(input?: StepInput): void;
  getState(): SimSnapshot;
  drainEvents(): SimEvent[];
}
export declare function nightConfig(night: NightNumber): NightConfig;
export declare function getGroundHeight(night: NightNumber, x: number, z: number): number | null;
export declare const TUNING: Record<string, unknown>;
export declare const PALETTE: Record<string, string>;
```

---

## 7. v1.0 → v1.1 Behavior Changes & Creativity Retention

### Breaking / Changed v1.0 Behaviors (Tests Must Be Updated)
1. **All tuning numbers standardized**: `player_speed` (`7→6`), `carry_capacity` (`5→10`), `lantern_cost` (`5→10`), `pickup_radius` (`1.8→1.0` + Y diff `<= 1.5`), `interact_radius` (`3.0→2.0`), `pulse_cost` (`1→3`), `pulse_radius` (`8.0→5.0` 3D from `feet+0.8`), `night1_duration_s` (`240→300`), `invuln_s` (`2.0→1.5`), `pulse_stun_s` (`2.5→2.0`), `pulse_push_m` (`6.0→4.0` over `15` ticks), `shade_speed` (`4.5→4.0`), `shade_hit_radius` (`1.2→1.0` + Y diff `<= 1.5`), `score.per_stun` (`25→5`), `score.per_flame_left` (`100→50`).
2. **Score on deposit, not pickup**: `mote_picked` awards `0` points; `deposit` awards `+10 * amount`.
3. **Acceleration model**: player no longer reaches top speed in 1 tick; ramps linearly over `0.1` s (`6` ticks).
4. **Falling enabled (`fall_enabled: true`)**: Night 1 no longer clamps player at `r = 39.5`; stepping past `r = 40` falls to `Y < -10` (`-1` flame, lose all motes, `60`-tick wait, respawn).
5. **Hit drops physical motes**: shade hit drops `floor(carried / 2)` motes onto ground ring `1.5–2.5` m (`ttl = 480` ticks, pickable next tick) instead of `ceil` extinguished; hitting shade recoils `2` m over `60` ticks.
6. **Shade states & AI**: states renamed to `spawning | wander | chase | recoil | stunned`; detect `12` m / lose `18` m; spawn schedule `2` at tick `300` then every `480` ticks (cap `6`) on 12 ring points `>= 15` m from player.
7. **Mote spawning**: `20` distinct points from fixed ring tables at start (cap `30`), +1 every `240` ticks if `< 30` (replaces continuous annulus sampling and threshold `12`).
8. **Win/lose tie-break priority**: `no_flames` now takes priority over `all_lit` (previously `all_lit` > `no_flames`).
9. **Tick order**: counters decrement in Step 2 (before movement/actions), not Step 9.
10. **Snapshot & events**: new required snapshot fields (`night`, `wind`, `player.{vel,grounded,invuln,dash_cd_s,pulse_cd_s,charm_s}`, `motes[].{kind,ttl_s}`, `drifters`, `charms`) and new events (`night_start`, `dash`, `charm_picked`, `drifter_steal`, `drifter_drop`, `paused`, `resumed`, fall `lost`).

### Existing Creativity Retained
- **Lantern Moth Companion (*Bướm Đèn*)** (`src/renderer/mothCompanion.ts`): kept intact across all 3 Nights. Updated to flutter toward nearest unlit lantern when `player.carried === 10` (matching v1.1 `carry_capacity`). Remains 100% renderer-only with zero imports from `src/headless/` or `src/sim/`, preserving byte-identical headless determinism.

---

## 8. Assumptions (One Line Each)

1. `x = r * cos(θ), z = r * sin(θ)` is used for all Part 2 polar coordinates, matching Tier 1 (`z > 0`) having angles `20°..160°` and ramps at `30°` and `150°`.
2. `night_start { night }` is emitted on `sim_tick === 1` so tick `0` scenario setup remains event-free per Contract v1.0.
3. Resuming from pause (`paused -> playing`) emits `resumed {}` and executes Steps 2–11 on that same tick; pausing stops the step immediately after Step 1.
4. Horizontal acceleration is linear at `maxSpeed / 0.1` m/s² (`60` m/s² normally, `72` m/s² with charm) on ground and in air, achieving `<= 0.1` s start/stop.
5. Dash ends by clamping horizontal speed to `maxSpeed` on the 12th tick so dash distance is `2.8` m and post-dash stopping stays `<= 0.1` s.
6. Night 3 default player start is `[0, 0, -12]` (Tier 0, facing `+Z`) because `[0, 0, 0]` lies inside the solid Bell Tower under Tier 2.
7. Wind push (`2.0` m/s) is paused while `launch_locked` on a jump pad so the Night 3 jump pad reliably lands on Tier 2 during gusts.
8. Wind gust direction is drawn via `rng()` at warning start (`2` s before each `30` s gust) so leaves/audio and the gust share the exact same angle.
9. Ramp top on Night 3 extends `s` to `23.5` m (clamped to `Y = 3.0`) to eliminate the `0.047` m chord-to-arc gap at `r = 24`.
10. Shade center height is `groundY + 1.0` m (matching v1.0 snapshot example), keeping same-tier touch (`|Δy| = 1.0 <= 1.5`) valid and cross-tier touch (`|Δy| = 2.0 > 1.5`) invalid.
11. Scheduled shades spend `30` ticks (`0.5` s) in `"spawning"` before `"wander"`; scenario-loaded shades start active in `"wander"` unless `state` is specified.
12. `motes[].ttl_s` is `null` for `kind: "random"` motes and `ttl_ticks / 60` for `kind: "dropped"` motes.
13. `player_hit` for falls includes both `dropped: 0` (v1.0 compatibility) and `lost: <previous carried>` (v1.1 addition).
14. Dropped motes whose random `1.5–2.5` m ring position falls over cloud sea (`getGroundHeight === null`) fall back to `player.pos` so they remain reachable.
15. Drifter spawn "random mist point" samples uniformly from the Night's `shadeSpawnPoints` list at `groundY + 1.2` m.
16. A "free" mote spawn point is one with no active mote within `0.5` m XZ; initial `20` motes are chosen by partial Fisher-Yates shuffle on the ordered point table.
17. `Charms` snapshot objects include `pos: Vec3` alongside `id`, `available`, and `respawn_s` so the renderer reflects scenario-overridden charm positions.
18. `interact` (lantern deposit) uses pure XZ distance `<= 2.0` m per Contract v1.0, as no Night has vertically stacked lanterns.
