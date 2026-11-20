# Dao Den Long (Lantern Island) — Phase 1 Game Design Spec

Authoritative upstream: `.swarm/specs/prd-and-contract.md` (PRD-0 + Test Contract v1.0).  
Scope: Night 1, round island, 5 Great Lanterns, deterministic 60 Hz sim core + 3D third-person renderer.

---

## 1. Tuning Table & World Geometry

Every key matches `game.contract.json` `tuning` verbatim. Units: meters (`m`), seconds (`s`), `Y` up, ground `Y = 0`. All tuning distances are horizontal XZ Euclidean distances (`hypot(dx, dz) <= r`), with no body radii added.

| Key | Value | Unit / Type | Notes |
| --- | ---: | --- | --- |
| `player_speed` | `7.0` | m/s | Faster than `shade_speed` (`4.5`) so May can outrun shades in open ground |
| `carry_capacity` | `5` | motes | Equal to `lantern_cost` (1 full load lights 1 lantern) |
| `lantern_cost` | `5` | motes | 5 lanterns × 5 motes = 25 motes minimum to win |
| `lantern_count_night1` | `5` | count | Fixed by contract (`L1`..`L5`) |
| `pickup_radius` | `1.8` | m | Auto-pickup XZ radius around `player.pos` |
| `interact_radius` | `3.0` | m | Deposit XZ radius around lantern pole base |
| `pulse_cost` | `1` | mote | Paid from `player.carried` |
| `pulse_radius` | `8.0` | m | XZ radius of light pulse |
| `night1_duration_s` | `240` | s | 4 minutes (`14400` ticks); winnable in ~90–150 s |
| `flames` | `3` | HP | Starting and max flames |
| `invuln_s` | `2.0` | s | `120` ticks invulnerability after a hit |
| `hit_drop_ratio` | `0.5` | ratio | Drops `ceil(carried * 0.5)` motes when `carried > 0` |
| `pulse_stun_s` | `2.5` | s | `150` ticks stun duration |
| `pulse_push_m` | `6.0` | m | Instant radial XZ knockback away from player |
| `pulse_cooldown_s` | `3.0` | s | `180` ticks cooldown after a successful pulse |
| `safe_radius` | `6.0` | m | XZ radius around **lit** lanterns that shades cannot enter |
| `shade_speed` | `4.5` | m/s | Strictly `< player_speed` |
| `shade_hit_radius` | `1.2` | m | XZ contact radius for shade hitting player |
| `fall_enabled` | `false` | bool | Island edge clamps positions; falling cannot occur |
| `score.per_mote` | `10` | pts | Awarded on `mote_picked` |
| `score.per_lantern` | `100` | pts | Awarded on `lantern_lit` |
| `score.per_stun` | `25` | pts | Awarded per shade stunned by `pulse` |
| `score.per_second_left` | `2` | pts/s | Awarded on `"won"` using `Math.floor(time_left_s)` |
| `score.per_flame_left` | `100` | pts | Awarded on `"won"` per remaining flame |

### Additional Physics & Island Constants (internal to sim)

| Constant | Value | Notes |
| --- | ---: | --- |
| `tick_rate_hz` | `60` | Fixed timestep `dt = 1 / 60` s |
| `island_radius_m` | `40.0` | Visual island disk centered at `(0, 0, 0)` |
| `island_playable_radius_m` | `39.5` | Hard circular XZ clamp for player and shades |
| `jump_velocity` | `8.0` | m/s initial upward velocity on grounded jump |
| `gravity` | `22.0` | m/s² downward acceleration (peak height ≈ `1.45` m, air time ≈ `0.73` s / 44 ticks) |

### World Layout & Lantern Positions

- **Player start**: `(0, 0, 0)` (feet at `Y = 0`, `vy = 0`, `carried = 0`, `flames = 3`).
- **5 Great Lanterns** placed evenly at `72°` intervals on a ring of radius `25.0` m (`x = 25 * sin(θ)`, `z = 25 * cos(θ)`, `y = 0`). Adjacent lanterns are `29.39` m apart, leaving `17.39` m of dark space between lit `safe_radius` zones.

