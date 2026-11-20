import { nightConfig, type SimEvent, type SimSnapshot } from "../sim";
import type { OffscreenArrowProjection } from "../renderer/sceneManager";
import "./hud.css";

const MAX_FLAMES = 3;
const CARRY_CAPACITY = 10;
const INTERACT_RADIUS = 2.0;

const FLAME_SVG = `<svg class="hud-flame-icon active" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C9.5 6.2 6 9.3 6 14a6 6 0 0 0 12 0c0-3.2-1.8-5.7-3.4-7.7-.2 1.8-1.1 2.9-2.2 3.4C13.1 7.1 13 4.3 12 2z"/></svg>`;
const ARROW_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l15-7-3.5 7L19 19z"/></svg>`;

export class HudController {
  private readonly root: HTMLElement;
  private readonly layerEl: HTMLElement;
  private readonly flameIcons: SVGElement[] = [];
  private readonly charmBadgeEl: HTMLElement;
  private readonly nightLabelEl: HTMLElement;
  private readonly timerEl: HTMLElement;
  private readonly windBannerEl: HTMLElement;
  private readonly lanternCountEl: HTMLElement;
  private readonly lanternPipsEl: HTMLElement;
  private lanternPips: HTMLElement[] = [];
  private readonly scoreEl: HTMLElement;
  private readonly moteSlots: HTMLElement[] = [];
  private readonly moteBarLabelEl: HTMLElement;
  private readonly dashBoxEl: HTMLElement;
  private readonly dashStatusEl: HTMLElement;
  private readonly pulseBoxEl: HTMLElement;
  private readonly pulseStatusEl: HTMLElement;
  private readonly contextPromptEl: HTMLElement;
  private readonly pointerLockHintEl: HTMLElement;
  private readonly offscreenArrowEl: HTMLElement;
  private readonly hitFlashEl: HTMLElement;
  private readonly liveRegionEl: HTMLElement;

  private hitFlashTimer = 0;
  private pointerLocked = false;
  private visible = false;

  constructor(container: HTMLElement) {
    this.root = container;

    const moteSlotHtml = Array.from({ length: CARRY_CAPACITY }, () => `<span class="hud-mote-slot"></span>`).join("");

    this.root.innerHTML = `
      <div class="hud-layer hidden">
        <div class="hud-top">
          <div class="hud-panel hud-top-left">
            <div class="hud-flames" aria-label="Flames remaining">
              ${FLAME_SVG}${FLAME_SVG}${FLAME_SVG}
            </div>
            <div class="hud-charm-badge">Bùa Gió 10.0s</div>
          </div>

          <div class="hud-panel hud-top-center">
            <div class="hud-night-label">Đêm 1 · Đảo Bến</div>
            <div class="hud-timer">05:00</div>
            <div class="hud-wind-banner"></div>
          </div>

          <div class="hud-panel hud-top-right">
            <div class="hud-lantern-row">
              <span class="hud-lantern-label">0 / 5</span>
              <div class="hud-lantern-pips"></div>
            </div>
            <div class="hud-score-row">
              <span class="hud-score-label">Score</span>
              <span class="hud-score-value">0</span>
            </div>
          </div>
        </div>

        <div class="hud-bottom-grid">
          <div class="hud-bottom-center">
            <div class="hud-pointer-hint">Click to lock mouse · Esc/P Pause</div>
            <div class="hud-context-prompt">E — Nap anh sang (0/10)</div>
            <div class="hud-panel hud-mote-bar-panel">
              <div class="hud-mote-slots" aria-label="Carried motes">${moteSlotHtml}</div>
              <div class="hud-mote-bar-label">0 / 10</div>
            </div>
            <div class="hud-controls">
              WASD Move · Space Jump · Shift Dash · E Deposit · Q / RMB Pulse · J/K or Mouse Camera · Esc/P Pause
            </div>
          </div>

          <div class="hud-bottom-right">
            <div class="hud-ability hud-ability-dash ready">
              <span class="hud-ability-key">Shift</span>
              <span class="hud-ability-name">Dash</span>
              <span class="hud-ability-status">Ready</span>
            </div>
            <div class="hud-ability hud-ability-pulse locked">
              <span class="hud-ability-key">Q/RMB</span>
              <span class="hud-ability-name">Pulse</span>
              <span class="hud-ability-status">Need 3</span>
            </div>
          </div>
        </div>
      </div>

      <div class="hud-offscreen-arrow" aria-hidden="true">${ARROW_SVG}</div>
      <div class="hud-hit-flash" aria-hidden="true"></div>
      <div class="sr-only" role="status" aria-live="polite"></div>
    `;

    this.layerEl = this.root.querySelector(".hud-layer")!;
    this.flameIcons = Array.from(this.root.querySelectorAll<SVGElement>(".hud-flame-icon"));
    this.charmBadgeEl = this.root.querySelector(".hud-charm-badge")!;
    this.nightLabelEl = this.root.querySelector(".hud-night-label")!;
    this.timerEl = this.root.querySelector(".hud-timer")!;
    this.windBannerEl = this.root.querySelector(".hud-wind-banner")!;
    this.lanternCountEl = this.root.querySelector(".hud-lantern-label")!;
    this.lanternPipsEl = this.root.querySelector(".hud-lantern-pips")!;
    this.scoreEl = this.root.querySelector(".hud-score-value")!;
    this.moteSlots = Array.from(this.root.querySelectorAll<HTMLElement>(".hud-mote-slot"));
    this.moteBarLabelEl = this.root.querySelector(".hud-mote-bar-label")!;
    this.dashBoxEl = this.root.querySelector(".hud-ability-dash")!;
    this.dashStatusEl = this.dashBoxEl.querySelector(".hud-ability-status")!;
    this.pulseBoxEl = this.root.querySelector(".hud-ability-pulse")!;
    this.pulseStatusEl = this.pulseBoxEl.querySelector(".hud-ability-status")!;
    this.contextPromptEl = this.root.querySelector(".hud-context-prompt")!;
    this.pointerLockHintEl = this.root.querySelector(".hud-pointer-hint")!;
    this.offscreenArrowEl = this.root.querySelector(".hud-offscreen-arrow")!;
    this.hitFlashEl = this.root.querySelector(".hud-hit-flash")!;
    this.liveRegionEl = this.root.querySelector('[aria-live="polite"]')!;
  }

