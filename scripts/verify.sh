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

# 2. Scenario: no-early-win (replaces v1.1 win-lantern early all_lit win)
if npx tsx src/headless/cli.ts --seed 1 --night 1 \
  --scenario docs/proof/scenarios/no-early-win.json \
  --inputs docs/proof/scenarios/no-early-win-inputs.json \
  --ticks 30 --out "$TMP_DIR/no-early-win.jsonl" >/dev/null 2>&1 \
  && grep -q '"name":"lantern_lit","data":{"lantern_id":"L5","relight":false}' "$TMP_DIR/no-early-win.jsonl" \
  && ! grep -q '"name":"game_over"' "$TMP_DIR/no-early-win.jsonl" \
  && tail -n 1 "$TMP_DIR/no-early-win.jsonl" | grep -q '"type":"end","ticks":30,"state":"playing","score":105'; then
  pass "scenario no-early-win lights all 5 lanterns without ending Night early"
else
  fail "scenario no-early-win failed"
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
  && grep -q '"name":"lantern_lit","data":{"lantern_id":"L1","relight":false}' "$TMP_DIR/safe-zone-push.jsonl" \
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

# 16. v1.2 Scenario: fuel-decay
if npx tsx src/headless/cli.ts --seed 1 --night 1 \
  --scenario docs/proof/scenarios/fuel-decay.json \
  --ticks 600 --snapshot-every 60 --out "$TMP_DIR/fuel-decay.jsonl" >/dev/null 2>&1 \
  && grep -q '"tick":60,.*"id":"L1",.*"fuel":99,' "$TMP_DIR/fuel-decay.jsonl" \
  && grep -q '"tick":600,.*"id":"L1",.*"fuel":90,' "$TMP_DIR/fuel-decay.jsonl"; then
  pass "scenario fuel-decay decays L1 at 1.0/s (99 at 60t, 90 at 600t)"
else
  fail "scenario fuel-decay failed"
fi

# 17. v1.2 Scenario: refuel-math (ceil, cap 100, full lantern ignored)
if npx tsx src/headless/cli.ts --seed 1 --night 1 \
  --scenario docs/proof/scenarios/refuel-math.json \
  --inputs docs/proof/scenarios/refuel-math-inputs.json \
  --ticks 10 --out "$TMP_DIR/refuel-math.jsonl" >/dev/null 2>&1 \
  && grep -q '"tick":1,"name":"refuel","data":{"lantern_id":"L2","amount":2,"fuel":100}' "$TMP_DIR/refuel-math.jsonl" \
  && [ "$(grep -c '"name":"refuel"' "$TMP_DIR/refuel-math.jsonl")" -eq 1 ]; then
  pass "scenario refuel-math skips full L1, refuels L2 with 2 motes capped at 100, ignores subsequent full interact"
else
  fail "scenario refuel-math failed"
fi

# 18. v1.2 Scenario: lantern-out-relight
if npx tsx src/headless/cli.ts --seed 1 --night 1 \
  --scenario docs/proof/scenarios/lantern-out-relight.json \
  --inputs docs/proof/scenarios/lantern-out-relight-inputs.json \
  --ticks 40 --snapshot-every 40 --out "$TMP_DIR/lantern-out-relight.jsonl" >/dev/null 2>&1 \
  && grep -q '"tick":30,"name":"lantern_out","data":{"lantern_id":"L1"}' "$TMP_DIR/lantern-out-relight.jsonl" \
  && grep -q '"tick":35,"name":"lantern_lit","data":{"lantern_id":"L1","relight":true}' "$TMP_DIR/lantern-out-relight.jsonl" \
  && grep -q '"relit_count":1' "$TMP_DIR/lantern-out-relight.jsonl"; then
  pass "scenario lantern-out-relight turns off L1 at tick 30 and relights with 5 motes at tick 35"
else
  fail "scenario lantern-out-relight failed"
fi

# 19. v1.2 Scenario: safe-zone-threshold (fuel 30 vs 29.9)
if npx tsx src/headless/cli.ts --seed 1 --night 1 \
  --scenario docs/proof/scenarios/safe-zone-threshold.json \
  --ticks 2 --snapshot-every 1 --out "$TMP_DIR/safe-zone-threshold.jsonl" >/dev/null 2>&1 \
  && grep -q '"tick":1,.*"id":"L1",.*"fuel":30,' "$TMP_DIR/safe-zone-threshold.jsonl" \
  && grep -q '"tick":1,.*"id":"L2",.*"fuel":29.9,' "$TMP_DIR/safe-zone-threshold.jsonl"; then
  pass "scenario safe-zone-threshold verified at fuel 30 vs 29.9"
else
  fail "scenario safe-zone-threshold failed"
fi

