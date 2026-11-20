export interface GameSettings {
  volume: number; // 0.0 to 1.0
  mouseSensitivity: number; // 0.2 to 3.0
}

export const SETTINGS_STORAGE_KEY = "dao_den_long_settings_v1";

export const DEFAULT_SETTINGS: GameSettings = {
  volume: 0.7,
  mouseSensitivity: 1.0,
};

export function clampSettings(input: Partial<GameSettings>): GameSettings {
  const rawVol = typeof input.volume === "number" && Number.isFinite(input.volume)
    ? input.volume
    : DEFAULT_SETTINGS.volume;
  const rawSens =
    typeof input.mouseSensitivity === "number" && Number.isFinite(input.mouseSensitivity)
      ? input.mouseSensitivity
      : DEFAULT_SETTINGS.mouseSensitivity;

  return {
    volume: Math.min(1, Math.max(0, rawVol)),
    mouseSensitivity: Math.min(3.0, Math.max(0.2, rawSens)),
  };
}

export function loadSettings(): GameSettings {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return { ...DEFAULT_SETTINGS };
    }
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return clampSettings(parsed);
  } catch {
    return { ...DEFAULT_SETTINGS };
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
