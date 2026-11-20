---
name: headless-proof
description: Use when verifying Đảo Đèn Lồng simulation behavior, determinism, error handling, soak stability, benchmark output, or generating Phase 1–4 evidence under docs/proof/.
---

# Headless & Phase 4 Verification Skill

Run reproducible headless, soak, launcher, and benchmark checks (Contract v1.3) and record evidence under `docs/proof/`.

## 1. Run a Scenario Headless

```bash
npx tsx src/headless/cli.ts \
  --seed 1 --night 1 \
  --scenario docs/proof/scenarios/<name>.json \
  --inputs docs/proof/scenarios/<name>-inputs.json \
  --ticks 300 --out docs/proof/<name>.jsonl
```

- Supports `--night 1|2|3`. Verify expected `event` lines (`refuel`, `lantern_out`, `fuel_drain`, `lantern_lit { relight }`, `game_over`) and final `{"type":"end",...}`.

## 2. Verify Determinism & Exit Code 2

```bash
npx tsx src/headless/cli.ts --seed 42 --night 1 --ticks 600 --out /tmp/det1.jsonl
npx tsx src/headless/cli.ts --seed 42 --night 1 --ticks 600 --out /tmp/det2.jsonl
diff -u /tmp/det1.jsonl /tmp/det2.jsonl
```

- Pass: `diff -u` exits `0` with empty output (byte-identical).
- Bad inputs/scenario (`--inputs docs/proof/scenarios/bad-inputs.json`) must exit with code `2` and non-empty `stderr`.

## 3. Run Phase 4 Soak Test (Headless)

```bash
npx tsx src/headless/soak.ts --seed 7 --nights 10 --out soak.json
```

- Cycles 10 Nights (`1 -> 2 -> 3`, seed `7 + i`) in one process.
- Pass: `crashes === 0` and `mem_end_mb <= 1.2 * mem_start_mb`.

## 4. Run Phase 4 Benchmark & Leaderboard Export (Launcher)

```bash
npm run build
node scripts/play.mjs --bench --seed 42 --duration 30 --out bench.json
node scripts/play.mjs --export-leaderboard /tmp/lb.json
```

- Bench requires Chrome/Chromium (`1280x720`, 200 shades, 100 motes, creative extras OFF, `3 s` warm-up + `--duration`). Pass thresholds: `avg_fps >= 60`, `p1_low_fps >= 30`, `load_ms <= 10000`.
- `--export-leaderboard` writes `{"entries":[...]}` in order and exits `0` without starting the server.

## 5. Save Evidence under `docs/proof/`

1. Run `npm run verify` (`typecheck` + `vitest` + `scripts/verify.sh`).
2. Record a traceability table in `docs/proof/phase-<N>.md` (`PASS` or honest `NOT VERIFIED` with reason).
3. Never hand-edit JSONL, `bench.json`, or `soak.json` outputs, or weaken assertions to make a check pass.
