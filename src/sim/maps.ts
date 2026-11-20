import { TUNING } from "./tuning.js";
import type { NightConfig, NightNumber, Vec3 } from "./types.js";

function pt(cx: number, cz: number, r: number, deg: number, y: number): Vec3 {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), y, cz + r * Math.sin(rad)];
}

function norm2(dx: number, dz: number): [number, number] {
  const len = Math.hypot(dx, dz);
  return len === 0 ? [1, 0] : [dx / len, dz / len];
}

const NIGHT1_CONFIG: NightConfig = {
  night: 1,
  name: "Đảo Bến",
  introLine: "Đêm đầu tiên trên Đảo Bến — hãy gom ánh đom đóm và thắp sáng năm ngọn đèn lớn trước bình minh.",
  duration_s: TUNING.night1_duration_s,
  playerStart: [0, 0, 0],
  shade_speed: 4.0,
  shade_spawn_interval_ticks: 480,
  shade_cap: 6,
  drifters_enabled: false,
  wind_enabled: false,
  lanterns: [
    { id: "L1", pos: [0, 0, 25] },
    { id: "L2", pos: [23.8, 0, 7.7] },
    { id: "L3", pos: [14.7, 0, -20.2] },
    { id: "L4", pos: [-14.7, 0, -20.2] },
    { id: "L5", pos: [-23.8, 0, 7.7] },
  ],
  moteSpawnPoints: [
    ...Array.from({ length: 8 }, (_, k) => pt(0, 0, 12, k * 45, 0)),
    ...Array.from({ length: 16 }, (_, k) => pt(0, 0, 33, k * 22.5, 0)),
  ],
  shadeSpawnPoints: Array.from({ length: 12 }, (_, k) => pt(0, 0, 37, 15 + k * 30, 0)),
  jumpPads: [],
  charms: [],
  geometry: {
    islands: [{ center: [0, 0], radius: 40, y: 0 }],
  },
};

const NIGHT2_CONFIG: NightConfig = {
  night: 2,
  name: "Đảo Cầu",
  introLine: "Đảo Cầu nối hai bờ bằng cầu tre mảnh — coi chừng Gió Lạc và tận dụng bệ nhảy cùng Bùa Gió.",
  duration_s: TUNING.night2_duration_s,
  playerStart: [0, 0, 0],
  shade_speed: 4.0,
  shade_spawn_interval_ticks: 420,
  shade_cap: 8,
  drifters_enabled: true,
  wind_enabled: false,
  lanterns: [
    { id: "L1", pos: [0, 0, 20] },
    { id: "L2", pos: [17, 0, -10] },
    { id: "L3", pos: [-17, 0, -10] },
    { id: "L4", pos: [70, 0, 20] },
    { id: "L5", pos: [87, 0, -10] },
    { id: "L6", pos: [53, 0, -10] },
  ],
  moteSpawnPoints: [
    ...Array.from({ length: 4 }, (_, k) => pt(0, 0, 10, k * 90, 0)),
    ...Array.from({ length: 8 }, (_, k) => pt(0, 0, 22, k * 45, 0)),
    ...Array.from({ length: 4 }, (_, k) => pt(70, 0, 10, k * 90, 0)),
    ...Array.from({ length: 8 }, (_, k) => pt(70, 0, 22, k * 45, 0)),
  ],
  shadeSpawnPoints: [
    ...Array.from({ length: 8 }, (_, k) => pt(0, 0, 26, 22.5 + k * 45, 0)),
    ...Array.from({ length: 8 }, (_, k) => pt(70, 0, 26, 22.5 + k * 45, 0)),
  ],
  jumpPads: [
    {
      id: "JP1",
      pos: [20, 0, 18],
      radius: 1.0,
      launch_vy: 14.0,
      launch_vh: 24.0,
      dir: norm2(70 - 20, 0 - 18),
    },
    {
      id: "JP2",
      pos: [50, 0, -18],
      radius: 1.0,
      launch_vy: 14.0,
      launch_vh: 24.0,
      dir: norm2(0 - 50, 0 - -18),
    },
  ],
  charms: [{ id: "C1", pos: [35, 0, 0] }],
  geometry: {
    islands: [
      { center: [0, 0], radius: 28, y: 0 },
      { center: [70, 0], radius: 28, y: 0 },
    ],
    bridge: { xMin: 26, xMax: 44, zMin: -2, zMax: 2, y: 0 },
  },
};

