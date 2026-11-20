import {
  Sim,
  TUNING,
  makeBenchScenario,
  type GameOverReason,
  type NightNumber,
  type SimSnapshot,
  type StepInput,
} from "./sim";
import { SoundEffects } from "./audio/soundEffects";
import { HudController } from "./hud/hud";
import { InputManager } from "./input/inputManager";
import { SceneManager, type OffscreenArrowProjection } from "./renderer/sceneManager";
import { MenuController } from "./ui/menuController";
import { loadSettings, saveSettings, type GameSettings } from "./ui/settings";

const FIXED_DT = 1 / 60;
const MAX_FRAME_DT = 0.1;
const BENCH_WARMUP_MS = 3000;

function createBrowserSeed(): number {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return (buf[0] & 0x7fffffff) || 1;
  }
  return (Date.now() & 0x7fffffff) || 1;
}

function applyVisualSettings(
  settings: GameSettings,
  scene: SceneManager,
  hud: HudController
): void {
  document.documentElement.dataset.colorblind = settings.colorBlind ? "true" : "false";
  document.documentElement.dataset.reducedMotion = settings.reducedMotion ? "true" : "false";
  document.documentElement.dataset.largeText = settings.largeText ? "true" : "false";
  scene.setColorBlind(settings.colorBlind);
  scene.setReducedMotion(settings.reducedMotion);
  hud.setReducedMotion(settings.reducedMotion);
  hud.setKeyBindings(settings.keyBindings);
}

interface NightRunStats {
  motesDeposited: number;
  firstLights: number;
  relights: number;
  shadesPulsedNormal: number;
  shadesPulsedDraining: number;
}

function runBenchmark(
  canvasRoot: HTMLElement,
  hudRoot: HTMLElement,
  uiRoot: HTMLElement,
  seed: number,
  durationSec: number
): void {
  hudRoot.style.display = "none";
  uiRoot.style.display = "none";

  const scene = new SceneManager(canvasRoot, { benchMode: true });
  const sim = new Sim({
    seed,
    night: 1,
    scenario: makeBenchScenario(seed),
    bench: true,
  });
  scene.reset(sim.getState());

  const durationMs = Math.max(1, durationSec) * 1000;
  const dts: number[] = [];
  let firstFrameSent = false;
  let firstFrameMs = 0;
  let measureStartMs = 0;
  let measuring = false;
  let prevRafMs = 0;
  let accumulator = 0;
  let done = false;

  const finishBench = (): void => {
    done = true;
    const n = dts.length;
    const sumDt = dts.reduce((acc, v) => acc + v, 0);
    const avgFps = n > 0 && sumDt > 0 ? (1000 * n) / sumDt : 0;

    const sorted = [...dts].sort((a, b) => a - b);
    const k = Math.max(1, Math.ceil(0.01 * n));
    let topKSum = 0;
    for (let i = Math.max(0, n - k); i < n; i++) {
      topKSum += sorted[i];
    }
    const p1LowFps = n > 0 && topKSum > 0 ? 1000 / (topKSum / Math.min(k, n)) : 0;
    const p95Idx = n > 0 ? Math.min(n - 1, Math.max(0, Math.ceil(0.95 * n) - 1)) : 0;
    const frameMsP95 = n > 0 ? sorted[p95Idx] : 0;

    const payload = {
      avg_fps: Number(avgFps.toFixed(2)),
      p1_low_fps: Number(p1LowFps.toFixed(2)),
      frame_ms_p95: Number(frameMsP95.toFixed(2)),
      frames: n,
      renderer: scene.getRendererInfo(),
    };

    void fetch("/api/bench/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {
      // Quietly ignore 404/network error on dev server
    });

    const badge = document.createElement("div");
    badge.className = "bench-done-badge";
    badge.textContent = `bench done | avg ${payload.avg_fps} fps | 1% low ${payload.p1_low_fps} fps | p95 ${payload.frame_ms_p95} ms (${payload.frames} frames)`;
    document.body.appendChild(badge);
  };

  const benchFrame = (nowMs: number): void => {
    if (done) return;

    if (!firstFrameSent) {
      firstFrameSent = true;
      firstFrameMs = nowMs;
      prevRafMs = nowMs;

      scene.renderBench(sim.getState(), 0, 0, 1);
      void fetch("/api/bench/first-frame", { method: "POST" }).catch(() => {
        // Quietly ignore 404/network error on dev server
      });
      requestAnimationFrame(benchFrame);
      return;
    }

    // Raw uncapped, unsmoothed dt from requestAnimationFrame timestamps
    const rawDtMs = nowMs - prevRafMs;
    prevRafMs = nowMs;

    const simDtSec = Math.min(MAX_FRAME_DT, Math.max(0, rawDtMs / 1000));
    accumulator += simDtSec;
    while (accumulator >= FIXED_DT) {
      sim.step({});
      const snap = sim.getState();
      scene.onSimStep(snap, false);
      sim.drainEvents();
      accumulator -= FIXED_DT;
    }

    const orbitElapsedSec = Math.max(0, (nowMs - firstFrameMs) / 1000);
    const alpha = Math.max(0, Math.min(1, accumulator / FIXED_DT));
    scene.renderBench(sim.getState(), orbitElapsedSec, Math.max(0, rawDtMs / 1000), alpha);

    if (!measuring) {
      if (nowMs - firstFrameMs >= BENCH_WARMUP_MS) {
        measuring = true;
        measureStartMs = nowMs;
      }
    } else {
      if (rawDtMs > 0) {
        dts.push(rawDtMs);
      }
      if (nowMs - measureStartMs >= durationMs) {
        finishBench();
        return;
      }
    }

    requestAnimationFrame(benchFrame);
  };

  requestAnimationFrame(benchFrame);
}

