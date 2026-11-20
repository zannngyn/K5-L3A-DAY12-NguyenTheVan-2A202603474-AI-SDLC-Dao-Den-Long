# Đảo Đèn Lồng — Phase 4 Spec & Acceptance Criteria (Ticket-04, Contract v1.3)

Authoritative upstream: `.swarm/specs/ticket-04.md` (Phase 4, tag `phase-4`, GitHub Release `v1.0.0`, Contract v1.3).  
Architecture decisions: `.swarm/specs/phase4-architecture.md`.  
Units: meters (`m`), seconds (`s`), `Y` up, fixed `60` ticks/s (`dt = 1 / 60` s).  
No gameplay rule or tuning changes from Contract v1.2; creative extras (e.g. Lantern Moth Companion) are kept in normal play and MUST be disabled (or have zero effect on measurements) in headless, benchmark, and soak modes.

---

## 1. Benchmark (Mandatory)

- **AC-1.1 (Command & exit code):** **Given** a built project (`npm run build`) and Chrome or Chromium installed, **when** running `node scripts/play.mjs --bench --seed 42 --duration 30 --out bench.json`, **then** the launcher starts the local server, launches the browser in benchmark mode, writes `bench.json`, closes the browser, and exits with code `0`. If no Chrome/Chromium executable is found, the launcher exits non-zero with a clear `stderr` message listing what to install.
- **AC-1.2 (Standard scene & creative extras off):** **Given** benchmark mode (`?bench=1&seed=42&duration=30`), **when** the scene loads, **then**:
  - Window size is `1280x720`, not fullscreen; Chrome/Chromium is launched with `--disable-gpu-vsync --disable-frame-rate-limit` (`vsync_off: true` when launched with those flags).
  - Night 1 (**Đảo Bến**) loads with full visual effects and lighting as in real play, and creative extras (Lantern Moth Companion, etc.) are OFF.
  - Exactly `200` Shades spawn in state `"wander"` spread evenly over the Night 1 island (seeded by `--seed`), and exactly `100` motes spawn (benchmark may exceed normal gameplay caps).
  - Lanterns `L1`, `L2`, `L3` are lit with `fuel = 100`.
  - Extra spawns, damage, mote pickup, fuel decay/drain, and Night end conditions are OFF (`SimOptions.bench = true`).
  - Shades continue moving under normal `wander` rules; Mây stands at `(0, 0, 0)` with no player input.
- **AC-1.3 (Orbit camera & measurement window):** **Given** the benchmark scene has rendered its first frame, **when** the benchmark runs, **then** the camera orbits a circle centered at `(0, 0, 0)`, radius `30 m`, height `Y = 15 m`, always looking at `(0, 0, 0)`, starting at angle `0` (`(30, 15, 0)`), moving counter-clockwise seen from above at `15 s` per revolution. The first `3 s` are warm-up (not measured), followed by exactly `--duration` seconds of measurement.
- **AC-1.4 (Output schema & metric formulas):** **Given** the measurement window finishes with `N` recorded `requestAnimationFrame` deltas `dt_i` (in ms), **when** `bench.json` is written, **then** it contains:
  - `contract_version`: `"1.3"`
  - `frames`: `N`
  - `avg_fps`: `1000 * N / sum(dt_i)`
  - `p1_low_fps`: let `k = max(1, ceil(0.01 * N))`; take the `k` largest `dt_i`; `1000 / mean(k largest dt_i)`
  - `frame_ms_p95`: 95th percentile of `dt_i` (ms)
  - `load_ms`: elapsed time from launcher process start to the first rendered bench frame (`POST /api/bench/first-frame`)
  - `peak_mem_mb`: peak summed RSS (MB) of the spawned browser process tree sampled every `250 ms` during the measuring window (`null` if unmeasurable, with explanation in `README.md`)
  - `vsync_off`: boolean
  - `renderer`: engine/renderer + version string
  - `os`: OS type/release/arch + CPU model string
- **AC-1.5 (Performance pass thresholds):** **Given** `bench.json` produced on the instructor's machine with `--seed 42 --duration 30`, **when** evaluated against Ticket-04 pass criteria, **then** `avg_fps >= 60`, `p1_low_fps >= 30`, and `load_ms <= 10000`.

---

## 2. Soak Test (Mandatory)

