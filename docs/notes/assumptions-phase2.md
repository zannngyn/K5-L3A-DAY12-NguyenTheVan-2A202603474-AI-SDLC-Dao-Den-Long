# Phase 2 Assumptions (`ticket-02.md` → Contract v1.1)

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