| ID | Angle | Position `[x, y, z]` |
| --- | ---: | --- |
| `L1` | `0°` | `[0.000, 0.000, 25.000]` |
| `L2` | `72°` | `[23.776, 0.000, 7.725]` |
| `L3` | `144°` | `[14.695, 0.000, -20.225]` |
| `L4` | `216°` | `[-14.695, 0.000, -20.225]` |
| `L5` | `288°` | `[-23.776, 0.000, 7.725]` |

### Action Rules

- **Pulse payment**: `pulse_cost` (`1`) is paid from `player.carried`.
- **Pulse when `carried < pulse_cost` or `pulse_cooldown_ticks > 0`**: Silent no-op. No motes deducted, cooldown unchanged, no `pulse` event emitted.
- **Pulse when valid**: Deduct `1` from `player.carried`, set `pulse_cooldown_ticks = 180`, stun and push all shades within `pulse_radius` (`8.0` m), award `25 * stunned_ids.length`, emit `pulse { stunned_ids }` (even if `stunned_ids` is `[]`).
- **Partial deposit**: Allowed. On `interact` rising edge (`false -> true`) with `player.carried > 0`, pick the nearest unlit lantern (`lit === false`) with XZ distance `<= interact_radius` (`3.0` m), breaking ties by `id` ascending. Deposit `amount = Math.min(player.carried, lantern_cost - lantern.deposited)`. Excess carried motes remain with the player. Emit `deposit`; if `lantern.deposited >= lantern_cost`, set `lantern.lit = true`, add `score.per_lantern`, and emit `lantern_lit`.

---

## 2. Exact Tick Order & Win / Lose / Score Rules

Tick `0` snapshot is the state immediately after scenario setup (before any input, 0 events emitted, score `0`).  
Step `k` (`k = 0..N-1`) reads input for tick `k`, advances `sim_tick` to `k + 1`, and stamps all events produced in this step with `tick = k + 1`. If `state !== "playing"`, `step()` is a no-op.

Inside a single step (`dt = 1 / 60`):

1. **Input**
   - Merge frame fields for tick `k` onto held input state (absent fields retain prior values; defaults before first frame: `move: [0, 0]`, `cam_yaw_deg: 0`, all buttons `false`).
   - Compute rising edges (`false -> true`): `jumpPressed`, `interactPressed`, `pulsePressed`.
   - Clamp `move` components to `[-1, 1]`; if `hypot(mx, mz) > 1`, normalize to length `1`.
   - Rotate by `theta = cam_yaw_deg * Math.PI / 180`:
     - `wx = mx * Math.cos(theta) + mz * Math.sin(theta)`
     - `wz = -mx * Math.sin(theta) + mz * Math.cos(theta)`
2. **Movement**
   - Horizontal: `player.x += wx * player_speed * dt`, `player.z += wz * player_speed * dt`. Clamp XZ radius to `<= 39.5` m.
   - Vertical: if `jumpPressed && player.y === 0`, set `player.vy = jump_velocity` (`8.0`). Update `player.vy -= gravity * dt`, `player.y += player.vy * dt`. If `player.y <= 0`, clamp `player.y = 0`, `player.vy = 0`.
3. **Pickup (auto-pickup)**
   - Iterate active motes in ascending `id` order (`M1`, `M2`, ...).
   - If `player.carried < carry_capacity` and XZ distance `<= pickup_radius` (`1.8` m): remove mote, `player.carried += 1`, `score += score.per_mote`, emit `mote_picked { carried: player.carried }`.
4. **Interact / Deposit**
   - If `interactPressed && player.carried > 0`: find nearest unlit lantern with XZ distance `<= interact_radius` (`3.0` m; tie-break `id` ascending).
   - `amount = Math.min(player.carried, lantern_cost - lantern.deposited)`.
   - `player.carried -= amount`, `lantern.deposited += amount`, emit `deposit { lantern_id, amount, deposited }`.
   - If `lantern.deposited >= lantern_cost`: `lantern.lit = true`, `score += score.per_lantern`, emit `lantern_lit { lantern_id }`.
