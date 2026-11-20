#!/usr/bin/env bash
set -uo pipefail

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

FAILURES=0

pass() {
  echo "PASS: $1"
}

fail() {
  echo "FAIL: $1"
  FAILURES=$((FAILURES + 1))
}

# 1. Scenario: mote-pickup (v1.1 accel + 6 m/s + 1.0 m radius -> tick 43)
if npx tsx src/headless/cli.ts --seed 1 --night 1 \
  --scenario docs/proof/scenarios/mote-pickup.json \
  --inputs docs/proof/scenarios/mote-pickup-inputs.json \
  --ticks 60 --out "$TMP_DIR/mote-pickup.jsonl" >/dev/null 2>&1 \
  && grep -q '"tick":43,"name":"mote_picked","data":{"carried":1}' "$TMP_DIR/mote-pickup.jsonl"; then
  pass "scenario mote-pickup yields mote_picked at tick 43"
else
  fail "scenario mote-pickup did not yield mote_picked at tick 43"
fi

# 2. Scenario: win-lantern (v1.1 score: 10 + 100 + 99*2 + 3*50 = 458)
if npx tsx src/headless/cli.ts --seed 1 --night 1 \
  --scenario docs/proof/scenarios/win-lantern.json \
  --inputs docs/proof/scenarios/win-lantern-inputs.json \
  --ticks 100 --out "$TMP_DIR/win-lantern.jsonl" >/dev/null 2>&1 \
  && grep -q '"name":"lantern_lit","data":{"lantern_id":"L5"}' "$TMP_DIR/win-lantern.jsonl" \
  && grep -q '"name":"game_over","data":{"result":"won","reason":"all_lit"}' "$TMP_DIR/win-lantern.jsonl" \
  && tail -n 1 "$TMP_DIR/win-lantern.jsonl" | grep -q '"type":"end","ticks":1,"state":"won","score":458'; then
  pass "scenario win-lantern wins early at tick 1 with expected v1.1 score 458"
else
  fail "scenario win-lantern did not win as expected"
fi

# 3. Scenario: pulse-and-hit (v1.1 pulse stun/push then shade recovery & hit)
if npx tsx src/headless/cli.ts --seed 1 --night 1 \
  --scenario docs/proof/scenarios/pulse-and-hit.json \
  --inputs docs/proof/scenarios/pulse-and-hit-inputs.json \
  --ticks 400 --out "$TMP_DIR/pulse-and-hit.jsonl" >/dev/null 2>&1 \
  && grep -q '"tick":1,"name":"pulse","data":{"stunned_ids":\["S1"\]}' "$TMP_DIR/pulse-and-hit.jsonl" \
  && grep -q '"name":"player_hit","data":{"by":"shade","flames":2,"dropped":1}' "$TMP_DIR/pulse-and-hit.jsonl"; then
  pass "scenario pulse-and-hit pulses S1 then takes shade hit after stun expires"
else
  fail "scenario pulse-and-hit did not emit expected pulse and player_hit events"
fi

# 4. Scenario: dash
if npx tsx src/headless/cli.ts --seed 1 --night 1 \
  --scenario docs/proof/scenarios/dash.json \
  --inputs docs/proof/scenarios/dash-inputs.json \
  --ticks 30 --snapshot-every 12 --out "$TMP_DIR/dash.jsonl" >/dev/null 2>&1 \
  && grep -q '"tick":1,"name":"dash","data":{}' "$TMP_DIR/dash.jsonl" \
  && grep -q '"tick":12,.*"pos":\[0,0,2.8\]' "$TMP_DIR/dash.jsonl"; then
  pass "scenario dash emits dash event and travels 2.8m in 12 ticks"
else
  fail "scenario dash did not produce expected dash event/distance"
fi

# 5. Scenario: fall-respawn
if npx tsx src/headless/cli.ts --seed 1 --night 1 \
  --scenario docs/proof/scenarios/fall-respawn.json \
  --inputs docs/proof/scenarios/fall-respawn-inputs.json \
  --ticks 200 --snapshot-every 10 --out "$TMP_DIR/fall-respawn.jsonl" >/dev/null 2>&1 \
  && grep -q '"name":"player_hit","data":{"by":"fall","flames":2,"dropped":0,"lost":4}' "$TMP_DIR/fall-respawn.jsonl" \
  && grep -q '"tick":200,.*"pos":\[0,0,0\]' "$TMP_DIR/fall-respawn.jsonl"; then
  pass "scenario fall-respawn triggers fall penalty (lost:4) and respawns at [0,0,0]"
