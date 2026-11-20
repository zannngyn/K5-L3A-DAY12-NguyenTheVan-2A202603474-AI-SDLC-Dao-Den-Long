import { nightConfig, type NightNumber } from "../sim";
import type { GameSettings } from "./settings";

export type AppScreen = "menu" | "intro" | "playing" | "paused" | "settings" | "result" | "dawn";

export interface NightResultData {
  night: NightNumber;
  won: boolean;
  reason: "all_lit" | "dawn" | "no_flames";
  nightScore: number;
  totalCampaignScore: number;
  motesDeposited: number;
  lanternsLit: number;
  shadesPulsed: number;
  timeLeftSec: number;
  flamesLeft: number;
}

export interface MenuCallbacks {
  onStartCampaign: () => void;
  onSelectNight: (night: NightNumber) => void;
  onBeginNight: () => void;
  onResume: () => void;
  onRestartNight: () => void;
  onNextNight: () => void;
  onRetryNight: () => void;
  onBackToMenu: () => void;
  onSettingsChange: (next: GameSettings) => void;
  onUserGesture: () => void;
}

const FALLBACK_ONG_DANG_LINES: Record<NightNumber, string> = {
  1: "Đêm xuống trên Đảo Bến rồi, Mây ơi. Hãy gom những đốm sáng và thắp đủ năm ngọn Đại Đăng trước bình minh.",
  2: "Cầu tre Đảo Cầu trơn lắm, lại có Gió Lạc rình cướp sáng. Hãy nhờ Bùa Gió và những bệ nhảy mà băng qua.",
  3: "Đỉnh Đảo Chuông gió giật từng cơn, Bóng Mực đông hơn trước. Giữ vững ngọn lửa, thắp sáng đêm cuối cùng này!",
};

export class MenuController {
  private readonly root: HTMLElement;
  private readonly overlayEl: HTMLElement;
  private readonly cardEl: HTMLElement;
  private readonly callbacks: MenuCallbacks;

  private currentScreen: AppScreen = "menu";
  private settingsReturnTo: "menu" | "paused" = "menu";
  private settings: GameSettings;

  constructor(container: HTMLElement, initialSettings: GameSettings, callbacks: MenuCallbacks) {
    this.root = container;
    this.settings = { ...initialSettings };
    this.callbacks = callbacks;

    this.root.innerHTML = `
      <div class="ui-overlay visible" role="dialog" aria-modal="true">
        <div class="ui-card"></div>
      </div>
    `;
    this.overlayEl = this.root.querySelector(".ui-overlay")!;
    this.cardEl = this.root.querySelector(".ui-card")!;
    this.showMainMenu();
  }

  public getScreen(): AppScreen {
    return this.currentScreen;
  }

  public hide(): void {
    this.currentScreen = "playing";
    this.overlayEl.classList.remove("visible", "dawn-theme");
  }

