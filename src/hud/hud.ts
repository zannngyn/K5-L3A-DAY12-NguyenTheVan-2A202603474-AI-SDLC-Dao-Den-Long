import { TUNING, nightConfig, type LanternState, type SimEvent, type SimSnapshot } from "../sim";
import type { OffscreenArrowProjection } from "../renderer/sceneManager";
import { DEFAULT_KEY_BINDINGS, formatKeyCode, type KeyBindings } from "../ui/settings";
import "./hud.css";

const MAX_FLAMES = TUNING.flames;
const MAX_CAPACITY = TUNING.capacity_max;
const INTERACT_RADIUS = TUNING.interact_radius;

const FLAME_SVG = `<svg class="hud-flame-icon active" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C9.5 6.2 6 9.3 6 14a6 6 0 0 0 12 0c0-3.2-1.8-5.7-3.4-7.7-.2 1.8-1.1 2.9-2.2 3.4C13.1 7.1 13 4.3 12 2z"/></svg>`;
const ARROW_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l15-7-3.5 7L19 19z"/></svg>`;
const WARNING_SVG = `<svg class="hud-warning-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2L1 21h22L12 2zm0 5.5l1.1 7h-2.2l1.1-7zm0 10.5a1.35 1.35 0 1 1 0-2.7 1.35 1.35 0 0 1 0 2.7z"/></svg>`;

export class HudController {
  private readonly root: HTMLElement;
  private readonly layerEl: HTMLElement;
  private readonly flameIcons: SVGElement[] = [];
  private readonly charmBadgeEl: HTMLElement;
  private readonly nightLabelEl: HTMLElement;
  private readonly timerWrapEl: HTMLElement;
  private readonly timerEl: HTMLElement;
  private readonly windBannerEl: HTMLElement;
  private readonly alertBannerEl: HTMLElement;
  private readonly alertTextEl: HTMLElement;
  private readonly lanternCountEl: HTMLElement;
  private readonly lanternReqEl: HTMLElement;
  private readonly lanternPipsEl: HTMLElement;
  private lanternPips: HTMLElement[] = [];
  private readonly scoreEl: HTMLElement;
  private readonly moteSlotsWrapEl: HTMLElement;
  private readonly moteSlots: HTMLElement[] = [];
  private readonly moteBarLabelEl: HTMLElement;
  private readonly dashBoxEl: HTMLElement;
  private readonly dashKeyEl: HTMLElement;
  private readonly dashStatusEl: HTMLElement;
  private readonly pulseBoxEl: HTMLElement;
  private readonly pulseKeyEl: HTMLElement;
  private readonly pulseStatusEl: HTMLElement;
  private readonly contextPromptEl: HTMLElement;
  private readonly pointerLockHintEl: HTMLElement;
  private readonly controlsHintEl: HTMLElement;
  private readonly offscreenArrowEl: HTMLElement;
  private readonly shadeArrowEl: HTMLElement;
  private readonly hitFlashEl: HTMLElement;
  private readonly liveRegionEl: HTMLElement;

  private bindings: KeyBindings = { ...DEFAULT_KEY_BINDINGS };
  private reducedMotion = false;
  private hitFlashTimer = 0;
  private alertTimer = 0;
  private pointerLocked = false;
  private visible = false;

