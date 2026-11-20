export type KeyAction =
  | "moveUp"
  | "moveDown"
  | "moveLeft"
  | "moveRight"
  | "jump"
  | "dash"
  | "interact"
  | "pulse"
  | "pause";

export type KeyBindings = Record<KeyAction, string>;

export const KEY_ACTION_ORDER: readonly KeyAction[] = [
  "moveUp",
  "moveDown",
  "moveLeft",
  "moveRight",
  "jump",
  "dash",
  "interact",
  "pulse",
  "pause",
];

export const KEY_ACTION_LABELS: Record<KeyAction, string> = {
  moveUp: "Đi tới (Lên)",
  moveDown: "Đi lùi (Xuống)",
  moveLeft: "Sang trái",
  moveRight: "Sang phải",
  jump: "Nhảy",
  dash: "Lướt (Dash)",
  interact: "Thắp / Châm dầu",
  pulse: "Tỏa Sáng (Pulse)",
  pause: "Tạm dừng",
};

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  moveUp: "KeyW",
  moveDown: "KeyS",
  moveLeft: "KeyA",
  moveRight: "KeyD",
  jump: "Space",
  dash: "ShiftLeft",
  interact: "KeyE",
  pulse: "KeyQ",
  pause: "Escape",
};

export interface GameSettings {
  volume: number; // 0.0 to 1.0
  mouseSensitivity: number; // 0.2 to 3.0
  colorBlind: boolean; // "Bảng màu dễ phân biệt"
  reducedMotion: boolean; // "Giảm chuyển động"
  largeText: boolean; // "Chữ lớn (x1.25)"
  keyBindings: KeyBindings;
}

export const SETTINGS_STORAGE_KEY = "dao_den_long_settings_v1";

function detectSystemReducedMotion(): boolean {
  try {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
  } catch {
    // Ignore matchMedia errors
  }
  return false;
}

export const DEFAULT_SETTINGS: GameSettings = {
  volume: 0.7,
  mouseSensitivity: 1.0,
  colorBlind: false,
  reducedMotion: false,
  largeText: false,
  keyBindings: { ...DEFAULT_KEY_BINDINGS },
};

export function formatKeyCode(code: string): string {
  if (!code) return "?";
  if (code.startsWith("Key") && code.length === 4) return code.slice(3);
  if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
  switch (code) {
    case "Space":
      return "Space";
    case "ShiftLeft":
    case "ShiftRight":
      return "Shift";
    case "ControlLeft":
    case "ControlRight":
      return "Ctrl";
    case "AltLeft":
    case "AltRight":
      return "Alt";
    case "Escape":
      return "Esc";
    case "Enter":
      return "Enter";
    case "Tab":
      return "Tab";
    case "Backspace":
      return "Bksp";
    case "ArrowUp":
      return "↑";
    case "ArrowDown":
      return "↓";
    case "ArrowLeft":
      return "←";
    case "ArrowRight":
      return "→";
    default:
      return code;
  }
}

export function normalizeKeyBindings(
  input?: Partial<Record<KeyAction, unknown>>
): KeyBindings {
  const result: KeyBindings = { ...DEFAULT_KEY_BINDINGS };
  if (!input || typeof input !== "object") return result;

  const used = new Set<string>();
  for (const action of KEY_ACTION_ORDER) {
    const raw = input[action];
    if (typeof raw === "string" && raw.length > 0 && !used.has(raw)) {
      result[action] = raw;
      used.add(raw);
    }
  }
  // Ensure no duplicates if a custom key collided with another action's default
  const seen = new Set<string>();
  for (const action of KEY_ACTION_ORDER) {
    if (seen.has(result[action])) {
      result[action] = DEFAULT_KEY_BINDINGS[action];
    }
    seen.add(result[action]);
  }
  return result;
}

export function clampSettings(input: Partial<GameSettings>): GameSettings {
  const rawVol =
    typeof input.volume === "number" && Number.isFinite(input.volume)
      ? input.volume
      : DEFAULT_SETTINGS.volume;
  const rawSens =
    typeof input.mouseSensitivity === "number" && Number.isFinite(input.mouseSensitivity)
      ? input.mouseSensitivity
      : DEFAULT_SETTINGS.mouseSensitivity;
  const colorBlind =
    typeof input.colorBlind === "boolean" ? input.colorBlind : DEFAULT_SETTINGS.colorBlind;
  const reducedMotion =
    typeof input.reducedMotion === "boolean"
      ? input.reducedMotion
      : DEFAULT_SETTINGS.reducedMotion;
  const largeText =
    typeof input.largeText === "boolean" ? input.largeText : DEFAULT_SETTINGS.largeText;
  const keyBindings = normalizeKeyBindings(input.keyBindings);

  return {
    volume: Math.min(1, Math.max(0, rawVol)),
    mouseSensitivity: Math.min(3.0, Math.max(0.2, rawSens)),
    colorBlind,
    reducedMotion,
    largeText,
    keyBindings,
  };
}

export function loadSettings(): GameSettings {
  const fallback: GameSettings = {
    ...DEFAULT_SETTINGS,
    reducedMotion: detectSystemReducedMotion(),
    keyBindings: { ...DEFAULT_KEY_BINDINGS },
  };
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return fallback;
    }
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return clampSettings({
      ...fallback,
      ...parsed,
    });
  } catch {
    return fallback;
  }
}

export function saveSettings(settings: GameSettings): void {
  const safe = clampSettings(settings);
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(safe));
  } catch {
    // Ignore storage quota or privacy-mode errors
  }
}
