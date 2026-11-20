import { Sim, type NightNumber, type SimSnapshot } from "./sim";
import { SoundEffects } from "./audio/soundEffects";
import { HudController } from "./hud/hud";
import { InputManager } from "./input/inputManager";
import { SceneManager, type OffscreenArrowProjection } from "./renderer/sceneManager";
import { MenuController } from "./ui/menuController";
import { loadSettings, saveSettings } from "./ui/settings";

const FIXED_DT = 1 / 60;
const MAX_FRAME_DT = 0.1;

function createBrowserSeed(): number {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return (buf[0] & 0x7fffffff) || 1;
  }
  return (Date.now() & 0x7fffffff) || 1;
}

interface NightRunStats {
  motesDeposited: number;
  lanternsLit: number;
  shadesPulsed: number;
}

function bootstrap(): void {
  const canvasRoot = document.getElementById("canvas-root");
  const hudRoot = document.getElementById("hud-root");
  const uiRoot = document.getElementById("ui-root");
  if (!canvasRoot || !hudRoot || !uiRoot) {
    throw new Error("Missing #canvas-root, #hud-root, or #ui-root in index.html");
  }

  const settings = loadSettings();
  const audio = new SoundEffects();
  audio.setVolume(settings.volume);
  audio.setMusicDucked(true);

  const scene = new SceneManager(canvasRoot);
  const hud = new HudController(hudRoot);

  let currentNight: NightNumber = 1;
  const wonNightScores: Partial<Record<NightNumber, number>> = {};
  let sim = new Sim({ seed: createBrowserSeed(), night: 1 });
  let runStats: NightRunStats = { motesDeposited: 0, lanternsLit: 0, shadesPulsed: 0 };
  let lastCountdownSec = -1;
  let lastWindWarnCycle = -1;
  let prevGrounded = true;
  let prevVelY = 0;
  let accumulator = 0;

  const getTotalCampaignScore = (): number =>
    (wonNightScores[1] ?? 0) + (wonNightScores[2] ?? 0) + (wonNightScores[3] ?? 0);

  const initNightSim = (night: NightNumber): void => {
    currentNight = night;
    sim = new Sim({ seed: createBrowserSeed(), night });
    runStats = { motesDeposited: 0, lanternsLit: 0, shadesPulsed: 0 };
    lastCountdownSec = -1;
    lastWindWarnCycle = -1;
    accumulator = 0;
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

  const sendPauseToggleToSim = (): void => {
    const state = sim.getState().state;
    if (state !== "playing" && state !== "paused") return;
    // Step sim with a single rising-edge pause pulse so paused/resumed events stay consistent
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
    } else if (after.state === "playing") {
      enterPlaying();
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
      } else {
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
      saveSettings(next);
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

  let lastTimeMs = performance.now();

  const handleGameOver = (
    snap: SimSnapshot,
    result: "won" | "lost",
    reason: "all_lit" | "dawn" | "no_flames"
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

    menu.showResult({
      night: currentNight,
      won,
      reason,
      nightScore: snap.score,
      totalCampaignScore: getTotalCampaignScore(),
      motesDeposited: runStats.motesDeposited,
      lanternsLit: runStats.lanternsLit,
      shadesPulsed: runStats.shadesPulsed,
      timeLeftSec: snap.time_left_s,
      flamesLeft: snap.player.flames,
    });
  };

  const frame = (nowMs: number): void => {
    const frameDt = Math.min(MAX_FRAME_DT, Math.max(0, (nowMs - lastTimeMs) / 1000));
    lastTimeMs = nowMs;

    const screen = menu.getScreen();
    const isPlaying = screen === "playing" && sim.getState().state === "playing";

    if (isPlaying) {
      input.updateCamera(frameDt);
      accumulator += frameDt;

      while (accumulator >= FIXED_DT) {
        if (sim.getState().state === "playing") {
          const stepInput = input.consumeStepInput();
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

          // Last-10-seconds countdown tick (once per integer second)
          if (snapAfter.state === "playing" && snapAfter.time_left_s > 0 && snapAfter.time_left_s <= 10) {
            const secCeil = Math.ceil(snapAfter.time_left_s);
            if (secCeil !== lastCountdownSec) {
              lastCountdownSec = secCeil;
              audio.playCountdownTick(secCeil);
            }
          }

          // Night 3 wind warning audio (2s before gust: sim_tick % 1800 === 1680)
          if (snapAfter.night === 3 && snapAfter.sim_tick >= 1680) {
            const cycle = Math.floor(snapAfter.sim_tick / 1800);
            const phase = snapAfter.sim_tick % 1800;
            if (phase >= 1680 && cycle !== lastWindWarnCycle) {
              lastWindWarnCycle = cycle;
              audio.playWindWarning();
            }
          }

          const events = sim.drainEvents();
          if (events.length > 0) {
            scene.handleEvents(events, snapAfter);
            hud.onEvents(events);
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
                case "lantern_lit":
                  runStats.lanternsLit += 1;
                  audio.playLanternLit();
                  break;
                case "pulse":
                  runStats.shadesPulsed += ev.data.stunned_ids.length;
                  audio.playPulse(ev.data.stunned_ids.length);
                  break;
                case "dash":
                  audio.playDash();
                  break;
                case "shade_spawned":
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
      hud.update(snapshot, frameDt, arrowProj);
    }

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

bootstrap();