  public setVisible(visible: boolean): void {
    this.visible = visible;
    this.layerEl.classList.toggle("hidden", !visible);
    if (!visible) {
      this.offscreenArrowEl.classList.remove("visible");
    }
  }

  public setPointerLocked(locked: boolean): void {
    this.pointerLocked = locked;
  }

  public reset(snapshot: SimSnapshot): void {
    this.hitFlashTimer = 0;
    this.hitFlashEl.classList.remove("active");
    this.rebuildLanternPips(snapshot.lanterns.length);
    const cfg = nightConfig(snapshot.night);
    this.nightLabelEl.textContent = `Đêm ${snapshot.night} · ${cfg.name}`;
    this.announce(`Đêm ${snapshot.night} (${cfg.name}) bắt đầu.`);
  }

  public onEvents(events: readonly SimEvent[]): void {
    for (const ev of events) {
      switch (ev.name) {
        case "lantern_lit":
          this.announce(`Đã thắp sáng đèn ${ev.data.lantern_id}!`);
          break;
        case "charm_picked":
          this.announce("Đã nhận Bùa Gió! Tốc độ tăng và Lướt không hồi chiêu.");
          break;
        case "drifter_steal":
          this.announce(`Gió Lạc đã cướp ${ev.data.amount} đốm sáng!`);
          break;
        case "player_hit":
          this.hitFlashTimer = 0.28;
          this.hitFlashEl.classList.add("active");
          this.announce(`Mất 1 ngọn lửa! Còn ${ev.data.flames} lửa.`);
          break;
        default:
          break;
      }
    }
  }

