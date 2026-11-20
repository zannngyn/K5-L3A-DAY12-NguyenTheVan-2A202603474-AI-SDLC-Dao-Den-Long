# AI Usage Log

## Phase 1 — PRD-0 & Contract v1.0

| Role / Worker | Scope & Output | Prompts Summary |
|---|---|---|
| Coordinator | Split work, set file ownership, ran verification & tagging (`phase-1`) | Decomposed PRD-0 + Test Contract v1.0 into design spec and parallel sim/client tasks |
| Design Worker | Authored `docs/notes/design-phase1.md` and tuning/interface spec | Asked to resolve PRD-0 ambiguities into concrete assumptions and TypeScript interfaces |
| Dev Worker 1 (Sim & Headless) | Built deterministic `src/sim/**`, `src/headless/cli.ts`, `game.contract.json`, unit tests, `scripts/verify.sh`, and Phase 1 proof scenarios | Scoped prompt referencing `design-phase1.md`; strict purity rules (no DOM/Three/`Math.random`) |
| Dev Worker 2 (Client) | Built Three.js renderer, camera, input, HUD, and browser entry point | Scoped prompt reading only `Sim` public exports; visual palette and controls |

- **Token / cost estimate (Phase 1):** TBD by user

## Phase 2 — Ticket-02 ("Ba hòn đảo") & Contract v1.1

| Role / Worker | Scope & Output | Prompts Summary |
|---|---|---|
| Coordinator | Ingested `ticket-02.md`, delegated design update, split Phase 2 implementation and harness/docs | Ownership-scoped briefs referencing `.swarm/specs/ticket-02.md` and `.swarm/specs/design-phase2.md` |
| Design Worker | Authored `docs/notes/design-phase2.md` and `docs/notes/assumptions-phase2.md` | Standardized Part 1 tuning, 3-Night map tables, Part 3 acceptance criteria, Contract v1.1 interfaces |
| Dev Worker 1 (Sim & Headless) | Updating `src/sim/**`, `src/headless/cli.ts`, `game.contract.json`, and tests for Contract v1.1 | Scoped to sim/headless/tests with regression requirement for Phase 1 tests |
| Dev Worker 2 (Client) | Updating 3-Night visuals, palette, HUD, pause/settings, and WebAudio | Scoped to client files reading `Sim` exports |
| Docs / Harness Worker | Created `AGENTS.md`, `.claude/skills/headless-proof/SKILL.md`, `docs/notes/ai-log.md`, `docs/notes/retro-draft.md` | Scoped strictly to harness and notes files without touching code |

- **Token / cost estimate (Phase 2):** TBD by user

## Phase 3 — Ticket-03 ("Đèn cạn dầu") & Contract v1.2

| Role / Worker | Scope & Output | Prompts Summary |
|---|---|---|
| Coordinator | Ingested `ticket-03.md`, split v1.2 sim/client/docs work in parallel, coordinated verification & tagging (`phase-3`) | Ownership-scoped briefs referencing `.swarm/specs/ticket-03.md` and Contract v1.2 |
| Dev Worker 1 (Sim & Headless) | Implemented integer `1/60` lantern fuel, refuel/relight, `fuel >= 30` safe zone, shade `drain` state, dawn survival win (`ceil(0.6*n)`), dynamic capacity, v1.2 score/contract/CLI, and updated tests | Scoped to `src/sim/**`, `src/headless/**`, `game.contract.json`, `tests/**`, `scripts/**` |
| Dev Worker 2 (Client) | Added lantern fuel bars, 1 Hz low-fuel flash, unlit squashed/torn-paper silhouette, HUD `carried/capacity`, color-blind mode ("Bảng màu dễ phân biệt"), and fixed third-person camera jitter | Scoped to client files reading `Sim` exports |
| Docs / Harness Worker | Authored `adr-0001-lantern-fuel-and-dawn-win.md`, `spec-phase3.md`, `CHANGELOG.md`, Vietnamese game `README.md`, updated `AGENTS.md`, `SKILL.md`, and `ai-log.md` | Scoped strictly to docs and harness files; no code edits |

- **Token / cost estimate (Phase 3):** TBD by user

## Phase 4 — Ticket-04 ("Bình minh: phát hành v1.0.0") & Contract v1.3

| Role / Worker | Scope & Output | Prompts Summary |
|---|---|---|
| Coordinator | Ingested `ticket-04.md`, authored `.swarm/specs/phase4-architecture.md` (zero-dep launcher, bench/soak/leaderboard APIs), split Phase 4 implementation and docs in parallel | Ownership-scoped briefs referencing `.swarm/specs/ticket-04.md` and `phase4-architecture.md` |
| Dev Worker 1 (Sim, Headless, Soak & Launcher) | Implementing `makeBenchScenario` + `SimOptions.bench`, `src/headless/soak.ts`, `scripts/play.mjs` (launcher, `/api/leaderboard`, `/api/bench/*`, `--export-leaderboard`), `scripts/package-release.sh`, Contract v1.3, and tests | Scoped to `src/sim/**`, `src/headless/**`, `game.contract.json`, `tests/**`, `scripts/**` |
| Dev Worker 2 (Client) | Implementing `?bench=1` orbit-camera benchmark mode (with InstancedMesh & creative extras OFF), Leaderboard UI, Key Rebinding, visual cues/captions, Reduced Motion, and `18 px` / `1.25x` Large Text | Scoped to client files reading `Sim` exports |
| Docs / Harness Worker | Authored `docs/notes/spec-phase4.md`, `docs/notes/retro.md`, updated `README.md`, `CHANGELOG.md`, `CREDITS.md`, `AGENTS.md`, `.claude/skills/headless-proof/SKILL.md`, and `docs/notes/ai-log.md` | Scoped strictly to docs and harness files; no code edits |

- **Token / cost estimate (Phase 4):** TBD by user

## AI Mistakes Found & How Detected

| # | Incident | How Detected | Resolution / Harness Change |
|---|---|---|---|
| 1 | A coordinator shell command hung waiting on stdin | Command timed out / stalled with no output | Avoid interactive stdin in shell commands; pass explicit non-interactive flags/inputs |
| 2 | A dev worker hit a typecheck error from a CSS import outside its file ownership | `npm run typecheck` failed during verification | Kept ownership strict; reported cross-boundary error to coordinator instead of editing outside scope; codified ownership rule in `AGENTS.md` |
| 3 | The dev server failed once due to an empty port variable | Server startup command exited with error when port env var was unset | Provide an explicit default port or rely on `npm run dev` (`vite`) default |
| 4 | A worker reported `"visual not verified"` because no browser capture tool was available | Worker handoff explicitly flagged missing browser capture | Preserved honest `"not verified"` status in evidence rather than guessing; codified honesty rule in `AGENTS.md` |
| 5 | Third-person camera jittered noticeably during gameplay despite all automated checks passing | Found by the user during manual playtesting; automated unit/headless checks missed it because nobody visually viewed or played the rendered page | Fixed camera smoothing/update in client; added manual playtest / visual check lesson — headless/unit passes do not substitute for viewing the live render |

## Token-Saving Practices
- **Specs offloaded to files:** Kept detailed requirements and interfaces in `.swarm/specs/` and `docs/notes/` so workers read files on demand instead of repeating full specs in chat.
- **Small ownership-scoped prompts:** Each worker received only its owned paths, acceptance criteria, and verification command.
- **No repeated polling:** Relied on reactive handoffs/notifications rather than polling loops.
- **Short `AGENTS.md` + on-demand skill:** Kept `AGENTS.md` under 60 lines and moved the headless verification procedure into `.claude/skills/headless-proof/SKILL.md`.
