import { nightConfig } from "./maps.js";
import { mulberry32 } from "./rng.js";
import { SIM_CONSTANTS, TUNING } from "./tuning.js";
import type { ScenarioConfig, Vec3 } from "./types.js";

const BENCH_SHADE_COUNT = 200;
const BENCH_MOTE_COUNT = 100;
const BENCH_SPREAD_RADIUS_M = 38;
const BENCH_SAFE_MARGIN_M = TUNING.safe_radius + 0.5;

/**
 * Deterministic benchmark scenario on Night 1 (Đảo Bến):
 * - 200 Shades in state "wander" spread evenly over the island (outside L1-L3 safe zones)
 * - 100 Motes spread evenly over the island
 * - Lanterns L1-L3 lit with fuel 100 (L4-L5 unlit)
 * - Player at (0, 0, 0)
 * - No random spawns or wind
 */
export function makeBenchScenario(seed: number): ScenarioConfig {
  const rng = mulberry32(seed);
  const cfg = nightConfig(1);
  const litLanternPositions: Vec3[] = cfg.lanterns.slice(0, 3).map((l) => l.pos);

  const shades: NonNullable<ScenarioConfig["shades"]> = [];
  for (let i = 1; i <= BENCH_SHADE_COUNT; i++) {
    let x = 0;
    let z = 0;
    for (let attempt = 0; attempt < 32; attempt++) {
      const r = BENCH_SPREAD_RADIUS_M * Math.sqrt(rng());
      const angle = rng() * 2 * Math.PI;
      x = Math.round(r * Math.cos(angle) * 1000) / 1000;
      z = Math.round(r * Math.sin(angle) * 1000) / 1000;
      let inSafe = false;
      for (const lp of litLanternPositions) {
        if (Math.hypot(x - lp[0], z - lp[2]) < BENCH_SAFE_MARGIN_M) {
          inSafe = true;
          break;
        }
      }
      if (!inSafe) break;
    }
    shades.push({
      id: `S${i}`,
      pos: [x, SIM_CONSTANTS.shade_center_y_offset_m, z],
      state: "wander",
    });
  }

  const motes: NonNullable<ScenarioConfig["motes"]> = [];
  for (let i = 1; i <= BENCH_MOTE_COUNT; i++) {
    const r = BENCH_SPREAD_RADIUS_M * Math.sqrt(rng());
    const angle = rng() * 2 * Math.PI;
    const x = Math.round(r * Math.cos(angle) * 1000) / 1000;
    const z = Math.round(r * Math.sin(angle) * 1000) / 1000;
    motes.push({
      id: `M${i}`,
      pos: [x, 0, z],
      kind: "random",
    });
  }

  return {
    player: {
      pos: [0, 0, 0],
      carried: 0,
      flames: TUNING.flames,
    },
    random_motes: false,
    random_shades: false,
    random_drifters: false,
    wind_enabled: false,
    lanterns: [
      { id: "L1", lit: true, fuel: TUNING.fuel_max },
      { id: "L2", lit: true, fuel: TUNING.fuel_max },
      { id: "L3", lit: true, fuel: TUNING.fuel_max },
    ],
    shades,
    motes,
  };
}