  public showMainMenu(): void {
    this.currentScreen = "menu";
    this.overlayEl.classList.remove("dawn-theme");
    this.overlayEl.classList.add("visible");

    this.cardEl.innerHTML = `
      <div class="ui-eyebrow">Ba Hòn Đảo · Phase 2</div>
      <h1 class="ui-title">Đảo Đèn Lồng</h1>
      <p class="ui-subtitle">
        Cùng Mây và Bướm Đèn thắp sáng những ngọn Đại Đăng qua ba đêm trên biển mây.
      </p>
      <div class="ui-actions">
        <button type="button" class="ui-btn ui-btn-primary" data-action="play">Bắt đầu hành trình (Đêm 1)</button>
        <button type="button" class="ui-btn ui-btn-secondary" data-action="settings">Cài đặt / Settings</button>
      </div>
      <div class="ui-night-select">
        <span>Chọn nhanh:</span>
        <button type="button" class="ui-night-chip" data-night="1">Đêm 1</button>
        <button type="button" class="ui-night-chip" data-night="2">Đêm 2</button>
        <button type="button" class="ui-night-chip" data-night="3">Đêm 3</button>
      </div>
    `;

    this.cardEl.querySelector('[data-action="play"]')?.addEventListener("click", () => {
      this.callbacks.onUserGesture();
      this.callbacks.onStartCampaign();
    });
    this.cardEl.querySelector('[data-action="settings"]')?.addEventListener("click", () => {
      this.callbacks.onUserGesture();
      this.showSettings("menu");
    });
    this.cardEl.querySelectorAll<HTMLButtonElement>("[data-night]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.callbacks.onUserGesture();
        const n = Number(btn.dataset.night) as NightNumber;
        this.callbacks.onSelectNight(n);
      });
    });
  }

  public showNightIntro(night: NightNumber): void {
    this.currentScreen = "intro";
    this.overlayEl.classList.remove("dawn-theme");
    this.overlayEl.classList.add("visible");

    const cfg = nightConfig(night);
    const quote = cfg.introLine || FALLBACK_ONG_DANG_LINES[night];

    this.cardEl.innerHTML = `
      <div class="ui-eyebrow">Đêm ${night} / 3</div>
      <h1 class="ui-title">${cfg.name}</h1>
      <blockquote class="ui-quote">
        “${quote}”
        <span class="ui-quote-author">— Ông Đăng</span>
      </blockquote>
      <div class="ui-hint">
        Thắp sáng ${cfg.lanterns.length} Đại Đăng trong ${Math.floor(cfg.duration_s / 60)} phút ${cfg.duration_s % 60 > 0 ? `${cfg.duration_s % 60} giây` : ""}.
      </div>
      <div class="ui-actions">
        <button type="button" class="ui-btn ui-btn-primary" data-action="begin">Vào Đêm ${night}</button>
        <button type="button" class="ui-btn ui-btn-secondary" data-action="menu">Về Menu chính</button>
      </div>
    `;

    this.cardEl.querySelector('[data-action="begin"]')?.addEventListener("click", () => {
      this.callbacks.onUserGesture();
      this.callbacks.onBeginNight();
    });
    this.cardEl.querySelector('[data-action="menu"]')?.addEventListener("click", () => {
      this.callbacks.onUserGesture();
      this.callbacks.onBackToMenu();
    });
  }

  public showPauseMenu(night: NightNumber): void {
    this.currentScreen = "paused";
    this.overlayEl.classList.remove("dawn-theme");
    this.overlayEl.classList.add("visible");

    const cfg = nightConfig(night);
    this.cardEl.innerHTML = `
      <div class="ui-eyebrow">Đêm ${night} · ${cfg.name}</div>
      <h1 class="ui-title">Tạm dừng</h1>
      <div class="ui-actions">
        <button type="button" class="ui-btn ui-btn-primary" data-action="resume">Tiếp tục (Resume)</button>
        <button type="button" class="ui-btn ui-btn-secondary" data-action="restart">Chơi lại Đêm ${night} (Restart Night)</button>
        <button type="button" class="ui-btn ui-btn-secondary" data-action="settings">Cài đặt (Settings)</button>
        <button type="button" class="ui-btn ui-btn-secondary" data-action="menu">Về Menu chính (Back to Menu)</button>
      </div>
      <div class="ui-hint">Nhấn Esc hoặc P để tiếp tục</div>
    `;

    this.cardEl.querySelector('[data-action="resume"]')?.addEventListener("click", () => {
      this.callbacks.onUserGesture();
      this.callbacks.onResume();
    });
    this.cardEl.querySelector('[data-action="restart"]')?.addEventListener("click", () => {
      this.callbacks.onUserGesture();
      this.callbacks.onRestartNight();
    });
    this.cardEl.querySelector('[data-action="settings"]')?.addEventListener("click", () => {
      this.callbacks.onUserGesture();
      this.showSettings("paused", night);
    });
    this.cardEl.querySelector('[data-action="menu"]')?.addEventListener("click", () => {
      this.callbacks.onUserGesture();
      this.callbacks.onBackToMenu();
    });
  }

  public showSettings(returnTo: "menu" | "paused", nightForPause: NightNumber = 1): void {
    this.currentScreen = "settings";
    this.settingsReturnTo = returnTo;
    this.overlayEl.classList.remove("dawn-theme");
    this.overlayEl.classList.add("visible");

    const volPct = Math.round(this.settings.volume * 100);
    const sensVal = this.settings.mouseSensitivity.toFixed(1);

    this.cardEl.innerHTML = `
      <div class="ui-eyebrow">Tùy chỉnh</div>
      <h1 class="ui-title">Cài đặt</h1>

      <div class="ui-setting-row">
        <div class="ui-setting-header">
          <label for="setting-volume">Âm lượng (Volume)</label>
          <span id="setting-volume-val">${volPct}%</span>
        </div>
        <input id="setting-volume" type="range" min="0" max="100" step="1" value="${volPct}" />
      </div>

      <div class="ui-setting-row">
        <div class="ui-setting-header">
          <label for="setting-sens">Độ nhạy chuột (Mouse Sensitivity)</label>
          <span id="setting-sens-val">${sensVal}x</span>
        </div>
        <input id="setting-sens" type="range" min="0.2" max="3.0" step="0.1" value="${sensVal}" />
      </div>

      <div class="ui-actions">
        <button type="button" class="ui-btn ui-btn-primary" data-action="back">Quay lại</button>
      </div>
    `;

    const volInput = this.cardEl.querySelector<HTMLInputElement>("#setting-volume")!;
    const volLabel = this.cardEl.querySelector<HTMLElement>("#setting-volume-val")!;
    const sensInput = this.cardEl.querySelector<HTMLInputElement>("#setting-sens")!;
    const sensLabel = this.cardEl.querySelector<HTMLElement>("#setting-sens-val")!;

    volInput.addEventListener("input", () => {
      this.callbacks.onUserGesture();
      const pct = Number(volInput.value);
      volLabel.textContent = `${pct}%`;
      this.settings = { ...this.settings, volume: pct / 100 };
      this.callbacks.onSettingsChange(this.settings);
    });

    sensInput.addEventListener("input", () => {
      const val = Number(sensInput.value);
      sensLabel.textContent = `${val.toFixed(1)}x`;
      this.settings = { ...this.settings, mouseSensitivity: val };
      this.callbacks.onSettingsChange(this.settings);
    });

    this.cardEl.querySelector('[data-action="back"]')?.addEventListener("click", () => {
      if (this.settingsReturnTo === "paused") {
        this.showPauseMenu(nightForPause);
      } else {
        this.showMainMenu();
      }
    });
  }

  public showResult(data: NightResultData): void {
    const isDawn = data.won && data.night === 3;
    this.currentScreen = isDawn ? "dawn" : "result";
    this.overlayEl.classList.toggle("dawn-theme", isDawn);
    this.overlayEl.classList.add("visible");

    const cfg = nightConfig(data.night);
    const title = isDawn
      ? "Bình Minh Ló Dạng!"
      : data.won
        ? `Hoàn thành Đêm ${data.night}`
        : data.reason === "no_flames"
          ? "Ngọn Lửa Đã Tắt"
          : "Bình Minh Quá Sớm";

    const subtitle = isDawn
      ? "Cả ba hòn đảo đã rực sáng. Mây và Bướm Đèn đã giữ trọn ánh sáng cho biển mây!"
      : data.won
        ? `Tất cả Đại Đăng trên ${cfg.name} đã tỏa sáng.`
        : data.reason === "no_flames"
          ? "Bóng Mực hoặc vực mây đã dập tắt ngọn lửa cuối cùng của Mây."
          : `Hết giờ trước khi thắp đủ Đại Đăng trên ${cfg.name}.`;

    const rows: Array<[string, string, boolean?]> = [
      ["Đốm sáng đã nạp", `${data.motesDeposited} × 10 = ${data.motesDeposited * 10}`],
      ["Đại Đăng đã thắp", `${data.lanternsLit} × 100 = ${data.lanternsLit * 100}`],
      ["Tỏa Sáng trúng Bóng Mực", `${data.shadesPulsed} × 5 = ${data.shadesPulsed * 5}`],
    ];

    if (data.won) {
      const secBonus = Math.floor(data.timeLeftSec) * 2;
      const flameBonus = data.flamesLeft * 50;
      rows.push(["Thưởng thời gian còn lại", `+${secBonus}`]);
      rows.push(["Thưởng ngọn lửa còn lại", `+${flameBonus}`]);
    }
    rows.push(["Tổng điểm hành trình", `${data.totalCampaignScore} pts`, true]);

    const breakdownHtml = rows
      .map(
        ([label, val, isTotal]) =>
          `<div class="ui-breakdown-row${isTotal ? " total" : ""}"><span>${label}</span><strong>${val}</strong></div>`
      )
      .join("");

    const primaryBtnHtml = isDawn
      ? `<button type="button" class="ui-btn ui-btn-primary" data-action="replay">Chơi lại từ Đêm 1</button>`
      : data.won
        ? `<button type="button" class="ui-btn ui-btn-primary" data-action="next">Tiếp tục Đêm ${data.night + 1}</button>`
        : `<button type="button" class="ui-btn ui-btn-primary" data-action="retry">Thử lại Đêm ${data.night}</button>`;

    this.cardEl.innerHTML = `
      <div class="ui-eyebrow">${isDawn ? "Chiến thắng · Ba Hòn Đảo" : `Đêm ${data.night} · ${cfg.name}`}</div>
      <h1 class="ui-title${data.won ? "" : " lost"}">${title}</h1>
      <p class="ui-subtitle">${subtitle}</p>
      <div class="ui-score-big">${isDawn ? `${data.totalCampaignScore} pts` : `${data.nightScore} pts`}</div>
      <div class="ui-breakdown">${breakdownHtml}</div>
      <div class="ui-actions">
        ${primaryBtnHtml}
        <button type="button" class="ui-btn ui-btn-secondary" data-action="menu">Về Menu chính</button>
      </div>
    `;

    this.cardEl.querySelector('[data-action="next"]')?.addEventListener("click", () => {
      this.callbacks.onUserGesture();
      this.callbacks.onNextNight();
    });
    this.cardEl.querySelector('[data-action="retry"]')?.addEventListener("click", () => {
      this.callbacks.onUserGesture();
      this.callbacks.onRetryNight();
    });
    this.cardEl.querySelector('[data-action="replay"]')?.addEventListener("click", () => {
      this.callbacks.onUserGesture();
      this.callbacks.onStartCampaign();
    });
    this.cardEl.querySelector('[data-action="menu"]')?.addEventListener("click", () => {
      this.callbacks.onUserGesture();
      this.callbacks.onBackToMenu();
    });
  }
}