function bootstrap(): void {
  const canvasRoot = document.getElementById("canvas-root");
  const hudRoot = document.getElementById("hud-root");
  const uiRoot = document.getElementById("ui-root");
  if (!canvasRoot || !hudRoot || !uiRoot) {
    throw new Error("Missing #canvas-root, #hud-root, or #ui-root in index.html");
  }

  // Benchmark mode (?bench=1&seed=N&duration=S)
  const params = new URLSearchParams(window.location.search);
  if (params.get("bench") === "1") {
    const rawSeed = Number.parseInt(params.get("seed") ?? "42", 10);
    const rawDur = Number.parseFloat(params.get("duration") ?? "30");
    const seed = Number.isFinite(rawSeed) ? rawSeed : 42;
    const duration = Number.isFinite(rawDur) && rawDur > 0 ? rawDur : 30;
    runBenchmark(canvasRoot, hudRoot, uiRoot, seed, duration);
    return;
  }

  const settings = loadSettings();
  const audio = new SoundEffects();
  audio.setVolume(settings.volume);
  audio.setMusicDucked(true);

  const scene = new SceneManager(canvasRoot);
  const hud = new HudController(hudRoot);
  applyVisualSettings(settings, scene, hud);

  let currentNight: NightNumber = 1;
  let currentSeed = createBrowserSeed();
  const wonNightScores: Partial<Record<NightNumber, number>> = {};
  let sim = new Sim({ seed: currentSeed, night: 1 });
  let runStats: NightRunStats = {
    motesDeposited: 0,
    firstLights: 0,
    relights: 0,
    shadesPulsedNormal: 0,
    shadesPulsedDraining: 0,
  };
  let lastCountdownSec = -1;
  let lastWindWarnCycle = -1;
  let prevGrounded = true;
  let prevVelY = 0;
  let accumulator = 0;
  let lastResumedSimTick = -1;

  // Shade-spawned accessibility arrow tracking
  let recentSpawnedShadeId: string | null = null;
  let recentSpawnedShadeTimer = 0;

  // Track lanterns currently in a low-fuel period (blip + caption at most once per lantern per low period)
  const lowFuelWarned = new Set<string>();
  // Pre-allocated set for fallback pulse-draining tracking on the dawn tick
  const drainingShadesBeforeStep = new Set<string>();

  const getTotalCampaignScore = (): number =>
    (wonNightScores[1] ?? 0) + (wonNightScores[2] ?? 0) + (wonNightScores[3] ?? 0);

  const getNightsWonCount = (): number =>
    (wonNightScores[1] !== undefined ? 1 : 0) +
    (wonNightScores[2] !== undefined ? 1 : 0) +
    (wonNightScores[3] !== undefined ? 1 : 0);

  const initNightSim = (night: NightNumber): void => {
    currentNight = night;
    currentSeed = createBrowserSeed();
    sim = new Sim({ seed: currentSeed, night });
    runStats = {
      motesDeposited: 0,
      firstLights: 0,
      relights: 0,
      shadesPulsedNormal: 0,
      shadesPulsedDraining: 0,
    };
    lastCountdownSec = -1;
    lastWindWarnCycle = -1;
    accumulator = 0;
    lastResumedSimTick = -1;
    recentSpawnedShadeId = null;
    recentSpawnedShadeTimer = 0;
    lowFuelWarned.clear();
    drainingShadesBeforeStep.clear();
    const snap = sim.getState();
    prevGrounded = snap.player.grounded;
    prevVelY = snap.player.vel[1];
    input.resetCameraYaw(0);
    input.resetCameraPitch(22);
    scene.reset(snap);
    hud.reset(snap);
    hud.update(snap, 0);
  };

  const enterPlaying = (): void => {
    menu.hide();
    hud.setVisible(true);
    input.setGameplayActive(true);
    audio.setMusicDucked(false);
  };

  const handleGameOver = (
    snap: SimSnapshot,
    result: "won" | "lost",
    reason: GameOverReason
  ): void => {
    const won = result === "won";
    if (won) {
      wonNightScores[currentNight] = snap.score;
    }
    input.setGameplayActive(false);
    input.exitPointerLock();
    hud.setVisible(false);
    audio.setMusicDucked(true);
    audio.playGameOver(won);

    const litLanternsCount = snap.lanterns.filter((l) => l.lit).length;
    const motePts = runStats.motesDeposited * TUNING.score.per_mote;
    const firstLightPts = runStats.firstLights * TUNING.score.per_lantern;
    const relightPts = runStats.relights * TUNING.score.per_relight;
    const pulsePts =
      runStats.shadesPulsedNormal * TUNING.score.per_stun +
      runStats.shadesPulsedDraining * TUNING.score.per_stun_draining;
    const flameBonus =
      won && reason === "dawn_survived"
        ? snap.player.flames * TUNING.score.per_flame_left
        : 0;
    // Exact dawn lantern bonus derived from sim.score so breakdown never drifts from sim
    const dawnLanternBonus =
      won && reason === "dawn_survived"
        ? Math.max(0, snap.score - (motePts + firstLightPts + relightPts + pulsePts + flameBonus))
        : 0;

    menu.showResult({
      night: currentNight,
      won,
      reason,
      nightScore: snap.score,
      totalCampaignScore: getTotalCampaignScore(),
      nightsWon: getNightsWonCount(),
      seed: currentSeed,
      motesDeposited: runStats.motesDeposited,
      firstLights: runStats.firstLights,
      relights: runStats.relights,
      shadesPulsedNormal: runStats.shadesPulsedNormal,
      shadesPulsedDraining: runStats.shadesPulsedDraining,
      dawnLanternBonus,
      litLanternsCount,
      totalLanterns: snap.lanterns.length,
      flamesLeft: snap.player.flames,
    });
  };

  /**
   * Unified sim step processor used by BOTH the 60Hz loop and pause-resume.
   * Ensures resume-tick events (including game_over, runStats, SFX) are never dropped.
   */
  const processSimStep = (stepInput: StepInput): SimSnapshot => {
    const snapBefore = sim.getState();
    const scoreBefore = snapBefore.score;

    drainingShadesBeforeStep.clear();
    for (let i = 0; i < snapBefore.shades.length; i++) {
      const sh = snapBefore.shades[i];
      if (sh.state === "drain") {
        drainingShadesBeforeStep.add(sh.id);
      }
    }

    sim.step(stepInput);
    const snapAfter = sim.getState();

    // Detect jump & jump-pad launch audio from grounded/velocity transition
    const padLaunched =
      (prevGrounded || prevVelY <= 0) &&
      !snapAfter.player.grounded &&
      snapAfter.player.vel[1] > 9.5;
    if (prevGrounded && !snapAfter.player.grounded && snapAfter.player.vel[1] > 4.5) {
      audio.playJump(snapAfter.player.vel[1] > 9.5);
    }
    prevGrounded = snapAfter.player.grounded;
    prevVelY = snapAfter.player.vel[1];
    scene.onSimStep(snapAfter, padLaunched);

    // Low-fuel warning blip + accessibility caption at most once per lantern per low period
    for (let i = 0; i < snapAfter.lanterns.length; i++) {
      const l = snapAfter.lanterns[i];
      if (l.lit && l.fuel < TUNING.low_fuel_threshold) {
        if (!lowFuelWarned.has(l.id)) {
          lowFuelWarned.add(l.id);
          audio.playLowFuelWarning();
          hud.notifyLowFuel(l.id);
        }
      } else {
        lowFuelWarned.delete(l.id);
      }
    }

    // Last-10-seconds countdown tick + accessibility caption (once per integer second)
    if (snapAfter.state === "playing" && snapAfter.time_left_s > 0 && snapAfter.time_left_s <= 10) {
      const secCeil = Math.ceil(snapAfter.time_left_s);
      if (secCeil !== lastCountdownSec) {
        lastCountdownSec = secCeil;
        audio.playCountdownTick(secCeil);
        hud.notifyLastTenSeconds(secCeil);
      }
    }

    // Night 3 wind warning audio + accessibility caption (2s before gust: sim_tick % 1800 === 1680)
    if (snapAfter.night === 3 && snapAfter.sim_tick >= 1680) {
      const cycle = Math.floor(snapAfter.sim_tick / 1800);
      const phase = snapAfter.sim_tick % 1800;
      if (phase >= 1680 && cycle !== lastWindWarnCycle) {
        lastWindWarnCycle = cycle;
        audio.playWindWarning();
        hud.notifyWindWarning();
      }
    }

    const events = sim.drainEvents();
    if (events.length > 0) {
      scene.handleEvents(events, snapAfter);
      hud.onEvents(events);

      // Compute exact non-pulse score delta for this tick to eliminate interact+pulse drain drift
      let tickKnownNonPulsePts = 0;
      let hasDawnWin = false;
      for (const ev of events) {
        if (ev.name === "deposit" || ev.name === "refuel") {
          tickKnownNonPulsePts += ev.data.amount * TUNING.score.per_mote;
        } else if (ev.name === "lantern_lit") {
          tickKnownNonPulsePts += ev.data.relight
            ? TUNING.score.per_relight
            : TUNING.score.per_lantern;
        } else if (
          ev.name === "game_over" &&
          ev.data.result === "won" &&
          ev.data.reason === "dawn_survived"
        ) {
          hasDawnWin = true;
        }
      }

      for (const ev of events) {
        switch (ev.name) {
          case "mote_picked":
            audio.playPickup(ev.data.carried);
            break;
          case "charm_picked":
            audio.playCharmPickup();
            break;
          case "deposit":
            runStats.motesDeposited += ev.data.amount;
            audio.playDeposit(ev.data.deposited);
            break;
          case "refuel":
            runStats.motesDeposited += ev.data.amount;
            audio.playRefuel();
            break;
          case "lantern_lit":
            if (ev.data.relight) {
              runStats.relights += 1;
            } else {
              runStats.firstLights += 1;
            }
            audio.playLanternLit();
            break;
          case "lantern_out":
            audio.playLanternOut();
            break;
          case "pulse": {
            const stunnedCount = ev.data.stunned_ids.length;
            if (stunnedCount > 0) {
              if (!hasDawnWin) {
                const stepDelta = snapAfter.score - scoreBefore;
                const pulseDelta = stepDelta - tickKnownNonPulsePts;
                const bonusPerDrain =
                  TUNING.score.per_stun_draining - TUNING.score.per_stun;
                const drainingCount = Math.max(
                  0,
                  Math.min(
                    stunnedCount,
                    Math.round((pulseDelta - stunnedCount * TUNING.score.per_stun) / bonusPerDrain)
                  )
                );
                runStats.shadesPulsedDraining += drainingCount;
                runStats.shadesPulsedNormal += stunnedCount - drainingCount;
              } else {
                for (const sid of ev.data.stunned_ids) {
                  if (drainingShadesBeforeStep.has(sid)) {
                    runStats.shadesPulsedDraining += 1;
                  } else {
                    runStats.shadesPulsedNormal += 1;
                  }
                }
              }
            }
            audio.playPulse(stunnedCount);
            break;
          }
          case "dash":
            audio.playDash();
            break;
          case "shade_spawned":
            recentSpawnedShadeId = ev.data.id;
            recentSpawnedShadeTimer = 3.5;
            audio.playShadeSpawn();
            break;
          case "drifter_steal":
            audio.playDrifterSteal();
            break;
          case "drifter_drop":
            audio.playDrifterDrop();
            break;
          case "player_hit":
            audio.playHit(ev.data.by);
            break;
          case "game_over":
            handleGameOver(snapAfter, ev.data.result, ev.data.reason);
            break;
          default:
            break;
        }
      }
    }

    return snapAfter;
  };

  const sendPauseToggleToSim = (): void => {
    const before = sim.getState();
    if (before.state === "playing") {
      // Prevent redundant step if pause was pressed on the exact tick we just resumed
      if (before.sim_tick === lastResumedSimTick) return;
      sim.step({ pause: true });
      const events = sim.drainEvents();
      const after = sim.getState();
      scene.handleEvents(events, after);
      hud.onEvents(events);
      if (after.state === "paused") {
        // Clear heldInput.pause to false while staying paused so resume triggers a clean rising edge
        sim.step({ pause: false });
        input.setGameplayActive(false);
        input.exitPointerLock();
        audio.setMusicDucked(true);
        menu.showPauseMenu(currentNight);
      }
    } else if (before.state === "paused") {
      // Resume runs a gameplay tick — route through the unified step handler so no events/game_over are dropped
      const after = processSimStep({ pause: true });
      lastResumedSimTick = after.sim_tick;
      if (after.state === "playing") {
        enterPlaying();
      }
    }
  };

  const input = new InputManager(canvasRoot, {
    onFirstInteraction: () => audio.unlock(),
    onPointerLockChange: (locked) => hud.setPointerLocked(locked),
    onPauseKey: () => {
      const screen = menu.getScreen();
      if (screen === "playing") {
        sendPauseToggleToSim();
      } else if (screen === "paused") {
        sendPauseToggleToSim();
      } else if (screen === "settings" && sim.getState().state === "paused") {
        menu.showPauseMenu(currentNight);
      } else if (screen === "leaderboard") {
        menu.showMainMenu();
      }
    },
    onRestartKey: () => {
      if (menu.getScreen() === "result") {
        initNightSim(currentNight);
        enterPlaying();
      }
    },
  });
  input.setSensitivity(settings.mouseSensitivity);
  input.setKeyBindings(settings.keyBindings);

  const menu = new MenuController(uiRoot, settings, {
    onUserGesture: () => audio.unlock(),
    onStartCampaign: () => {
      delete wonNightScores[1];
      delete wonNightScores[2];
      delete wonNightScores[3];
      initNightSim(1);
      hud.setVisible(false);
      input.setGameplayActive(false);
      menu.showNightIntro(1);
    },
    onSelectNight: (night) => {
      initNightSim(night);
      hud.setVisible(false);
      input.setGameplayActive(false);
      menu.showNightIntro(night);
    },
    onBeginNight: () => {
      initNightSim(currentNight);
      enterPlaying();
    },
    onResume: () => {
      if (sim.getState().state === "paused") {
        sendPauseToggleToSim();
      } else if (sim.getState().state === "playing") {
        enterPlaying();
      }
    },
    onRestartNight: () => {
      initNightSim(currentNight);
      enterPlaying();
    },
    onNextNight: () => {
      const next = Math.min(3, currentNight + 1) as NightNumber;
      initNightSim(next);
      hud.setVisible(false);
      input.setGameplayActive(false);
      menu.showNightIntro(next);
    },
    onRetryNight: () => {
      initNightSim(currentNight);
      enterPlaying();
    },
    onBackToMenu: () => {
      input.setGameplayActive(false);
      input.exitPointerLock();
      hud.setVisible(false);
      audio.setMusicDucked(true);
      menu.showMainMenu();
    },
    onSettingsChange: (next) => {
      audio.setVolume(next.volume);
      input.setSensitivity(next.mouseSensitivity);
      input.setKeyBindings(next.keyBindings);
      applyVisualSettings(next, scene, hud);
      saveSettings(next);
    },
    onRebindingChange: (active) => {
      input.setRebindingActive(active);
    },
  });

  // Initial background scene preview (Night 1) while on Main Menu
  initNightSim(1);
  hud.setVisible(false);
  input.setGameplayActive(false);

  const arrowProj: OffscreenArrowProjection = {
    visible: false,
    screenX: 0.5,
    screenY: 0.5,
    angleRad: 0,
    distanceM: 0,
  };
  const shadeArrowProj: OffscreenArrowProjection = {
    visible: false,
    screenX: 0.5,
    screenY: 0.5,
    angleRad: 0,
    distanceM: 0,
  };

  let lastTimeMs = performance.now();

  const frame = (nowMs: number): void => {
    const frameDt = Math.min(MAX_FRAME_DT, Math.max(0, (nowMs - lastTimeMs) / 1000));
    lastTimeMs = nowMs;

    const screen = menu.getScreen();
    const isPlaying = screen === "playing" && sim.getState().state === "playing";

    if (isPlaying) {
      input.updateCamera(frameDt);
      accumulator += frameDt;

      if (recentSpawnedShadeTimer > 0) {
        recentSpawnedShadeTimer = Math.max(0, recentSpawnedShadeTimer - frameDt);
        if (recentSpawnedShadeTimer === 0) {
          recentSpawnedShadeId = null;
        }
      }

      while (accumulator >= FIXED_DT) {
        if (sim.getState().state === "playing") {
          const stepInput = input.consumeStepInput();
          processSimStep(stepInput);
        }
        accumulator -= FIXED_DT;
      }
    } else {
      accumulator = 0;
    }

    const snapshot = sim.getState();
    const isFrozen = screen !== "playing" || snapshot.state === "paused";
    const alpha = isFrozen ? 1 : Math.max(0, Math.min(1, accumulator / FIXED_DT));
    scene.render(
      snapshot,
      input.getCamYawDeg(),
      frameDt,
      input.getCamPitchDeg(),
      isFrozen,
      alpha
    );
    if (screen === "playing") {
      scene.projectNearestUnlitLantern(snapshot, arrowProj);

      shadeArrowProj.visible = false;
      if (recentSpawnedShadeId && recentSpawnedShadeTimer > 0) {
        const sh = snapshot.shades.find((s) => s.id === recentSpawnedShadeId);
        if (sh) {
          const dist = Math.hypot(
            sh.pos[0] - snapshot.player.pos[0],
            sh.pos[2] - snapshot.player.pos[2]
          );
          scene.projectWorldPointToEdge(sh.pos, dist, shadeArrowProj, true);
        }
      }

      hud.update(snapshot, frameDt, arrowProj, shadeArrowProj);
    }

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

bootstrap();