5. **Pulse**
   - If `pulsePressed && player.carried >= pulse_cost && pulse_cooldown_ticks === 0`:
     - `player.carried -= pulse_cost`, `pulse_cooldown_ticks = 180`.
     - Collect shades with XZ distance `<= pulse_radius` (`8.0` m) in ascending `id` order.
     - For each: set `state = "stunned"`, `stun_ticks = 150`; push `6.0` m along normalized XZ vector `(shade - player)` (if distance `=== 0`, push along `(+1, 0)`); clamp shade XZ radius to `<= 39.5` m.
     - `score += score.per_stun * stunned_ids.length`.
     - Emit `pulse { stunned_ids }`.
6. **Shade AI**
   - Iterate shades in ascending `id` order; see Section 4 for state transitions, movement, and `safe_radius` projection.
7. **Hit Check**
   - If `invuln_ticks === 0`: iterate shades in ascending `id` order.
   - On the first shade with `state !== "stunned"` and XZ distance `<= shade_hit_radius` (`1.2` m):
     - `player.flames = Math.max(0, player.flames - 1)`
     - `dropped = player.carried > 0 ? Math.ceil(player.carried * hit_drop_ratio) : 0`
     - `player.carried -= dropped` (extinguished; not dropped onto ground)
     - `invuln_ticks = 120`
     - Emit `player_hit { by: "shade", flames: player.flames, dropped }`
     - Stop checking further shades this tick.
8. **Spawn**
   - **Motes** (if `random_motes === true`): if `motes.length < 12` and `mote_respawn_cooldown_ticks === 0`, spawn 1 mote via RNG and set `mote_respawn_cooldown_ticks = 240` (`4.0` s).
   - **Shades** (if `random_shades === true`): if `shades.length < 4` and `next_tick` (`steps_run + 1`) equals a scheduled spawn tick (`180`, `2580`, `4980`, `7380`, then every `2400` ticks if below cap), spawn 1 shade via RNG and emit `shade_spawned { id }` with `tick = next_tick`.
9. **Timers**
   - `steps_run += 1`; `sim_tick = steps_run`.
   - `time_left_s = Math.max(0, initial_time_left_s - steps_run / 60)`.
   - Decrement `invuln_ticks`, `pulse_cooldown_ticks`, and `mote_respawn_cooldown_ticks` by `1` if `> 0`.
   - For each shade with `stun_ticks > 0`: decrement `stun_ticks`; when it reaches `0`, set `state = "chase"`.
10. **Win / Lose Check (simultaneous event priority)**
    - **Priority 1 — Win (`all_lit`)**: All 5 lanterns have `lit === true`. Even if `flames === 0` or `time_left_s <= 0` on the same tick, completing the 5th lantern wins.
      - Award end bonuses: `score += Math.floor(time_left_s) * score.per_second_left + player.flames * score.per_flame_left`.
      - Set `state = "won"`, emit `game_over { result: "won", reason: "all_lit" }`.
    - **Priority 2 — Lose (`no_flames`)**: `player.flames <= 0`.
      - Set `state = "lost"`, emit `game_over { result: "lost", reason: "no_flames" }`.
    - **Priority 3 — Lose (`dawn`)**: `time_left_s <= 0` (i.e., `steps_run >= Math.round(initial_time_left_s * 60)`).
      - Set `state = "lost"`, emit `game_over { result: "lost", reason: "dawn" }`.

### Score Formula

`score = 10 * motes_picked + 100 * lanterns_lit_during_play + 25 * shade_stuns + (won ? 2 * Math.floor(time_left_s) + 100 * flames_left : 0)`

Pre-lit lanterns or pre-carried motes from scenario setup award `0` score.

---

## 3. Mote Rules & Seeded RNG

- **PRNG**: `mulberry32`, seeded with `seed >>> 0` from `--seed`. Single shared RNG instance in `Sim` used in deterministic call order (initial motes, then runtime mote respawns and shade spawns).

