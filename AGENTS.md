# AGENTS.md — Đảo Đèn Lồng (Lantern Island)

3D third-person game (Three.js + TypeScript, 60 ticks/s) across 3 Nights (**Đảo Bến / Đảo Cầu / Đảo Chuông**), conforming to **Test Contract v1.3** (`v1.0.0`).

## Commands
- Build & Play: `npm install && npm run build`, `node scripts/play.mjs` (or `npm start`; dev: `npm run dev`)
- Checks: `npm run typecheck`, `npm test`, `npm run verify`
- Headless CLI: `npx tsx src/headless/cli.ts --seed N --night 1|2|3 --ticks N --out file.jsonl` (`--scenario`, `--inputs`, `--snapshot-every`)
- Benchmark: `node scripts/play.mjs --bench --seed 42 --duration 30 --out bench.json` (requires Chrome/Chromium; pass: `avg_fps >= 60`, `p1_low_fps >= 30`, `load_ms <= 10000`)
- Soak test: `npx tsx src/headless/soak.ts --seed 7 --nights 10 --out soak.json` (pass: `crashes === 0`, `mem_end_mb <= 1.2 * mem_start_mb`)
- Leaderboard export & Release zip: `node scripts/play.mjs --export-leaderboard out.json`, `bash scripts/package-release.sh`

## Core Rules Summary (v1.2 / v1.3 — unchanged gameplay)
- **Lantern fuel:** max `100` in integer `1/60` units (`-1`/tick decay; refuel `+10`/mote up to `100`; full unselectable). At `fuel <= 0` turns off (`ever_lit = true`, `lantern_out`); relight costs `5` motes (never-lit: `10`).
- **Safe zone & shade drain:** `6 m` safe zone requires `fuel >= 30`. `wander` shades target nearest lit lantern with `fuel < 30` and enter `drain` within `2 m` (`5/s` stacked + `1/s` self-decay). Refuel to `>= 30` pushes shades out over `<= 30` ticks (no damage).
- **Dawn win & capacity:** Nights `240 / 270 / 300 s`, no early win. Win at dawn if alive with `>= ceil(0.6 * n)` lit (`dawn_survived`); `no_flames` always loses first. Capacity = `min(20, 10 + 2 * successful_lights)` per Night.

## Architecture Rules
- `src/sim/**` is pure, deterministic simulation logic: NO DOM APIs, NO `three`, NO `Math.random()`, NO `Date.now()`. Use the seeded PRNG only.
- Client modules (`renderer`, `hud`, `ui`, `input`, `audio`) only read `Sim` state/events via `src/sim/index.ts`; never mutate sim internals.
- All tuning numbers live in `src/sim/tuning.ts` and match `game.contract.json` (`contract_version: "1.3"`). Never hardcode duplicate constants.
- Creative extras (e.g., Lantern Moth Companion) MUST be disabled in headless, benchmark (`?bench=1`), and soak modes so measurements and determinism are unaffected.
- Zero new npm dependencies for the Phase 4 launcher (`scripts/play.mjs` uses Node >= 20 built-ins only).

## Evidence & Honesty Rules
- Never edit tests, assertions, or headless/bench/soak outputs just to make a check pass.
- When a requirement replaces an earlier rule, update the affected test with an explicit reason and record breaking changes in `CHANGELOG.md`.
- Report `"not verified"` honestly whenever a check (e.g., browser playtest or bench run) could not be executed; headless checks do not catch visual bugs like camera jitter.

## File Ownership Split
- **Sim, Headless, Soak & Launcher**: `src/sim/**`, `src/headless/**`, `game.contract.json`, `tests/**`, `scripts/**`
- **Client**: `src/renderer/**`, `src/hud/**`, `src/input/**`, `src/audio/**`, `src/ui/**`, `src/main.ts`, `index.html`
- **Docs & Harness**: `AGENTS.md`, `.claude/skills/**`, `docs/**`, `README.md`, `CHANGELOG.md`, `CREDITS.md`
- Respect assigned ownership boundaries; report cross-boundary errors instead of editing outside scope.

## Security & Git
- Never commit `.env`, API keys, tokens, secrets, or `data/leaderboard.json`.
- Keep commits small and scoped; only create release/phase tags after final code and verification pass.
