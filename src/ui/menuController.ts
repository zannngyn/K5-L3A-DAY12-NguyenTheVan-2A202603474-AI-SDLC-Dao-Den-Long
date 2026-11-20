import { TUNING, nightConfig, type GameOverReason, type NightNumber } from "../sim";
import {
  DEFAULT_KEY_BINDINGS,
  KEY_ACTION_LABELS,
  KEY_ACTION_ORDER,
  formatKeyCode,
  type GameSettings,
  type KeyAction,
} from "./settings";
import {
  describeStore,
  fetchLeaderboard,
  formatEntryDate,
  submitLeaderboardEntry,
  validateLeaderboardName,
} from "./leaderboard";

export type AppScreen =
  | "menu"
  | "intro"
  | "playing"
  | "paused"
  | "settings"
  | "leaderboard"
  | "result"
  | "dawn";

export interface NightResultData {
  night: NightNumber;
  won: boolean;
  reason: GameOverReason;
  nightScore: number;
  totalCampaignScore: number;
  nightsWon: number;
  seed: number;
  motesDeposited: number;
  firstLights: number;
  relights: number;
  shadesPulsedNormal: number;
  shadesPulsedDraining: number;
  dawnLanternBonus: number;
  litLanternsCount: number;
  totalLanterns: number;
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
  onRebindingChange: (active: boolean) => void;
  onUserGesture: () => void;
}

const WARNING_SVG = `<svg class="hud-warning-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2L1 21h22L12 2zm0 5.5l1.1 7h-2.2l1.1-7zm0 10.5a1.35 1.35 0 1 1 0-2.7 1.35 1.35 0 0 1 0 2.7z"/></svg>`;

const RESERVED_ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getIntroLine(night: NightNumber, interactKey: string): string {
  switch (night) {
    case 1:
      return `Đêm xuống trên Đảo Bến rồi, Mây ơi. Đèn sáng rồi vẫn sẽ cạn dầu — hãy giữ ít nhất 3/5 ngọn Đại Đăng sáng tới bình minh, nhấn ${interactKey} để thắp hoặc châm thêm dầu khi đèn yếu.`;
    case 2:
      return `Cầu tre Đảo Cầu trơn lắm, lại có Gió Lạc rình cướp sáng. Hãy mượn Bùa Gió và bệ nhảy qua hai bờ, nhấn ${interactKey} châm dầu kịp lúc để giữ ít nhất 4/6 ngọn đèn sáng tới bình minh.`;
    case 3:
      return `Đêm cuối trên Đảo Chuông gió giật từng cơn, Bóng Mực đông hơn và chực hút dầu đèn yếu. Giữ vững ngọn lửa, nhấn ${interactKey} châm dầu để giữ ít nhất 5/7 Đại Đăng sáng tới bình minh!`;
  }
}

export class MenuController {
  private readonly root: HTMLElement;
  private readonly overlayEl: HTMLElement;
  private readonly cardEl: HTMLElement;
  private readonly callbacks: MenuCallbacks;

  private currentScreen: AppScreen = "menu";
  private settingsReturnTo: "menu" | "paused" = "menu";
  private settings: GameSettings;
  private listeningAction: KeyAction | null = null;
  private activeKeyCaptureHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(container: HTMLElement, initialSettings: GameSettings, callbacks: MenuCallbacks) {
    this.root = container;
    this.settings = {
      ...initialSettings,
      keyBindings: { ...initialSettings.keyBindings },
    };
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
    this.cancelKeyCapture();
    this.currentScreen = "playing";
    this.overlayEl.classList.remove("visible", "dawn-theme");
  }