```ts
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- **Initial count**: `24` motes when `random_motes !== false` (IDs `M1`..`M24`). When `scenario.motes` is provided, it replaces the initial list (IDs `M1`..`Mk` in array order; `[]` = none).
- **Placement**: Uniform area sampling on annulus `r ∈ [4.0, 36.0]` m:
  - `r = Math.sqrt(rng() * (36 * 36 - 4 * 4) + 4 * 4)`
  - `theta = rng() * 2 * Math.PI`
  - `pos = [r * Math.cos(theta), 0, r * Math.sin(theta)]`
  - Reject and resample up to `16` times if XZ distance `< 2.5` m from any lantern or `< 2.0` m from any active mote; accept the 16th sample if still colliding.
- **Respawn policy**: When `random_motes !== false`, whenever `motes.length < 12` and `mote_respawn_cooldown_ticks === 0`, spawn 1 mote (`M{nextMoteNum++}`) using the placement rule above and set cooldown to `240` ticks (`4.0` s). Prevents soft-locks from pulses or hit drops.
- **Pickup mode**: **Auto-pickup** (no button press) whenever XZ distance `<= pickup_radius` (`1.8` m) and `player.carried < carry_capacity` (`5`).

---

## 4. Shade Rules

- **States**: `"idle" | "chase" | "stunned" | "retreat"` (includes contract-required `"stunned"`).
- **ID naming**: `S1`, `S2`, `S3`, ... in spawn order (`S{nextShadeNum++}`). If a scenario supplies shades with explicit IDs, initialize `nextShadeNum` to `Math.max(maxParsedSNumber, scenario.shades.length) + 1`; scenario shades without an `id` receive `S{nextShadeNum++}` in array order.
- **Spawn schedule & cap** (when `random_shades !== false`):
  - Cap: `4` active shades.
  - Schedule: `sim_tick === 180` (3.0 s), then every `2400` ticks (40.0 s: `2580`, `4980`, `7380`, ...) while `shades.length < 4`.
  - Spawn ring: `r = 36.0` m, `y = 0`, `theta = rng() * 2 * Math.PI`. Resample up to `16` times if within `safe_radius` (`6.0` m) of any lit lantern. Initial state: `"chase"`.
- **Fear of lanterns**: Shades cannot enter `safe_radius` (`6.0` m) of any **lit** lantern (`lantern.lit === true`). Unlit lanterns do **not** repel shades.
- **AI movement per tick** (non-stunned shades):
  1. If shade is currently inside `safe_radius` of any lit lantern (e.g., lantern just lit or pulse pushed shade in): set `state = "retreat"`, move `shade_speed * dt` directly away from the nearest lit lantern (tie-break lantern `id` ascending; if coincident, move `(+1, 0)`).
  2. Else compute desired step toward `player.pos` on XZ of length `Math.min(distToPlayer, shade_speed * dt)`.
  3. Apply step, then enforce safe-zone exclusion (2 passes over lit lanterns in `id` ascending order): if XZ distance to a lit lantern `< safe_radius`, project shade radially outward to `safe_radius + 0.001` m. Clamp XZ radius to `<= 39.5` m.
  4. If the net displacement this tick is `< 0.001` m (blocked by a lit lantern's `safe_radius` while player hides inside): set `state = "idle"`; otherwise `state = "chase"`.
- **Pulse interaction**: Shades within `pulse_radius` (`8.0` m) enter `"stunned"` for `2.5` s (`150` ticks, refreshing timer if already stunned) and are pushed `6.0` m away from `player.pos` on XZ (clamped to `39.5` m). Stunned shades do not move and cannot hit the player.
- **Hit & invulnerability**: Non-stunned shade within `shade_hit_radius` (`1.2` m) while `invuln_ticks === 0` removes `1` flame, drops `Math.ceil(carried * 0.5)` motes (if `carried > 0`), grants `2.0` s (`120` ticks) invulnerability, and emits `player_hit`.

---

## 5. Sim ↔ Renderer Interface Contract (TypeScript)

Sim core (`src/sim/`) has **zero** DOM, WebGL/Three.js, audio, or wall-clock dependencies. Renderer (`src/renderer/`) owns camera orbit/lerp, floating mote bobbing (`y = 0.8 + 0.25 * Math.sin(t)`), particle VFX, audio, HUD, and the creativity companion.

```ts
export type Vec3 = [number, number, number];
export type GameState = "playing" | "won" | "lost";
export type ShadeBehaviorState = "idle" | "chase" | "stunned" | "retreat";