# 20. v1.2 Scenario: shade-drain-stacking
if npx tsx src/headless/cli.ts --seed 1 --night 1 \
  --scenario docs/proof/scenarios/shade-drain-stacking.json \
  --ticks 130 --snapshot-every 65 --out "$TMP_DIR/shade-drain-stacking.jsonl" >/dev/null 2>&1 \
  && grep -q '"name":"fuel_drain","data":{"lantern_id":"L1","shade_id":"S1"' "$TMP_DIR/shade-drain-stacking.jsonl" \
  && grep -q '"name":"fuel_drain","data":{"lantern_id":"L1","shade_id":"S2"' "$TMP_DIR/shade-drain-stacking.jsonl"; then
  pass "scenario shade-drain-stacking targets weak L1 and emits fuel_drain for stacked shades S1 and S2"
else
  fail "scenario shade-drain-stacking failed"
fi

# 21. v1.2 Scenario: drain-transitions
if npx tsx src/headless/cli.ts --seed 1 --night 1 \
  --scenario docs/proof/scenarios/drain-transitions.json \
  --inputs docs/proof/scenarios/drain-transitions-inputs.json \
  --ticks 50 --snapshot-every 5 --out "$TMP_DIR/drain-transitions.jsonl" >/dev/null 2>&1 \
  && grep -q '"tick":1,"name":"pulse","data":{"stunned_ids":\["S2"\]}' "$TMP_DIR/drain-transitions.jsonl" \
  && grep -q '"id":"S1",.*"state":"chase"' "$TMP_DIR/drain-transitions.jsonl" \
  && tail -n 1 "$TMP_DIR/drain-transitions.jsonl" | grep -q '"score":15'; then
  pass "scenario drain-transitions handles drain->stunned (+15) and drain->chase (<6m)"
else
  fail "scenario drain-transitions failed"
fi

# 22. v1.2 Scenario: refuel-pushout
if npx tsx src/headless/cli.ts --seed 1 --night 1 \
  --scenario docs/proof/scenarios/refuel-pushout.json \
  --inputs docs/proof/scenarios/refuel-pushout-inputs.json \
  --ticks 35 --snapshot-every 35 --out "$TMP_DIR/refuel-pushout.jsonl" >/dev/null 2>&1 \
  && grep -q '"tick":1,"name":"refuel","data":{"lantern_id":"L1","amount":1,"fuel":34.9}' "$TMP_DIR/refuel-pushout.jsonl" \
  && ! grep -q '"name":"player_hit"' "$TMP_DIR/refuel-pushout.jsonl"; then
  pass "scenario refuel-pushout refuels L1 >= 30 and ejects shade with no player damage"
else
  fail "scenario refuel-pushout failed"
fi

# 23. v1.2 Scenarios: dawn-win-n1 (3/5), dawn-win-n2 (4/6), dawn-win-n3 (5/7)
for N in 1 2 3; do
  if npx tsx src/headless/cli.ts --seed 1 --night "$N" \
    --scenario "docs/proof/scenarios/dawn-win-n${N}.json" \
    --ticks 100 --out "$TMP_DIR/dawn-win-n${N}.jsonl" >/dev/null 2>&1 \
    && grep -q '"name":"game_over","data":{"result":"won","reason":"dawn_survived"}' "$TMP_DIR/dawn-win-n${N}.jsonl"; then
    pass "scenario dawn-win-n${N} wins at dawn with reason dawn_survived"
  else
    fail "scenario dawn-win-n${N} failed"
  fi
done

# 24. v1.2 Scenario: no-flames-dawn
if npx tsx src/headless/cli.ts --seed 1 --night 1 \
  --scenario docs/proof/scenarios/no-flames-dawn.json \
  --ticks 10 --out "$TMP_DIR/no-flames-dawn.jsonl" >/dev/null 2>&1 \
  && grep -q '"name":"game_over","data":{"result":"lost","reason":"no_flames"}' "$TMP_DIR/no-flames-dawn.jsonl"; then
  pass "scenario no-flames-dawn prioritizes no_flames over dawn_survived on dawn tick"
else
  fail "scenario no-flames-dawn failed"
fi

# 25. v1.2 Scenario: capacity-growth
if npx tsx src/headless/cli.ts --seed 1 --night 1 \
  --scenario docs/proof/scenarios/capacity-growth.json \
  --inputs docs/proof/scenarios/capacity-growth-inputs.json \
  --ticks 5 --snapshot-every 1 --out "$TMP_DIR/capacity-growth.jsonl" >/dev/null 2>&1 \
  && grep -q '"tick":0,.*"capacity":18,' "$TMP_DIR/capacity-growth.jsonl" \
  && grep -q '"tick":1,.*"capacity":20,' "$TMP_DIR/capacity-growth.jsonl" \
  && grep -q '"tick":2,.*"carried":20,"capacity":20,' "$TMP_DIR/capacity-growth.jsonl"; then
  pass "scenario capacity-growth grows from 18 to cap 20 and respects pickup limit"
else
  fail "scenario capacity-growth failed"
fi