- **AC-2.1 (Command & single-process cycling):** **Given** the headless soak runner, **when** running `npx tsx src/headless/soak.ts --seed 7 --nights 10 --out soak.json`, **then** it runs `10` consecutive Nights in a single Node process cycling Night `1 -> 2 -> 3 -> 1 -> ...`, where Night `i` uses seed `7 + i`, and each Night runs until it ends (`won`/`lost`) or its standard duration elapses.
- **AC-2.2 (Seeded random inputs):** **Given** each Night in the soak run, **when** stepping simulation ticks, **then** the move direction is re-picked from the seeded PRNG every `30` ticks, and on each tick the per-tick action probabilities are `5%` jump, `3%` dash, `2%` pulse, and `10%` interact.
- **AC-2.3 (Output schema & memory sampling):** **Given** the soak run completes, **when** `soak.json` is written, **then** it contains `nights` (`10`), `crashes` (caught exceptions per Night), `results` (array of `"won"` / `"lost"` strings of length `10`), `mem_start_mb` (process RSS after Night 1 finishes loading), `mem_end_mb` (process RSS after the last Night's reset finishes), and `duration_s`.
- **AC-2.4 (Pass criteria):** **Given** `soak.json`, **when** evaluated against Ticket-04 pass criteria, **then** `crashes === 0` and `mem_end_mb <= 1.2 * mem_start_mb`.

---

## 3. Local Leaderboard

- **AC-3.1 (Score submission flow):** **Given** the player finishes a campaign by winning Night 3 (Dawn screen) OR loses at any Night, **when** the end screen is shown, **then** the UI allows entering a player name and saving the score.
- **AC-3.2 (Validation & entry schema):** **Given** a submitted name, **when** validated by `POST /api/leaderboard` (or client fallback), **then** names of `3–12` characters matching `[A-Za-z0-9_]` (Vietnamese letters allowed as bonus) are accepted and invalid names return HTTP `400` with `{"error": ...}`. Each saved entry contains `name`, `score` (sum of won Nights), `nights_won` (`0–3`), `achieved_at` (ISO 8601 with local timezone offset), and `seed`.
- **AC-3.3 (Ordering, cap & persistence):** **Given** saved leaderboard entries, **when** inserting a new entry, **then** entries are sorted by `score` descending with ties broken by earlier `achieved_at` first, trimmed to top `10`, persisted atomically on local disk at `data/leaderboard.json` (gitignored, created on demand; client falls back to `localStorage` if the launcher API is unreachable and indicates which store is active), and survive game restarts.
- **AC-3.4 (Menu access & CLI export):** **Given** the main menu, **when** the player opens the Leaderboard screen, **then** the top 10 entries are displayed in order. **Given** the CLI export command `node scripts/play.mjs --export-leaderboard out.json`, **when** executed, **then** it writes `{"entries":[...]}` in sorted order to `out.json` and exits `0` without starting the HTTP server.

---

## 4. Accessibility

- **AC-4.1 (Key rebinding):** **Given** the Settings / Controls menu, **when** the player rebinds any action — move (`4` directions: up, down, left, right), jump, dash, interact, pulse, pause — **then** duplicate/conflicting bindings are detected and reported to the user, a `"Restore defaults"` button resets all bindings, and custom bindings persist across restarts.
- **AC-4.2 (Visual cues & captions):** **Given** active gameplay, **when** any of the following occur, **then** a visible caption/indicator is shown:
  - A Shade appears (accompanied by an edge-of-screen directional arrow pointing toward the Shade).
  - Wind is about to blow (Night 3 pre-gust warning).
  - Remaining time enters the last `10 s`.
  - Any lit lantern drops to `fuel < 30`.
- **AC-4.3 (Reduced motion):** **Given** `"Reduced motion"` is enabled in Settings (persisted), **when** camera shake or screen flash events occur (e.g. damage, pulse, wind), **then** camera shake and screen flash are suppressed.
- **AC-4.4 (Typography & large text):** **Given** the UI rendered at `1280x720`, **when** measured in default text mode, **then** UI font size is at least `18 px`; **when** the `"Large text"` option is enabled (persisted), **then** UI text scales by `x1.25`.

---

## 5. Packaging & Documentation

- **AC-5.1 (3-command clean-clone run):** **Given** a fresh clone on a machine with Node `>= 20`, **when** following `README.md`, **then** the game builds and becomes playable in at most `3` commands (`npm install && npm run build`, then `node scripts/play.mjs`; optional `npm run verify`).
- **AC-5.2 (Required documentation):** **Given** the repository root and `docs/notes/`, **when** inspecting deliverables, **then**:
  - `README.md` includes a short description, screenshots (`docs/proof/screens/*.png`), system requirements, install/run, controls + rebinding, tests, headless, bench (including vsync flags and RSS note), soak, leaderboard, accessibility, release artifact, `"Sáng tạo của tôi"`, and demo video placeholder.
  - `CHANGELOG.md` documents all 4 phases (`phase-1` through `phase-4` / `v1.0.0`).
  - `CREDITS.md` lists every asset class (procedural geometry, WebAudio synthesis, system fonts, libraries) and AI tools used.
  - `LICENSE` exists at the repository root.
- **AC-5.3 (Release artifact):** **Given** `scripts/package-release.sh`, **when** run, **then** it builds `dist/` and creates `release/dao-den-long-web-v1.0.0.zip` containing `dist/`, `scripts/play.mjs`, and `RUN.txt` with 2-line run instructions (`unzip`, `node scripts/play.mjs`), ready for attachment to GitHub Release `v1.0.0`.

---

## 6. Contract v1.3

- **AC-6.1 (Contract schema & backward compatibility):** **Given** `game.contract.json`, **when** inspected, **then** `contract_version` is `"1.3"`, `build_cmd`, `run_cmd`, `headless_cmd`, `bench_cmd`, and `soak_cmd` are present and match the runnable scripts, and all v1.0–v1.2 tuning keys and simulation rules remain unchanged.

---

## 7. Retro, Demo & Definition of Done

- **AC-7.1 (Retrospective):** **Given** `docs/notes/retro.md`, **when** reviewed, **then** it is 1–2 pages in Vietnamese evaluating all 4 phases using real evidence files (`docs/notes/ai-log.md`, `docs/proof/phase-*.md`, `docs/proof/review-client-phase3.md`), covering what worked/did not with AI, AI mistakes & detection, most helpful harness, token/cost line (`TBD by user`) with saving methods, and what to change next time.
- **AC-7.2 (Demo & Release DoD):** **Given** the final submission, **when** verified for Release `v1.0.0`, **then** `bench.json` and `soak.json` produced by the team are committed, Phase 1–3 tests and `npm run verify` still pass, a demo video `.mp4` (`< 5 min`) showing live play and test/headless/bench evidence is attached to Release `v1.0.0` (or `docs/demo/demo.mp4`), and tag `phase-4` + GitHub Release `v1.0.0` are published on the public repo with AI harness and docs intact.