export interface StepInput {
  move?: [number, number]; // [x, z] in [-1, 1]
  cam_yaw_deg?: number;
  jump?: boolean;
  interact?: boolean;
  pulse?: boolean;
}

export interface ScenarioConfig {
  player?: { pos?: Vec3; carried?: number; flames?: number };
  random_motes?: boolean;
  random_shades?: boolean;
  motes?: Vec3[];
  shades?: Array<{ id?: string; pos: Vec3 }>;
  lanterns?: Array<{ id: string; pos?: Vec3; deposited?: number; lit?: boolean }>;
  time_left_s?: number;
}

export interface SimOptions {
  seed: number;
  scenario?: ScenarioConfig;
}

export interface PlayerState {
  pos: Vec3;
  flames: number;
  carried: number;
}

export interface LanternState {
  id: string;
  pos: Vec3;
  lit: boolean;
  deposited: number;
}

export interface ShadeState {
  id: string;
  pos: Vec3;
  state: ShadeBehaviorState;
}

export interface MoteState {
  id: string;
  pos: Vec3;
}

export interface SimSnapshot {
  type: "snapshot";
  tick: number;
  sim_tick: number;
  state: GameState;
  time_left_s: number;
  score: number;
  player: PlayerState;
  lanterns: LanternState[];
  shades: ShadeState[];
  motes_active: number;
  motes: MoteState[];
}

export type SimEvent =
  | { type: "event"; tick: number; name: "mote_picked"; data: { carried: number } }
  | { type: "event"; tick: number; name: "deposit"; data: { lantern_id: string; amount: number; deposited: number } }
  | { type: "event"; tick: number; name: "lantern_lit"; data: { lantern_id: string } }
  | { type: "event"; tick: number; name: "pulse"; data: { stunned_ids: string[] } }
  | { type: "event"; tick: number; name: "player_hit"; data: { by: "shade" | "fall"; flames: number; dropped: number } }
  | { type: "event"; tick: number; name: "shade_spawned"; data: { id: string } }
  | { type: "event"; tick: number; name: "game_over"; data: { result: "won" | "lost"; reason: "all_lit" | "dawn" | "no_flames" } };

export interface EndLine {
  type: "end";
  ticks: number;
  state: GameState;
  score: number;
}