  constructor(container: HTMLElement) {
    this.root = container;

    const moteSlotHtml = Array.from(
      { length: MAX_CAPACITY },
      () => `<span class="hud-mote-slot"></span>`
    ).join("");

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
            <div class="hud-timer-wrap">
              ${WARNING_SVG}
              <div class="hud-timer">04:00</div>
            </div>
            <div class="hud-wind-banner"></div>
            <div class="hud-alert-banner">${WARNING_SVG}<span class="hud-alert-text"></span></div>
          </div>

          <div class="hud-panel hud-top-right">
            <div class="hud-lantern-row">
              <span class="hud-lantern-label">0 / 5</span>
              <div class="hud-lantern-pips"></div>
            </div>
            <div class="hud-lantern-req">Cần 3 / 5 đến bình minh</div>
            <div class="hud-score-row">
              <span class="hud-score-label">Score</span>
              <span class="hud-score-value">0</span>
            </div>
          </div>
        </div>

        <div class="hud-bottom-grid">
          <div class="hud-bottom-center">
            <div class="hud-pointer-hint">Click khóa chuột · Esc Tạm dừng</div>
            <div class="hud-context-prompt">E - Nap anh sang (0/10)</div>
            <div class="hud-panel hud-mote-bar-panel">
              <div class="hud-mote-slots" aria-label="Carried motes">${moteSlotHtml}</div>
              <div class="hud-mote-bar-label">0 / 10</div>
            </div>
            <div class="hud-controls"></div>
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
      <div class="hud-shade-arrow" aria-hidden="true">${ARROW_SVG}</div>
      <div class="hud-hit-flash" aria-hidden="true"></div>
      <div class="sr-only" role="status" aria-live="polite"></div>
    `;

    this.layerEl = this.root.querySelector(".hud-layer")!;
    this.flameIcons = Array.from(this.root.querySelectorAll<SVGElement>(".hud-flame-icon"));
    this.charmBadgeEl = this.root.querySelector(".hud-charm-badge")!;
    this.nightLabelEl = this.root.querySelector(".hud-night-label")!;
    this.timerWrapEl = this.root.querySelector(".hud-timer-wrap")!;
    this.timerEl = this.root.querySelector(".hud-timer")!;
    this.windBannerEl = this.root.querySelector(".hud-wind-banner")!;
    this.alertBannerEl = this.root.querySelector(".hud-alert-banner")!;
    this.alertTextEl = this.root.querySelector(".hud-alert-text")!;
    this.lanternCountEl = this.root.querySelector(".hud-lantern-label")!;
    this.lanternReqEl = this.root.querySelector(".hud-lantern-req")!;
    this.lanternPipsEl = this.root.querySelector(".hud-lantern-pips")!;
    this.scoreEl = this.root.querySelector(".hud-score-value")!;
    this.moteSlotsWrapEl = this.root.querySelector(".hud-mote-slots")!;
    this.moteSlots = Array.from(this.root.querySelectorAll<HTMLElement>(".hud-mote-slot"));
    this.moteBarLabelEl = this.root.querySelector(".hud-mote-bar-label")!;
    this.dashBoxEl = this.root.querySelector(".hud-ability-dash")!;
    this.dashKeyEl = this.dashBoxEl.querySelector(".hud-ability-key")!;
    this.dashStatusEl = this.dashBoxEl.querySelector(".hud-ability-status")!;
    this.pulseBoxEl = this.root.querySelector(".hud-ability-pulse")!;
    this.pulseKeyEl = this.pulseBoxEl.querySelector(".hud-ability-key")!;
    this.pulseStatusEl = this.pulseBoxEl.querySelector(".hud-ability-status")!;
    this.contextPromptEl = this.root.querySelector(".hud-context-prompt")!;
    this.pointerLockHintEl = this.root.querySelector(".hud-pointer-hint")!;
    this.controlsHintEl = this.root.querySelector(".hud-controls")!;
    this.offscreenArrowEl = this.root.querySelector(".hud-offscreen-arrow")!;
    this.shadeArrowEl = this.root.querySelector(".hud-shade-arrow")!;
    this.hitFlashEl = this.root.querySelector(".hud-hit-flash")!;
    this.liveRegionEl = this.root.querySelector('[aria-live="polite"]')!;

    this.refreshKeyLabels();
  }

  public setKeyBindings(bindings: KeyBindings): void {
    this.bindings = { ...bindings };
    this.refreshKeyLabels();
  }

  public setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
    if (enabled) {
      this.hitFlashTimer = 0;
      this.hitFlashEl.classList.remove("active");
    }
  }

  public setVisible(visible: boolean): void {
    this.visible = visible;
    this.layerEl.classList.toggle("hidden", !visible);
    if (!visible) {
      this.offscreenArrowEl.classList.remove("visible");
      this.shadeArrowEl.classList.remove("visible");
    }
  }

  public setPointerLocked(locked: boolean): void {
    this.pointerLocked = locked;
  }

  public reset(snapshot: SimSnapshot): void {
    this.hitFlashTimer = 0;
    this.alertTimer = 0;
    this.hitFlashEl.classList.remove("active");
    this.alertBannerEl.classList.remove("visible");
    this.shadeArrowEl.classList.remove("visible");
    this.rebuildLanternPips(snapshot.lanterns.length);
    const cfg = nightConfig(snapshot.night);
    this.nightLabelEl.textContent = `Đêm ${snapshot.night} · ${cfg.name}`;
    const needed = Math.ceil(TUNING.win_ratio * snapshot.lanterns.length);
    this.announce(
      `Đêm ${snapshot.night} (${cfg.name}) bắt đầu. Giữ ít nhất ${needed}/${snapshot.lanterns.length} đèn sáng đến bình minh.`
    );
  }

  public notifyLowFuel(lanternId: string): void {
    const msg = `Đèn ${lanternId} sắp cạn dầu (<30%)!`;
    this.showAlert(msg, 3.5);
    this.announce(`Cảnh báo: ${msg}`);
  }

  public notifyWindWarning(): void {
    const msg = "Gió lớn sắp thổi sau 2 giây!";
    this.showAlert(msg, 2.5);
    this.announce(`Cảnh báo: ${msg}`);
  }

  public notifyLastTenSeconds(secLeft: number): void {
    const msg = `Còn ${secLeft} giây đến bình minh!`;
    this.showAlert(msg, 1.5);
    if (secLeft === 10 || secLeft === 5 || secLeft <= 3) {
      this.announce(msg);
    }
  }

  public onEvents(events: readonly SimEvent[]): void {
    for (const ev of events) {
      switch (ev.name) {
        case "lantern_lit":
          this.announce(
            ev.data.relight
              ? `Đã thắp lại đèn ${ev.data.lantern_id}!`
              : `Đã thắp sáng đèn ${ev.data.lantern_id}!`
          );
          break;
        case "refuel":
          this.announce(
            `Đã châm dầu đèn ${ev.data.lantern_id} (${Math.round(ev.data.fuel)}%).`
          );
          break;
        case "lantern_out":
          this.showAlert(`Đèn ${ev.data.lantern_id} đã tắt!`, 4.0);
          this.announce(`Đèn ${ev.data.lantern_id} đã tắt`);
          break;
        case "fuel_drain":
          this.showAlert(
            `Bóng Mực đang hút dầu đèn ${ev.data.lantern_id} (${Math.round(ev.data.fuel)}%)!`,
            3.0
          );
          this.announce(
            `Cảnh báo: Bóng Mực đang hút dầu đèn ${ev.data.lantern_id}, còn ${Math.round(ev.data.fuel)} phần trăm dầu.`
          );
          break;
        case "shade_spawned":
          this.showAlert("Bóng Mực xuất hiện!", 3.2);
          this.announce("Cảnh báo: Bóng Mực mới xuất hiện!");
          break;
        case "charm_picked":
          this.announce("Đã nhận Bùa Gió! Tốc độ tăng và Lướt không hồi chiêu.");
          break;
        case "drifter_steal":
          this.announce(`Gió Lạc đã cướp ${ev.data.amount} đốm sáng!`);
          break;
        case "player_hit":
          if (!this.reducedMotion) {
            this.hitFlashTimer = 0.28;
            this.hitFlashEl.classList.add("active");
          }
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
    arrowProj?: OffscreenArrowProjection,
    shadeArrowProj?: OffscreenArrowProjection
  ): void {
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dtSec);
      if (this.hitFlashTimer === 0) {
        this.hitFlashEl.classList.remove("active");
      }
    }

    if (this.alertTimer > 0) {
      this.alertTimer = Math.max(0, this.alertTimer - dtSec);
      if (this.alertTimer === 0) {
        this.alertBannerEl.classList.remove("visible");
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

    // Clock MM:SS counting down to dawn (warning color + icon at <= 30s)
    const totalSec = Math.max(0, Math.ceil(snapshot.time_left_s));
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    this.timerEl.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    const isUrgent = snapshot.time_left_s <= 30 && snapshot.state === "playing";
    this.timerEl.classList.toggle("urgent", isUrgent);
    this.timerWrapEl.classList.toggle("urgent", isUrgent);

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

    // Lanterns k/n + dawn requirement + Score (top-right)
    const totalLanterns = snapshot.lanterns.length;
    if (this.lanternPips.length !== totalLanterns) {
      this.rebuildLanternPips(totalLanterns);
    }
    let litCount = 0;
    for (let i = 0; i < totalLanterns; i++) {
      const l = snapshot.lanterns[i];
      if (l.lit) litCount++;
      const lowFuel = l.lit && l.fuel < TUNING.low_fuel_threshold;
      this.lanternPips[i].classList.toggle("lit", l.lit && !lowFuel);
      this.lanternPips[i].classList.toggle("low-fuel", lowFuel);
    }
    const needed = Math.ceil(TUNING.win_ratio * totalLanterns);
    this.lanternCountEl.textContent = `${litCount} / ${totalLanterns}`;
    this.lanternReqEl.textContent = `Cần ${needed}/${totalLanterns} đến bình minh`;
    this.lanternReqEl.classList.toggle("below", litCount < needed && isUrgent);
    this.scoreEl.textContent = String(snapshot.score);

    // Growing capacity Mote bar (bottom-center, up to capacity_max = 20)
    const carried = snapshot.player.carried;
    const capacity = Math.min(MAX_CAPACITY, Math.max(1, snapshot.player.capacity));
    this.moteSlotsWrapEl.classList.toggle("compact", capacity > 10);
    for (let i = 0; i < MAX_CAPACITY; i++) {
      const slot = this.moteSlots[i];
      const activeSlot = i < capacity;
      slot.classList.toggle("inactive", !activeSlot);
      slot.classList.toggle("filled", activeSlot && i < carried);
    }
    this.moteBarLabelEl.textContent = `${carried} / ${capacity}`;

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
    } else if (carried >= TUNING.pulse_cost) {
      this.pulseBoxEl.className = "hud-ability hud-ability-pulse ready";
      this.pulseStatusEl.textContent = "Ready";
    } else {
      this.pulseBoxEl.className = "hud-ability hud-ability-pulse locked";
      this.pulseStatusEl.textContent = `${carried}/${TUNING.pulse_cost}`;
    }

    // Context prompt near a lantern that can receive (unlit, or lit not full)
    let nearestLantern: LanternState | null = null;
    let bestDist = Infinity;
    if (snapshot.state === "playing") {
      const [px, , pz] = snapshot.player.pos;
      for (let i = 0; i < snapshot.lanterns.length; i++) {
        const l = snapshot.lanterns[i];
        // Full lit lantern is not selectable -> no prompt
        if (l.lit && l.fuel >= TUNING.fuel_max) continue;
        const d = Math.hypot(l.pos[0] - px, l.pos[2] - pz);
        if (
          d <= INTERACT_RADIUS &&
          (d < bestDist - 1e-6 || (Math.abs(d - bestDist) <= 1e-6 && nearestLantern && l.id < nearestLantern.id))
        ) {
          bestDist = d;
          nearestLantern = l;
        }
      }
    }

    const interactKey = formatKeyCode(this.bindings.interact);
    if (nearestLantern) {
      if (!nearestLantern.lit) {
        const cost = nearestLantern.ever_lit ? TUNING.relight_cost : TUNING.lantern_cost;
        this.contextPromptEl.textContent = `${interactKey} - Nap anh sang (${nearestLantern.deposited}/${cost})`;
      } else {
        const missingFuel = Math.max(0, TUNING.fuel_max - nearestLantern.fuel);
        const maxMotesNeeded = Math.ceil(missingFuel / TUNING.fuel_per_mote);
        const used = Math.min(carried, maxMotesNeeded);
        const gain = Math.round(Math.min(missingFuel, used * TUNING.fuel_per_mote));
        this.contextPromptEl.textContent = `${interactKey} - Cham dau (+${gain} fuel)`;
      }
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

    // Shade-appears directional arrow (accessibility cue)
    if (this.visible && snapshot.state === "playing" && shadeArrowProj && shadeArrowProj.visible) {
      this.shadeArrowEl.classList.add("visible");
      this.shadeArrowEl.style.left = `${(shadeArrowProj.screenX * 100).toFixed(2)}%`;
      this.shadeArrowEl.style.top = `${(shadeArrowProj.screenY * 100).toFixed(2)}%`;
      this.shadeArrowEl.style.transform = `rotate(${shadeArrowProj.angleRad.toFixed(3)}rad)`;
    } else {
      this.shadeArrowEl.classList.remove("visible");
    }
  }

  private refreshKeyLabels(): void {
    const b = this.bindings;
    const moveKeys = `${formatKeyCode(b.moveUp)}${formatKeyCode(b.moveLeft)}${formatKeyCode(b.moveDown)}${formatKeyCode(b.moveRight)}`;
    const jumpKey = formatKeyCode(b.jump);
    const dashKey = formatKeyCode(b.dash);
    const interactKey = formatKeyCode(b.interact);
    const pulseKey = formatKeyCode(b.pulse);
    const pauseKey = formatKeyCode(b.pause);

    this.dashKeyEl.textContent = dashKey;
    this.pulseKeyEl.textContent = `${pulseKey}/RMB`;
    this.pointerLockHintEl.textContent = `Click khóa chuột · ${pauseKey} Tạm dừng`;
    this.controlsHintEl.textContent = `${moveKeys}/↑↓←→ Di chuyển · ${jumpKey} Nhảy · ${dashKey} Lướt · ${interactKey} Thắp/Châm dầu · ${pulseKey}/RMB Tỏa Sáng · ${pauseKey} Tạm dừng`;
  }

  private showAlert(message: string, durationSec: number): void {
    this.alertTextEl.textContent = message;
    this.alertBannerEl.classList.add("visible");
    this.alertTimer = Math.max(this.alertTimer, durationSec);
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