  public showMainMenu(): void {
    this.cancelKeyCapture();
    this.currentScreen = "menu";
    this.overlayEl.classList.remove("dawn-theme");
    this.overlayEl.classList.add("visible");

    const interactKey = formatKeyCode(this.settings.keyBindings.interact);

    this.cardEl.innerHTML = `
      <div class="ui-eyebrow">Ba Hòn Đảo · Đèn Cạn Dầu</div>
      <h1 class="ui-title">Đảo Đèn Lồng</h1>
      <p class="ui-subtitle">
        Cùng Mây và Bướm Đèn giữ ít nhất 3/5, 4/6, 5/7 ngọn Đại Đăng không cạn dầu cho tới bình minh qua ba đêm trên biển mây (nhấn ${escapeHtml(interactKey)} để thắp và châm dầu).
      </p>
      <div class="ui-actions">
        <button type="button" class="ui-btn ui-btn-primary" data-action="play">Bắt đầu hành trình (Đêm 1)</button>
        <button type="button" class="ui-btn ui-btn-secondary" data-action="leaderboard">Bảng xếp hạng</button>
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
    this.cardEl.querySelector('[data-action="leaderboard"]')?.addEventListener("click", () => {
      this.callbacks.onUserGesture();
      void this.showLeaderboard();
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

  public async showLeaderboard(): Promise<void> {
    this.cancelKeyCapture();
    this.currentScreen = "leaderboard";
    this.overlayEl.classList.remove("dawn-theme");
    this.overlayEl.classList.add("visible");

    this.cardEl.innerHTML = `
      <div class="ui-eyebrow">Top 10 Kỷ Lục</div>
      <h1 class="ui-title">Bảng xếp hạng</h1>
      <div class="ui-lb-empty">Đang tải bảng xếp hạng...</div>
      <div class="ui-actions">
        <button type="button" class="ui-btn ui-btn-primary" data-action="back">Quay lại</button>
      </div>
    `;
    this.cardEl.querySelector('[data-action="back"]')?.addEventListener("click", () => {
      this.showMainMenu();
    });

    const { entries, store } = await fetchLeaderboard();
    if (this.currentScreen !== "leaderboard") return;

    const bodyHtml =
      entries.length === 0
        ? `<div class="ui-lb-empty">Chưa có kỷ lục nào. Hãy hoàn thành hoặc thử sức một Đêm để ghi danh!</div>`
        : `
          <table class="ui-lb-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Tên</th>
                <th>Điểm</th>
                <th>Đêm thắng</th>
                <th>Ngày</th>
              </tr>
            </thead>
            <tbody>
              ${entries
                .map(
                  (e, idx) => `
                  <tr>
                    <td>${idx + 1}</td>
                    <td>${escapeHtml(e.name)}</td>
                    <td>${e.score}</td>
                    <td>${e.nights_won}/3</td>
                    <td>${escapeHtml(formatEntryDate(e.achieved_at))}</td>
                  </tr>
                `
                )
                .join("")}
            </tbody>
          </table>
        `;

    this.cardEl.innerHTML = `
      <div class="ui-eyebrow">Top 10 Kỷ Lục</div>
      <h1 class="ui-title">Bảng xếp hạng</h1>
      <div class="ui-store-badge">Nguồn lưu trữ: ${escapeHtml(describeStore(store))}</div>
      ${bodyHtml}
      <div class="ui-actions">
        <button type="button" class="ui-btn ui-btn-primary" data-action="back">Quay lại</button>
      </div>
    `;
    this.cardEl.querySelector('[data-action="back"]')?.addEventListener("click", () => {
      this.showMainMenu();
    });
  }

  public showNightIntro(night: NightNumber): void {
    this.cancelKeyCapture();
    this.currentScreen = "intro";
    this.overlayEl.classList.remove("dawn-theme");
    this.overlayEl.classList.add("visible");

    const cfg = nightConfig(night);
    const interactKey = formatKeyCode(this.settings.keyBindings.interact);
    const quote = getIntroLine(night, interactKey);
    const needed = Math.ceil(TUNING.win_ratio * cfg.lanterns.length);
    const mins = Math.floor(cfg.duration_s / 60);
    const secs = cfg.duration_s % 60;

    this.cardEl.innerHTML = `
      <div class="ui-eyebrow">Đêm ${night} / 3</div>
      <h1 class="ui-title">${cfg.name}</h1>
      <blockquote class="ui-quote">
        “${escapeHtml(quote)}”
        <span class="ui-quote-author">— Ông Đăng</span>
      </blockquote>
      <div class="ui-hint">
        Mục tiêu: Sống sót đến bình minh (${mins} phút${secs > 0 ? ` ${secs} giây` : ""}) với ít nhất ${needed}/${cfg.lanterns.length} Đại Đăng đang sáng. Đèn sẽ cạn dầu dần — nhấn ${escapeHtml(interactKey)} để thắp hoặc châm thêm dầu.
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
    this.cancelKeyCapture();
    this.currentScreen = "paused";
    this.overlayEl.classList.remove("dawn-theme");
    this.overlayEl.classList.add("visible");

    const cfg = nightConfig(night);
    const pauseKey = formatKeyCode(this.settings.keyBindings.pause);
    this.cardEl.innerHTML = `
      <div class="ui-eyebrow">Đêm ${night} · ${cfg.name}</div>
      <h1 class="ui-title">Tạm dừng</h1>
      <div class="ui-actions">
        <button type="button" class="ui-btn ui-btn-primary" data-action="resume">Tiếp tục (Resume)</button>
        <button type="button" class="ui-btn ui-btn-secondary" data-action="restart">Chơi lại Đêm ${night} (Restart Night)</button>
        <button type="button" class="ui-btn ui-btn-secondary" data-action="settings">Cài đặt (Settings)</button>
        <button type="button" class="ui-btn ui-btn-secondary" data-action="menu">Về Menu chính (Back to Menu)</button>
      </div>
      <div class="ui-hint">Nhấn ${escapeHtml(pauseKey)} để tiếp tục</div>
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
    this.cancelKeyCapture();
    this.currentScreen = "settings";
    this.settingsReturnTo = returnTo;
    this.overlayEl.classList.remove("dawn-theme");
    this.overlayEl.classList.add("visible");

    const volPct = Math.round(this.settings.volume * 100);
    const sensVal = this.settings.mouseSensitivity.toFixed(1);
    const cbChecked = this.settings.colorBlind ? "checked" : "";
    const rmChecked = this.settings.reducedMotion ? "checked" : "";
    const ltChecked = this.settings.largeText ? "checked" : "";

    const rebindRowsHtml = KEY_ACTION_ORDER.map((action) => {
      const label = KEY_ACTION_LABELS[action];
      const keyText = formatKeyCode(this.settings.keyBindings[action]);
      return `
        <div class="ui-rebind-row">
          <span>${escapeHtml(label)}</span>
          <button type="button" class="ui-rebind-btn" data-rebind="${action}">${escapeHtml(keyText)}</button>
        </div>
      `;
    }).join("");

    this.cardEl.innerHTML = `
      <div class="ui-eyebrow">Tùy chỉnh & Hỗ trợ tiếp cận</div>
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

      <label class="ui-setting-row ui-setting-toggle" for="setting-colorblind">
        <div class="ui-setting-toggle-label">
          <strong>Bảng màu dễ phân biệt</strong>
          <span>Bóng Mực xanh lam (#00B3FF), cảnh báo trắng kèm biểu tượng</span>
        </div>
        <input id="setting-colorblind" type="checkbox" ${cbChecked} />
      </label>

      <label class="ui-setting-row ui-setting-toggle" for="setting-reduced-motion">
        <div class="ui-setting-toggle-label">
          <strong>Giảm chuyển động (Reduced motion)</strong>
          <span>Tắt rung màn hình, tắt chớp đỏ khi trúng đòn, dịu hiệu ứng Tỏa Sáng</span>
        </div>
        <input id="setting-reduced-motion" type="checkbox" ${rmChecked} />
      </label>

      <label class="ui-setting-row ui-setting-toggle" for="setting-large-text">
        <div class="ui-setting-toggle-label">
          <strong>Chữ lớn (Large text x1.25)</strong>
          <span>Phóng to cỡ chữ giao diện thêm 25%</span>
        </div>
        <input id="setting-large-text" type="checkbox" ${ltChecked} />
      </label>

      <h2 class="ui-section-title">Gán phím điều khiển (Phím mũi tên luôn hỗ trợ di chuyển)</h2>
      <div class="ui-rebind-list">${rebindRowsHtml}</div>
      <div class="ui-rebind-conflict" role="alert" aria-live="polite"></div>

      <div class="ui-actions">
        <button type="button" class="ui-btn ui-btn-secondary" data-action="restore-keys">Khôi phục mặc định</button>
        <button type="button" class="ui-btn ui-btn-primary" data-action="back">Quay lại</button>
      </div>
    `;

    const volInput = this.cardEl.querySelector<HTMLInputElement>("#setting-volume")!;
    const volLabel = this.cardEl.querySelector<HTMLElement>("#setting-volume-val")!;
    const sensInput = this.cardEl.querySelector<HTMLInputElement>("#setting-sens")!;
    const sensLabel = this.cardEl.querySelector<HTMLElement>("#setting-sens-val")!;
    const cbInput = this.cardEl.querySelector<HTMLInputElement>("#setting-colorblind")!;
    const rmInput = this.cardEl.querySelector<HTMLInputElement>("#setting-reduced-motion")!;
    const ltInput = this.cardEl.querySelector<HTMLInputElement>("#setting-large-text")!;
    const conflictEl = this.cardEl.querySelector<HTMLElement>(".ui-rebind-conflict")!;

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

    cbInput.addEventListener("change", () => {
      this.callbacks.onUserGesture();
      this.settings = { ...this.settings, colorBlind: cbInput.checked };
      this.callbacks.onSettingsChange(this.settings);
    });

    rmInput.addEventListener("change", () => {
      this.callbacks.onUserGesture();
      this.settings = { ...this.settings, reducedMotion: rmInput.checked };
      this.callbacks.onSettingsChange(this.settings);
    });

    ltInput.addEventListener("change", () => {
      this.callbacks.onUserGesture();
      this.settings = { ...this.settings, largeText: ltInput.checked };
      this.callbacks.onSettingsChange(this.settings);
    });

    const rebindButtons = Array.from(
      this.cardEl.querySelectorAll<HTMLButtonElement>("[data-rebind]")
    );
    const refreshRebindButtons = (): void => {
      for (const btn of rebindButtons) {
        const action = btn.dataset.rebind as KeyAction;
        const isListening = this.listeningAction === action;
        btn.classList.toggle("listening", isListening);
        btn.textContent = isListening
          ? "Nhấn phím..."
          : formatKeyCode(this.settings.keyBindings[action]);
      }
    };

    for (const btn of rebindButtons) {
      btn.addEventListener("click", () => {
        this.callbacks.onUserGesture();
        const action = btn.dataset.rebind as KeyAction;
        conflictEl.textContent = "";
        this.cancelKeyCapture();
        this.listeningAction = action;
        this.callbacks.onRebindingChange(true);
        refreshRebindButtons();

        const onKey = (e: KeyboardEvent): void => {
          e.preventDefault();
          e.stopPropagation();
          const code = e.code;
          if (!code) return;

          // Check reserved arrow keys for non-movement actions
          const isMoveAction =
            action === "moveUp" ||
            action === "moveDown" ||
            action === "moveLeft" ||
            action === "moveRight";
          if (!isMoveAction && RESERVED_ARROW_KEYS.has(code)) {
            conflictEl.textContent = `Phím ${formatKeyCode(code)} luôn dành cho Di chuyển. Vui lòng chọn phím khác.`;
            this.cancelKeyCapture();
            refreshRebindButtons();
            return;
          }

          // Detect duplicate across other actions (do not silently overwrite)
          for (const other of KEY_ACTION_ORDER) {
            if (other !== action && this.settings.keyBindings[other] === code) {
              conflictEl.textContent = `Phím ${formatKeyCode(code)} đang trùng với "${KEY_ACTION_LABELS[other]}". Vui lòng chọn phím khác.`;
              this.cancelKeyCapture();
              refreshRebindButtons();
              return;
            }
          }

          this.settings = {
            ...this.settings,
            keyBindings: {
              ...this.settings.keyBindings,
              [action]: code,
            },
          };
          this.callbacks.onSettingsChange(this.settings);
          this.cancelKeyCapture();
          refreshRebindButtons();
        };

        this.activeKeyCaptureHandler = onKey;
        window.addEventListener("keydown", onKey, true);
      });
    }

    this.cardEl.querySelector('[data-action="restore-keys"]')?.addEventListener("click", () => {
      this.callbacks.onUserGesture();
      this.cancelKeyCapture();
      conflictEl.textContent = "";
      this.settings = {
        ...this.settings,
        keyBindings: { ...DEFAULT_KEY_BINDINGS },
      };
      this.callbacks.onSettingsChange(this.settings);
      refreshRebindButtons();
    });

    this.cardEl.querySelector('[data-action="back"]')?.addEventListener("click", () => {
      this.cancelKeyCapture();
      if (this.settingsReturnTo === "paused") {
        this.showPauseMenu(nightForPause);
      } else {
        this.showMainMenu();
      }
    });
  }

  public showResult(data: NightResultData): void {
    this.cancelKeyCapture();
    const isFinalDawn = data.won && data.reason === "dawn_survived" && data.night === 3;
    this.currentScreen = isFinalDawn ? "dawn" : "result";
    this.overlayEl.classList.toggle("dawn-theme", data.won);
    this.overlayEl.classList.add("visible");

    const cfg = nightConfig(data.night);
    const needed = Math.ceil(TUNING.win_ratio * data.totalLanterns);
    const litCount = data.litLanternsCount;

    const titleHtml = isFinalDawn
      ? "Bình Minh Ló Dạng!"
      : data.won && data.reason === "dawn_survived"
        ? `Bình Minh · Đêm ${data.night}`
        : data.reason === "no_flames"
          ? `${WARNING_SVG}Ngọn Lửa Đã Tắt`
          : `${WARNING_SVG}Bình Minh Quá Tối`;

    const subtitle = isFinalDawn
      ? "Cả ba hòn đảo đã giữ trọn ánh sáng đến bình minh. Mây và Bướm Đèn đã hoàn thành hành trình!"
      : data.won && data.reason === "dawn_survived"
        ? `Đã giữ ${litCount}/${data.totalLanterns} Đại Đăng sáng đến bình minh trên ${cfg.name}.`
        : data.reason === "no_flames"
          ? "Bóng Mực hoặc vực mây đã dập tắt ngọn lửa cuối cùng của Mây."
          : `Hết giờ! Chỉ có ${litCount}/${data.totalLanterns} Đại Đăng sáng (cần ${needed}/${data.totalLanterns}) trên ${cfg.name}.`;

    const motePts = data.motesDeposited * TUNING.score.per_mote;
    const firstLightPts = data.firstLights * TUNING.score.per_lantern;
    const relightPts = data.relights * TUNING.score.per_relight;
    const pulsePts =
      data.shadesPulsedNormal * TUNING.score.per_stun +
      data.shadesPulsedDraining * TUNING.score.per_stun_draining;

    const pulseDetail =
      data.shadesPulsedDraining > 0
        ? `${data.shadesPulsedNormal}×${TUNING.score.per_stun} + ${data.shadesPulsedDraining}×${TUNING.score.per_stun_draining} = ${pulsePts}`
        : `${data.shadesPulsedNormal} × ${TUNING.score.per_stun} = ${pulsePts}`;

    const rows: Array<[string, string, boolean?]> = [
      ["Đốm sáng đã nạp", `${data.motesDeposited} × ${TUNING.score.per_mote} = ${motePts}`],
      ["Thắp lần đầu", `${data.firstLights} × ${TUNING.score.per_lantern} = ${firstLightPts}`],
      ["Thắp lại đèn tắt", `${data.relights} × ${TUNING.score.per_relight} = ${relightPts}`],
      ["Tỏa Sáng trúng Bóng Mực", pulseDetail],
    ];

    if (data.won && data.reason === "dawn_survived") {
      const flameBonus = data.flamesLeft * TUNING.score.per_flame_left;
      rows.push([
        `Đèn sáng lúc bình minh (${litCount})`,
        `+${data.dawnLanternBonus}`,
      ]);
      rows.push([
        `Ngọn lửa còn lại (${data.flamesLeft} × ${TUNING.score.per_flame_left})`,
        `+${flameBonus}`,
      ]);
    }
    rows.push(["Tổng điểm hành trình", `${data.totalCampaignScore} pts`, true]);

    const breakdownHtml = rows
      .map(
        ([label, val, isTotal]) =>
          `<div class="ui-breakdown-row${isTotal ? " total" : ""}"><span>${label}</span><strong>${val}</strong></div>`
      )
      .join("");

    // Leaderboard name entry after final Dawn (win Night 3) OR after any loss
    const showNameEntry = isFinalDawn || !data.won;
    const leaderboardFormHtml = showNameEntry
      ? `
        <form class="ui-lb-form" id="lb-save-form" novalidate>
          <label for="lb-name-input">Lưu điểm vào Bảng xếp hạng (${data.totalCampaignScore} pts · ${data.nightsWon}/3 đêm)</label>
          <div class="ui-lb-input-row">
            <input
              id="lb-name-input"
              class="ui-lb-input"
              type="text"
              maxlength="12"
              autocomplete="nickname"
              placeholder="Nhập tên (3–12 ký tự)..."
            />
            <button type="submit" class="ui-btn ui-btn-primary" data-action="lb-save">Lưu</button>
            <button type="button" class="ui-btn ui-btn-secondary" data-action="lb-skip">Bỏ qua</button>
          </div>
          <div class="ui-lb-error" role="alert" aria-live="polite"></div>
        </form>
      `
      : "";

    const primaryBtnHtml = isFinalDawn
      ? `<button type="button" class="ui-btn ui-btn-primary" data-action="replay">Chơi lại từ Đêm 1</button>`
      : data.won
        ? `<button type="button" class="ui-btn ui-btn-primary" data-action="next">Tiếp tục Đêm ${data.night + 1}</button>`
        : `<button type="button" class="ui-btn ui-btn-primary" data-action="retry">Thử lại Đêm ${data.night}</button>`;

    this.cardEl.innerHTML = `
      <div class="ui-eyebrow">${isFinalDawn ? "Chiến thắng · Ba Hòn Đảo" : `Đêm ${data.night} · ${cfg.name}`}</div>
      <h1 class="ui-title${data.won ? "" : " lost"}">${titleHtml}</h1>
      <p class="ui-subtitle">${subtitle}</p>
      <div class="ui-score-big">${isFinalDawn ? `${data.totalCampaignScore} pts` : `${data.nightScore} pts`}</div>
      <div class="ui-breakdown">${breakdownHtml}</div>
      ${leaderboardFormHtml}
      <div class="ui-actions">
        ${primaryBtnHtml}
        <button type="button" class="ui-btn ui-btn-secondary" data-action="menu">Về Menu chính</button>
      </div>
    `;

    if (showNameEntry) {
      const form = this.cardEl.querySelector<HTMLFormElement>("#lb-save-form");
      const input = this.cardEl.querySelector<HTMLInputElement>("#lb-name-input");
      const errEl = this.cardEl.querySelector<HTMLElement>(".ui-lb-error");
      const skipBtn = this.cardEl.querySelector<HTMLButtonElement>('[data-action="lb-skip"]');

      input?.addEventListener("input", () => {
        if (!errEl) return;
        const val = input.value;
        errEl.textContent = val.trim().length > 0 ? (validateLeaderboardName(val) ?? "") : "";
      });

      skipBtn?.addEventListener("click", () => {
        if (form) {
          form.innerHTML = `<div class="ui-hint">Đã bỏ qua lưu điểm.</div>`;
        }
      });

      form?.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!input || !errEl) return;
        const validation = validateLeaderboardName(input.value);
        if (validation) {
          errEl.textContent = validation;
          input.focus();
          return;
        }
        errEl.textContent = "";
        const submitBtn = form.querySelector<HTMLButtonElement>('[data-action="lb-save"]');
        if (submitBtn) submitBtn.disabled = true;

        const res = await submitLeaderboardEntry({
          name: input.value.trim(),
          score: data.totalCampaignScore,
          nights_won: data.nightsWon,
          seed: data.seed,
        });

        if (!res.ok) {
          errEl.textContent = res.error ?? "Không thể lưu điểm.";
          if (submitBtn) submitBtn.disabled = false;
          return;
        }

        form.innerHTML = `
          <div class="ui-lb-saved">
            Đã lưu kỷ lục! (${escapeHtml(describeStore(res.store))})
          </div>
          <button type="button" class="ui-btn ui-btn-secondary" data-action="view-lb">Xem Bảng xếp hạng</button>
        `;
        form.querySelector('[data-action="view-lb"]')?.addEventListener("click", () => {
          void this.showLeaderboard();
        });
      });
    }

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

  private cancelKeyCapture(): void {
    if (this.activeKeyCaptureHandler) {
      window.removeEventListener("keydown", this.activeKeyCaptureHandler, true);
      this.activeKeyCaptureHandler = null;
    }
    if (this.listeningAction !== null) {
      this.listeningAction = null;
      this.callbacks.onRebindingChange(false);
    }
  }
}