export declare class Sim {
  constructor(options: SimOptions);
  step(input: StepInput): void;
  getState(): SimSnapshot;      // pure read; coordinates rounded to 3 decimals in JSONL serializer
  drainEvents(): SimEvent[];    // returns & clears events emitted since last drain
}
```

---

## 6. Creativity Feature ("Sáng tạo của tôi")

**Feature: Lantern Moth Companion (*Bướm Đèn*)**  
A small glowing golden paper-moth rendered purely in the 3D client layer:
- Orbits lazily around May's conical hat (*nón lá*) while exploring.
- When `player.carried === carry_capacity` (`5/5`), flutters ahead along the direction vector toward the nearest unlit lantern as a diegetic waypoint cue.
- Emits a brief warm wing-sparkle trail whenever `drainEvents()` contains `lantern_lit` or `pulse`.

**How it is disabled in headless**:
- The moth lives exclusively in `src/renderer/mothCompanion.ts` and is driven solely by reading `SimSnapshot` and `SimEvent[]` in the browser render loop.
- The headless CLI imports only `src/sim/` — no renderer module or companion code is ever imported, instantiated, or ticked in headless mode, and the companion never touches `Sim`'s PRNG or state.

**How to prove headless output is unchanged**:
1. Dependency check: verify `src/headless/` has zero imports from `src/renderer/`.
2. Byte-identical diff: run `<headless_cmd> --seed 42 --night 1 --ticks 3600 --out /tmp/run.jsonl` before and after adding the companion (and twice consecutively) and verify identical `sha256sum` output, documented in `README.md` under **"Sáng tạo của tôi"**.

---

## 7. Assumptions

1. `pulse_cost` (`1`) is deducted from `player.carried`; pulsing with `carried < 1` or on cooldown is a silent no-op.
2. Partial deposits into unlit lanterns are allowed and persist; excess carried motes remain with the player.
3. `safe_radius` (`6.0` m) applies only to **lit** lanterns (`lit === true`); unlit lanterns do not block shades.
4. Motes dropped on a shade hit (`Math.ceil(carried * 0.5)`) are extinguished rather than spawned on the ground, preventing instant auto-pickup loops.
5. `fall_enabled` is `false`; clamping XZ to `39.5` m prevents falling, so `player_hit` with `by: "fall"` is never emitted.
6. Jumping modifies `Y` only; all tuning distance checks remain strictly on the horizontal XZ plane per Test Contract v1.0.
7. Simultaneous win/lose conditions on the same tick resolve in priority order: `all_lit` (win) > `no_flames` (lose) > `dawn` (lose).
8. Time and flame bonus scores are awarded only on `"won"`, using `Math.floor(time_left_s)` so `score` is always an integer.
9. Mote pickup is automatic on XZ proximity (`<= 1.8` m) in ascending ID order until `carried === 5`.
10. When `scenario.time_left_s` is set, countdown starts from `scenario.time_left_s` (`max(0, initial_time_left_s - steps_run / 60)`).
11. Executing a valid pulse with `0` shades in range still costs `1` mote, triggers cooldown, and emits `pulse { stunned_ids: [] }`.
12. Internal sim math uses float64; rounding to 3 decimal places occurs only during JSONL serialization.

---

## 8. Visual Direction & UI

### Color Palette

| Role | Hex | Usage |
| --- | --- | --- |
| Warm Lantern Glow | `#FFB347` | Lit Great Lanterns, point lights, safe-zone ring decal |
| Firefly Mote | `#FFE066` | Floating motes, carried counter, pulse shockwave |
| Hat Lantern Accent | `#FF9F1C` | May's hanging *nón lá* lantern, Lantern Moth companion |
| Lit Ground Warmth | `#5C4328` | Warm bounce tint around lit lanterns |
| Deep Night Mist | `#0D091A` | Sky, distant fog at 0/5 lanterns |
| Unlit Island Ground | `#1C1B29` | Base island terrain in darkness |
| Ink Shade Body | `#1A0B2E` | Low-poly shade silhouette |
| Shade Danger Aura | `#7B2CBF` | Shade eyes, chase rim-glow, hit flash |
| Stunned Shade Tint | `#9D79BC` | Visual cue while `state === "stunned"` |
| HUD Text / Parchment | `#FFF5E1` | Readable warm-white typography |
| Flame Active / Lost | `#FF6B35` / `#3D3447` | Flame HP icons |

### Progressive Island Brightening (per lit lantern, `k = 0..5`)

- **Ambient light intensity**: `0.15 + 0.11 * k` (`0.15` dark night → `0.70` warm twilight at 5/5).
- **Fog distance & color**: Linear fog start `18 + 6 * k` m, end `48 + 12 * k` m; color interpolates from `#0D091A` (`k = 0`) to `#2A1F3D` (`k = 5`).
- **Per-lantern light**: Lighting a lantern activates a `#FFB347` point light (`range = 18` m) and a faint golden ground ring at `r = 6.0` m marking `safe_radius`.

### HUD & End Screens

- **Top-left**: 3 Flame icons (`#FF6B35` lit / `#3D3447` lost) + Carried motes (`carried / 5` + pulse-ready glow when `carried >= 1` and off cooldown).
- **Top-center**: Lanterns lit (`x / 5` with 5 lantern pips) + Night timer (`MM:SS`).
- **Top-right**: Current Score.
- **Bottom-center**: Minimal controls bar (`WASD Move · Space Jump · E Deposit · Q / Right-Click Pulse`).
- **Win / Lose Overlay**:
  - Win title: `"Island Restored"` (`all_lit`); Lose title: `"Flame Extinguished"` (`no_flames`) or `"Dawn Broke Too Soon"` (`dawn`).
  - Displays final score + breakdown (motes, lanterns, stuns, time/flame bonuses if won).
  - Restart via **`R` key** or **Restart button** (resets `Sim` with a fresh seed or same seed and returns to `"playing"`).