else
  fail "scenario fall-respawn did not trigger expected fall/respawn"
fi

# 6. Scenario: jump-pad (Night 2 JP1)
if npx tsx src/headless/cli.ts --seed 1 --night 2 \
  --scenario docs/proof/scenarios/jump-pad.json \
  --ticks 100 --snapshot-every 100 --out "$TMP_DIR/jump-pad.jsonl" >/dev/null 2>&1 \
  && grep -q '"tick":100,.*"grounded":true' "$TMP_DIR/jump-pad.jsonl"; then
  pass "scenario jump-pad launches player from Night 2 JP1 and lands on Island B"
else
  fail "scenario jump-pad did not land as expected"
fi

# 7. Scenario: wind (Night 3 gust at tick 1800)
if npx tsx src/headless/cli.ts --seed 7 --night 3 \
  --scenario docs/proof/scenarios/wind.json \
  --ticks 1820 --snapshot-every 1800 --out "$TMP_DIR/wind.jsonl" >/dev/null 2>&1 \
  && grep -q '"tick":1800,.*"wind":{"active":true' "$TMP_DIR/wind.jsonl"; then
  pass "scenario wind activates Night 3 gust at sim_tick 1800"
else
  fail "scenario wind did not activate gust at tick 1800"
fi

# 8. Scenario: drifter (steal, flee, pulse -> drifter_drop)
if npx tsx src/headless/cli.ts --seed 1 --night 2 \
  --scenario docs/proof/scenarios/drifter.json \
  --inputs docs/proof/scenarios/drifter-inputs.json \
  --ticks 30 --out "$TMP_DIR/drifter.jsonl" >/dev/null 2>&1 \
  && grep -q '"name":"drifter_steal","data":{"drifter_id":"D1","amount":3,"carried":3}' "$TMP_DIR/drifter.jsonl" \
  && grep -q '"name":"drifter_drop","data":{"drifter_id":"D1","amount":3}' "$TMP_DIR/drifter.jsonl"; then
  pass "scenario drifter steals 3 motes then drops them when pulsed while fleeing"
else
  fail "scenario drifter did not emit expected drifter_steal and drifter_drop"
fi

# 9. Scenario: charm (Night 2 Wind Charm pickup + 0 dash cooldown)
if npx tsx src/headless/cli.ts --seed 1 --night 2 \
  --scenario docs/proof/scenarios/charm.json \
  --inputs docs/proof/scenarios/charm-inputs.json \
  --ticks 30 --out "$TMP_DIR/charm.jsonl" >/dev/null 2>&1 \
  && grep -q '"name":"charm_picked","data":{"charm_id":"C1","charm_ticks":600}' "$TMP_DIR/charm.jsonl" \
  && [ "$(grep -c '"name":"dash"' "$TMP_DIR/charm.jsonl")" -eq 2 ]; then
  pass "scenario charm picks up C1 and allows back-to-back dashes with 0 cooldown"
else
  fail "scenario charm did not emit expected charm_picked and 2 dash events"
fi

# 10. Scenario: pause-resume
if npx tsx src/headless/cli.ts --seed 1 --night 1 \
  --scenario docs/proof/scenarios/pause-resume.json \
  --inputs docs/proof/scenarios/pause-resume-inputs.json \
  --ticks 25 --snapshot-every 10 --out "$TMP_DIR/pause-resume.jsonl" >/dev/null 2>&1 \
  && grep -q '"tick":6,"name":"paused","data":{}' "$TMP_DIR/pause-resume.jsonl" \
  && grep -q '"tick":10,"sim_tick":5,.*"state":"paused"' "$TMP_DIR/pause-resume.jsonl" \
  && grep -q '"tick":16,"name":"resumed","data":{}' "$TMP_DIR/pause-resume.jsonl"; then
  pass "scenario pause-resume freezes sim_tick during pause and resumes cleanly"
else
  fail "scenario pause-resume did not pause/resume as expected"
fi

# 11. Scenario: safe-zone-push
if npx tsx src/headless/cli.ts --seed 1 --night 1 \
  --scenario docs/proof/scenarios/safe-zone-push.json \
  --inputs docs/proof/scenarios/safe-zone-push-inputs.json \
  --ticks 40 --snapshot-every 40 --out "$TMP_DIR/safe-zone-push.jsonl" >/dev/null 2>&1 \
  && grep -q '"name":"lantern_lit","data":{"lantern_id":"L1"}' "$TMP_DIR/safe-zone-push.jsonl" \
  && ! grep -q '"name":"player_hit"' "$TMP_DIR/safe-zone-push.jsonl"; then
  pass "scenario safe-zone-push ejects shade on lantern_lit with no player damage"
