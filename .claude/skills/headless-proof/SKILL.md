---
name: headless-proof
description: Use when verifying Đảo Đèn Lồng simulation behavior, determinism, error handling, or generating Phase 1–4 headless verification evidence under docs/proof/.
---

# Headless Proof Skill

Run reproducible headless checks against `src/headless/cli.ts` and record evidence under `docs/proof/`.

## 1. Run a Scenario Headless

```bash
npx tsx src/headless/cli.ts \
  --seed 1 \
  --night 1 \
  --scenario docs/proof/scenarios/<name>.json \
  --inputs docs/proof/scenarios/<name>-inputs.json \
  --ticks 300 \
  --out docs/proof/<name>.jsonl
```

- Use `--night 1`, `2`, or `3` (Contract v1.2).
- Inspect the JSONL output to confirm expected `event` lines (including v1.2 `refuel`, `lantern_out`, `fuel_drain`, `lantern_lit { relight }`, `game_over { reason: "dawn_survived" | "dawn" | "no_flames" }`) and the final `{"type":"end",...}` line.

## 2. Verify Determinism (Same Seed Twice + Diff)

```bash
npx tsx src/headless/cli.ts --seed 42 --night 1 --ticks 600 --out /tmp/det1.jsonl
npx tsx src/headless/cli.ts --seed 42 --night 1 --ticks 600 --out /tmp/det2.jsonl
diff -u /tmp/det1.jsonl /tmp/det2.jsonl
```

- Pass condition: `diff -u` exits `0` with empty output (byte-identical JSONL).

## 3. Verify Exit Code 2 on Bad Input/Scenario

```bash
npx tsx src/headless/cli.ts \
  --seed 1 --night 1 \
  --inputs docs/proof/scenarios/bad-inputs.json \
  --ticks 10 --out /tmp/bad.jsonl 2>/tmp/bad.err
echo "exit=$?"
cat /tmp/bad.err
```

- Pass condition: exit code is `2` and stderr is non-empty.

## 4. Save Evidence under `docs/proof/`

1. Store scenario/input JSON files in `docs/proof/scenarios/`.
2. Run the full suite (`npm run verify`) to confirm typecheck, unit tests, and headless checks all pass.
3. Record a traceability table in `docs/proof/phase-<N>.md` mapping each requirement -> command/scenario -> observed result (`PASS` or honest `NOT VERIFIED` with reason).
4. Never hand-edit JSONL outputs or weaken assertions to make a check pass.