  public update(
    snapshot: SimSnapshot,
    dtSec: number,
    arrowProj?: OffscreenArrowProjection
  ): void {
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dtSec);
      if (this.hitFlashTimer === 0) {
        this.hitFlashEl.classList.remove("active");
      }
    }

    // Flames (top-left)
    for (let i = 0; i < MAX_FLAMES; i++) {
      const active = i < snapshot.player.flames;
      this.flameIcons[i].classList.toggle("active", active);
      this.flameIcons[i].classList.toggle("lost", !active);
    }

    // Wind Charm badge
    const charmActive = snapshot.player.charm_s > 0;
    this.charmBadgeEl.classList.toggle("visible", charmActive);
    if (charmActive) {
      this.charmBadgeEl.textContent = `Bùa Gió ${snapshot.player.charm_s.toFixed(1)}s`;
    }

    // Clock MM:SS (top-center, red + blinking at <= 30s)
    const totalSec = Math.max(0, Math.ceil(snapshot.time_left_s));
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    this.timerEl.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    this.timerEl.classList.toggle("urgent", snapshot.time_left_s <= 30 && snapshot.state === "playing");

    // Wind warning / gust indicator (Night 3)
    const phase = snapshot.sim_tick % 1800;
    const windWarn = snapshot.night === 3 && snapshot.sim_tick >= 1680 && phase >= 1680;
    if (snapshot.wind.active) {
      this.windBannerEl.textContent = "Gió mạnh đang thổi!";
      this.windBannerEl.classList.add("visible");
    } else if (windWarn) {
      this.windBannerEl.textContent = "Cảnh báo: Gió lớn sắp đến...";
      this.windBannerEl.classList.add("visible");
    } else {
      this.windBannerEl.classList.remove("visible");
    }

    // Lanterns k/n & Score (top-right)
    if (this.lanternPips.length !== snapshot.lanterns.length) {
      this.rebuildLanternPips(snapshot.lanterns.length);
    }
    let litCount = 0;
    for (let i = 0; i < snapshot.lanterns.length; i++) {
      if (snapshot.lanterns[i].lit) litCount++;
    }
    this.lanternCountEl.textContent = `${litCount} / ${snapshot.lanterns.length}`;
    for (let i = 0; i < this.lanternPips.length; i++) {
      this.lanternPips[i].classList.toggle("lit", i < litCount);
    }
    this.scoreEl.textContent = String(snapshot.score);

    // 10-slot Mote bar (bottom-center)
    const carried = snapshot.player.carried;
    for (let i = 0; i < CARRY_CAPACITY; i++) {
      this.moteSlots[i].classList.toggle("filled", i < carried);
    }
    this.moteBarLabelEl.textContent = `${carried} / ${CARRY_CAPACITY}`;

    // Dash cooldown icon (bottom-right)
    const dashCd = snapshot.player.dash_cd_s;
    if (charmActive) {
      this.dashBoxEl.className = "hud-ability hud-ability-dash ready charm-active";
      this.dashStatusEl.textContent = "∞";
    } else if (dashCd > 0.01) {
      this.dashBoxEl.className = "hud-ability hud-ability-dash cooldown";
      this.dashStatusEl.textContent = `${dashCd.toFixed(1)}s`;
    } else {
      this.dashBoxEl.className = "hud-ability hud-ability-dash ready";
      this.dashStatusEl.textContent = "Ready";
    }

    // Pulse cooldown icon (bottom-right)
    const pulseCd = snapshot.player.pulse_cd_s;
    if (pulseCd > 0.01) {
      this.pulseBoxEl.className = "hud-ability hud-ability-pulse cooldown";
      this.pulseStatusEl.textContent = `${pulseCd.toFixed(1)}s`;
    } else if (carried >= 3) {
      this.pulseBoxEl.className = "hud-ability hud-ability-pulse ready";
      this.pulseStatusEl.textContent = "Ready";
    } else {
      this.pulseBoxEl.className = "hud-ability hud-ability-pulse locked";
      this.pulseStatusEl.textContent = `${carried}/3`;
    }

    // Context prompt near an unlit lantern: "E — Nap anh sang (x/10)"
    let nearestInRange: { deposited: number; dist: number } | null = null;
    if (snapshot.state === "playing") {
      const [px, , pz] = snapshot.player.pos;
      for (let i = 0; i < snapshot.lanterns.length; i++) {
        const l = snapshot.lanterns[i];
        if (l.lit) continue;
        const d = Math.hypot(l.pos[0] - px, l.pos[2] - pz);
        if (d <= INTERACT_RADIUS && (!nearestInRange || d < nearestInRange.dist)) {
          nearestInRange = { deposited: l.deposited, dist: d };
        }
      }
    }
    if (nearestInRange) {
      this.contextPromptEl.textContent = `E — Nap anh sang (${nearestInRange.deposited}/10)`;
      this.contextPromptEl.classList.add("visible");
    } else {
      this.contextPromptEl.classList.remove("visible");
    }

    this.pointerLockHintEl.classList.toggle(
      "visible",
      this.visible && !this.pointerLocked && snapshot.state === "playing"
    );

    // Off-screen lantern directional arrow
    if (this.visible && snapshot.state === "playing" && arrowProj && arrowProj.visible) {
      this.offscreenArrowEl.classList.add("visible");
      this.offscreenArrowEl.style.left = `${(arrowProj.screenX * 100).toFixed(2)}%`;
      this.offscreenArrowEl.style.top = `${(arrowProj.screenY * 100).toFixed(2)}%`;
      this.offscreenArrowEl.style.transform = `rotate(${arrowProj.angleRad.toFixed(3)}rad)`;
    } else {
      this.offscreenArrowEl.classList.remove("visible");
    }
  }

  private rebuildLanternPips(count: number): void {
    this.lanternPipsEl.innerHTML = Array.from(
      { length: count },
      () => `<span class="hud-lantern-pip"></span>`
    ).join("");
    this.lanternPips = Array.from(this.lanternPipsEl.querySelectorAll<HTMLElement>(".hud-lantern-pip"));
  }

  private announce(message: string): void {
    this.liveRegionEl.textContent = "";
    requestAnimationFrame(() => {
      this.liveRegionEl.textContent = message;
    });
  }
}