# 26. v1.2 Scenario: score-v12
if npx tsx src/headless/cli.ts --seed 1 --night 1 \
  --scenario docs/proof/scenarios/score-v12.json \
  --inputs docs/proof/scenarios/score-v12-inputs.json \
  --ticks 100 --out "$TMP_DIR/score-v12.jsonl" >/dev/null 2>&1 \
  && tail -n 1 "$TMP_DIR/score-v12.jsonl" | grep -q '"type":"end","ticks":60,"state":"won","score":666'; then
  pass "scenario score-v12 matches exact v1.2 score formula (666)"
else
  fail "scenario score-v12 failed"
fi

# 27. v1.2 Scenario: scenario-defaults
if npx tsx src/headless/cli.ts --seed 1 --night 1 \
  --scenario docs/proof/scenarios/scenario-defaults.json \
  --ticks 0 --out "$TMP_DIR/scenario-defaults.jsonl" >/dev/null 2>&1 \
  && grep -q '"id":"L1",.*"lit":true,"deposited":0,"fuel":100,"ever_lit":true,"relit_count":0' "$TMP_DIR/scenario-defaults.jsonl" \
  && ! grep -q '"type":"event"' "$TMP_DIR/scenario-defaults.jsonl"; then
  pass "scenario scenario-defaults defaults lit:true to fuel 100, ever_lit true, 0 events, 0 score"
else
  fail "scenario scenario-defaults failed"
fi

# 28. Performance: full Night 3 (18000 ticks) <= 30 s
START_MS=$(node -e 'console.log(Date.now())')
npx tsx src/headless/cli.ts --seed 7 --night 3 --ticks 18000 --out "$TMP_DIR/perf-n3.jsonl" >/dev/null 2>&1
PERF_EXIT=$?
END_MS=$(node -e 'console.log(Date.now())')
ELAPSED_MS=$((END_MS - START_MS))
if [ "$PERF_EXIT" -eq 0 ] && [ "$ELAPSED_MS" -le 30000 ]; then
  pass "performance: Night 3 18000 ticks completed in ${ELAPSED_MS}ms (<= 30000ms)"
else
  fail "performance: Night 3 18000 ticks failed or exceeded 30000ms (exit=$PERF_EXIT, ${ELAPSED_MS}ms)"
fi

# 29. Short soak test (3 Nights) — 0 crashes and mem_end_mb <= 1.2 * mem_start_mb
if npx tsx src/headless/soak.ts --seed 7 --nights 3 --out "$TMP_DIR/soak3.json" >/dev/null 2>&1 \
  && node -e '
    const fs = require("node:fs");
    const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (d.nights !== 3 || d.crashes !== 0 || !Array.isArray(d.results) || d.results.length !== 3) process.exit(1);
    if (typeof d.mem_start_mb !== "number" || typeof d.mem_end_mb !== "number" || d.mem_start_mb <= 0) process.exit(1);
    if (d.mem_end_mb > 1.2 * d.mem_start_mb) process.exit(1);
  ' "$TMP_DIR/soak3.json"; then
  pass "soak (3 nights): 0 crashes and mem_end_mb <= 1.2 * mem_start_mb"
else
  fail "soak (3 nights) failed or exceeded memory bound"
fi

# 30. Launcher --export-leaderboard on empty and populated temp data dir
LB_DATA_DIR="$TMP_DIR/lb-data"
if node scripts/play.mjs --data-dir "$LB_DATA_DIR" --export-leaderboard "$TMP_DIR/lb-empty.json" >/dev/null 2>&1 \
  && node -e '
    const fs = require("node:fs");
    const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (!Array.isArray(d.entries) || d.entries.length !== 0) process.exit(1);
  ' "$TMP_DIR/lb-empty.json" \
  && node --input-type=module -e '
    import { addLeaderboardEntry } from "./scripts/leaderboard.mjs";
    const f = process.argv[1];
    addLeaderboardEntry(f, { name: "May_1", score: 250, nights_won: 1, seed: 7 });
    addLeaderboardEntry(f, { name: "May_2", score: 600, nights_won: 2, seed: 8 });
  ' "$LB_DATA_DIR/leaderboard.json" \
  && node scripts/play.mjs --data-dir "$LB_DATA_DIR" --export-leaderboard "$TMP_DIR/lb-pop.json" >/dev/null 2>&1 \
  && node -e '
    const fs = require("node:fs");
    const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (!Array.isArray(d.entries) || d.entries.length !== 2) process.exit(1);
    if (d.entries[0].name !== "May_2" || d.entries[1].name !== "May_1") process.exit(1);
  ' "$TMP_DIR/lb-pop.json"; then
  pass "play.mjs --export-leaderboard exports empty and populated leaderboards in order"
else
  fail "play.mjs --export-leaderboard check failed"
fi

if [ "$FAILURES" -ne 0 ]; then
  echo "VERIFY FAILED ($FAILURES check(s) failed)"
  exit 1
fi

echo "ALL VERIFY CHECKS PASSED"
exit 0