const NIGHT3_CONFIG: NightConfig = {
  night: 3,
  name: "Đảo Chuông",
  introLine: "Đêm cuối trên Đảo Chuông — giữ vững bước chân trước gió giật và thắp sáng cả ba tầng đảo.",
  duration_s: TUNING.night3_duration_s,
  playerStart: [0, 0, -12],
  shade_speed: 4.5,
  shade_spawn_interval_ticks: 360,
  shade_cap: 10,
  drifters_enabled: true,
  wind_enabled: true,
  lanterns: [
    { id: "L1", pos: [0, 6, 6] },
    { id: "L2", pos: [18, 3, 10] },
    { id: "L3", pos: [-18, 3, 10] },
    { id: "L4", pos: [35, 0, -10] },
    { id: "L5", pos: [-35, 0, -10] },
    { id: "L6", pos: [20, 0, -35] },
    { id: "L7", pos: [-20, 0, -35] },
  ],
  moteSpawnPoints: [
    ...Array.from({ length: 18 }, (_, k) => pt(0, 0, 34, k * 20, 0)),
    ...Array.from({ length: 8 }, (_, k) => pt(0, 0, 18, (k + 1) * 20, 3)),
    ...Array.from({ length: 4 }, (_, k) => pt(0, 0, 5, 45 + k * 90, 6)),
  ],
  shadeSpawnPoints: Array.from({ length: 16 }, (_, k) => pt(0, 0, 43, k * 22.5, 0)),
  jumpPads: [
    {
      id: "JP1",
      pos: [0, 3, 13],
      radius: 1.0,
      launch_vy: 12.0,
      launch_vh: 8.0,
      dir: [0, -1],
    },
  ],
  charms: [
    { id: "C1", pos: [30, 0, 25] },
    { id: "C2", pos: [-30, 0, 25] },
  ],
  geometry: {
    islands: [{ center: [0, 0], radius: 45, y: 0 }],
    tiers: {
      tier1: { rMin: 12, rMax: 24, y: 3, zMin: 0 },
      tier2: { radius: 8, y: 6 },
      ramps: [
        { angle_deg: 30, r_foot: 30, r_top: 24, y_foot: 0, y_top: 3, width: 3 },
        { angle_deg: 150, r_foot: 30, r_top: 24, y_foot: 0, y_top: 3, width: 3 },
      ],
      bellTower: { center: [0, 0], radius: 2, yBase: 6, height: 8 },
    },
  },
};

const NIGHT_CONFIGS: Record<NightNumber, NightConfig> = {
  1: NIGHT1_CONFIG,
  2: NIGHT2_CONFIG,
  3: NIGHT3_CONFIG,
};

export function nightConfig(night: NightNumber): NightConfig {
  return NIGHT_CONFIGS[night];
}

// Precomputed trig constants for Night 3 ramps (30 deg and 150 deg)
const COS_30 = Math.cos((30 * Math.PI) / 180);
const SIN_30 = Math.sin((30 * Math.PI) / 180);
const COS_150 = Math.cos((150 * Math.PI) / 180);
const SIN_150 = Math.sin((150 * Math.PI) / 180);

export function getGroundHeight(night: NightNumber, x: number, z: number): number | null {
  if (night === 1) {
    return x * x + z * z <= 1600 ? 0.0 : null;
  }

  if (night === 2) {
    if (x * x + z * z <= 784) return 0.0;
    const dxB = x - 70;
    if (dxB * dxB + z * z <= 784) return 0.0;
    if (x >= 26 && x <= 44 && z >= -2 && z <= 2) return 0.0;
    return null;
  }

  // Night 3
  const r2 = x * x + z * z;
  if (r2 > 2025) return null; // 45^2 = 2025
  if (r2 <= 64) return 6.0; // 8^2 = 64
  if (z > 0 && r2 >= 144 && r2 <= 576) return 3.0; // 12^2 = 144, 24^2 = 576

  // Ramp at 30 deg
  const s1 = x * COS_30 + z * SIN_30;
  if (s1 >= 23.5 && s1 <= 30.0) {
    const perp1 = Math.abs(-x * SIN_30 + z * COS_30);
    if (perp1 <= 1.5) {
      return Math.min(3.0, Math.max(0.0, (3.0 * (30.0 - s1)) / 6.0));
    }
  }

  // Ramp at 150 deg
  const s2 = x * COS_150 + z * SIN_150;
  if (s2 >= 23.5 && s2 <= 30.0) {
    const perp2 = Math.abs(-x * SIN_150 + z * COS_150);
    if (perp2 <= 1.5) {
      return Math.min(3.0, Math.max(0.0, (3.0 * (30.0 - s2)) / 6.0));
    }
  }

  return 0.0;
}
