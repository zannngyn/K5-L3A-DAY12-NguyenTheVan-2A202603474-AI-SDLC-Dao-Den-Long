# Project Retrospective (Draft)

> Status: Draft skeleton prepared in Phase 2. Final numbers, Phase 3–4 outcomes, and measurements to be filled in after Phase 4 / Release `v1.0.0`.

## 1. Project Summary & Metrics
- Phases completed: Phase 1 (`phase-1`), Phase 2 (`phase-2` in progress), Phase 3 (TBD), Phase 4 / `v1.0.0` (TBD)
- Total commits / tags: TBD
- Automated test & scenario counts: TBD
- Headless runtime & FPS measurements: TBD
- Total token / cost estimate: TBD by user

## 2. What Worked Well
- Separating pure deterministic simulation (`src/sim`) from Three.js client (`renderer`/HUD/input/audio) enabled fast headless verification.
- Offloading specs to files (`docs/notes/design-phase1.md`, `docs/notes/design-phase2.md`, `docs/notes/assumptions-phase2.md`) kept worker prompts small and consistent.
- Strict file ownership allowed parallel work across design, sim, client, and docs without merge conflicts.

## 3. AI Mistakes & Harness Evolution
- Coordinator shell command hung on stdin -> avoid interactive stdin in automated commands.
- Cross-ownership CSS import caused a typecheck failure -> documented ownership split and cross-boundary reporting rule in `AGENTS.md`.
- Dev server failed once due to an empty port variable -> use explicit default port / `npm run dev`.
- Missing browser capture led to honest `"visual not verified"` reporting -> codified evidence honesty rules in `AGENTS.md` and `.claude/skills/headless-proof/SKILL.md`.
- Phase 3–4 harness updates: TBD

## 4. Token & Cost Efficiency
- Saved tokens by offloading specs to files, using small ownership-scoped prompts, avoiding repeated polling, and keeping `AGENTS.md` <= 60 lines with skills loaded on demand.
- Per-phase token/cost breakdown: TBD by user

## 5. Lessons Learned & What We Would Change Next Time
- Set up `AGENTS.md` and verification skills from the start of Phase 1 so git history tracks every phase's evolution cleanly.
- Ensure a browser capture / visual verification path is ready early so visual checks do not remain `"not verified"`.
- Additional lessons from Phases 3–4: TBD
