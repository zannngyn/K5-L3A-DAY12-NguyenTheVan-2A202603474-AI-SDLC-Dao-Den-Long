# AGENTS.md — Đảo Đèn Lồng (Lantern Island)

3D third-person game (Three.js + TypeScript, 60 ticks/s) across 3 Nights (**Đảo Bến / Đảo Cầu / Đảo Chuông**), conforming to **Test Contract v1.2**.

## Commands
- Install / Dev / Build: `npm install`, `npm run dev`, `npm run build`
- Checks: `npm run typecheck`, `npm test`, `npm run verify`
- Headless CLI: `npx tsx src/headless/cli.ts --seed N --night 1|2|3 --ticks N --out file.jsonl`
  - Optional flags: `--scenario <file.json> --inputs <file.json> --snapshot-every <N>`

## Core v1.2 Rules Summary
- **Lantern fuel:** max `100`, computed in integer `1/60` units (`-1`/tick decay; refuel `+10`/mote up to `100`; full lantern unselectable). At `fuel <= 0` lantern turns off (`ever_lit = true`, `lantern_out`); relight costs `5` motes (never-lit: `10`).
- **Safe zone & shade drain:** `6 m` safe zone requires `fuel >= 30`. `wander` shades target nearest lit lantern with `fuel < 30` and enter `drain` within `2 m` (`5/s` stacked + `1/s` self-decay). Refuel to `>= 30` pushes shades out over `<= 30` ticks (no damage).
- **Dawn win & capacity:** Nights `240 / 270 / 300 s`, no early win. Win at dawn if alive with `>= ceil(0.6 * n)` lit (`dawn_survived`); `no_flames` always loses first. Capacity = `min(20, 10 + 2 * successful_lights)` per Night.

## Architecture Rules
- `src/sim/**` is pure, deterministic simulation logic: NO DOM APIs, NO `three`, NO `Math.random()`, NO `Date.now()`. Use the seeded PRNG only.
- Client modules (`renderer`, `hud`, `ui`, `input`, `audio`) only read `Sim` state/events via public exports from `src/sim/index.ts`; never mutate sim internals.
- All gameplay/tuning numbers live in `src/sim/tuning.ts` and must match `game.contract.json` (`contract_version: "1.2"`). Never hardcode duplicate constants elsewhere.
- Headless output must never depend on renderer state or creative extras (e.g., Moth Companion); disable extras in headless mode.

## Evidence & Honesty Rules
- Never edit tests, assertions, or headless outputs just to make a check pass.
- When a Phase 2/3+ requirement replaces an earlier rule, update the affected test with an explicit reason in commit/notes and record breaking changes in `CHANGELOG.md`.
- Report `"not verified"` honestly whenever a check (e.g., visual/browser playtest) could not be run; headless checks do not catch visual bugs like camera jitter.

## File Ownership Split
- **Sim & Headless**: `src/sim/**`, `src/headless/**`, `game.contract.json`, `tests/**`, `scripts/**`
- **Client**: `src/renderer/**`, `src/hud/**`, `src/input/**`, `src/audio/**`, `src/ui/**`, `src/main.ts`, `index.html`
- **Docs & Harness**: `AGENTS.md`, `.claude/skills/**`, `docs/**`, `README.md`, `CHANGELOG.md`
- Respect assigned ownership boundaries; report cross-boundary errors instead of editing outside scope.

## Security & Git
- Never commit `.env`, API keys, tokens, or secrets.
- Keep commits small and scoped; update this file and skills when an agent mistake repeats.