else
  fail "scenario safe-zone-push failed"
fi

# 12. Scenario: pulse-standard (3D targeting from feet+0.8, +5 score)
if npx tsx src/headless/cli.ts --seed 1 --night 1 \
  --scenario docs/proof/scenarios/pulse-standard.json \
  --inputs docs/proof/scenarios/pulse-standard-inputs.json \
  --ticks 20 --snapshot-every 20 --out "$TMP_DIR/pulse-standard.jsonl" >/dev/null 2>&1 \
  && grep -q '"tick":1,"name":"pulse","data":{"stunned_ids":\["S1"\]}' "$TMP_DIR/pulse-standard.jsonl" \
  && tail -n 1 "$TMP_DIR/pulse-standard.jsonl" | grep -q '"score":5'; then
  pass "scenario pulse-standard hits 3D target S1, ignores out-of-range S2, awards +5 score"
else
  fail "scenario pulse-standard failed"
fi

# 13. Each Night loading (1, 2, 3)
for N in 1 2 3; do
  if npx tsx src/headless/cli.ts --seed 1 --night "$N" \
    --scenario "docs/proof/scenarios/night${N}-load.json" \
    --ticks 10 --snapshot-every 10 --out "$TMP_DIR/night${N}-load.jsonl" >/dev/null 2>&1 \
    && grep -q "\"tick\":1,\"name\":\"night_start\",\"data\":{\"night\":${N}}" "$TMP_DIR/night${N}-load.jsonl"; then
    pass "scenario night${N}-load boots Night ${N} and emits night_start"
  else
    fail "scenario night${N}-load failed"
  fi
done

# 14. Determinism: same seed run twice produces byte-identical output for each Night (1, 2, 3)
for N in 1 2 3; do
  if npx tsx src/headless/cli.ts --seed 42 --night "$N" --ticks 600 --out "$TMP_DIR/det-n${N}-1.jsonl" >/dev/null 2>&1 \
    && npx tsx src/headless/cli.ts --seed 42 --night "$N" --ticks 600 --out "$TMP_DIR/det-n${N}-2.jsonl" >/dev/null 2>&1 \
    && diff -u "$TMP_DIR/det-n${N}-1.jsonl" "$TMP_DIR/det-n${N}-2.jsonl" >/dev/null 2>&1; then
    pass "determinism: Night ${N} seed 42 runs are byte-identical"
  else
    fail "determinism: Night ${N} seed 42 runs differed"
  fi
done

# 15. Bad inputs file exits with code 2 and writes to stderr
BAD_STDERR="$TMP_DIR/bad.err"
npx tsx src/headless/cli.ts --seed 1 --night 1 \
  --inputs docs/proof/scenarios/bad-inputs.json \
  --ticks 10 --out "$TMP_DIR/bad.jsonl" 2>"$BAD_STDERR"
BAD_EXIT=$?
if [ "$BAD_EXIT" -eq 2 ] && [ -s "$BAD_STDERR" ]; then
  pass "bad inputs file exits with code 2 and stderr message"
else
  fail "bad inputs file expected exit 2 with stderr (got exit $BAD_EXIT)"
fi

# 16. Performance: full Night 3 (21600 ticks) <= 30 s
START_MS=$(node -e 'console.log(Date.now())')
npx tsx src/headless/cli.ts --seed 7 --night 3 --ticks 21600 --out "$TMP_DIR/perf-n3.jsonl" >/dev/null 2>&1
PERF_EXIT=$?
END_MS=$(node -e 'console.log(Date.now())')
ELAPSED_MS=$((END_MS - START_MS))
if [ "$PERF_EXIT" -eq 0 ] && [ "$ELAPSED_MS" -le 30000 ]; then
  pass "performance: Night 3 21600 ticks completed in ${ELAPSED_MS}ms (<= 30000ms)"
else
  fail "performance: Night 3 21600 ticks failed or exceeded 30000ms (exit=$PERF_EXIT, ${ELAPSED_MS}ms)"
fi

if [ "$FAILURES" -ne 0 ]; then
  echo "VERIFY FAILED ($FAILURES check(s) failed)"
  exit 1
fi

echo "ALL VERIFY CHECKS PASSED"
exit 0
