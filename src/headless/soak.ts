import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  mulberry32,
  nightConfig,
  Sim,
  SIM_CONSTANTS,
  type NightNumber,
} from "../sim/index.js";

interface SoakArgs {
  seed: number;
  nights: number;
  outPath: string;
}

interface SoakReport {
  nights: number;
  crashes: number;
  results: Array<"won" | "lost">;
  mem_start_mb: number;
  mem_end_mb: number;
  duration_s: number;
}

function parseIntArg(flag: string, raw: string | undefined): number {
  if (raw === undefined || !/^-?\d+$/.test(raw)) {
    throw new Error(`Invalid integer for ${flag}: ${raw ?? "<missing>"}`);
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`Integer out of range for ${flag}: ${raw}`);
  }
  return n;
}

function parseArgs(argv: string[]): SoakArgs {
  let seed = 7;
  let nights = 10;
  let outPath = "soak.json";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--seed":
        seed = parseIntArg("--seed", argv[++i]);
        break;
      case "--nights":
        nights = parseIntArg("--nights", argv[++i]);
        break;
      case "--out":
        outPath = argv[++i] ?? "";
        if (!outPath) throw new Error("Missing value for --out");
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (nights < 1) {
    throw new Error(`--nights must be >= 1, got ${nights}`);
  }

  return { seed, nights, outPath };
}

function maybeGc(): void {
  const g = globalThis as typeof globalThis & { gc?: () => void };
  if (typeof g.gc === "function") {
    g.gc();
  }
}

function getRssMb(): number {
  const mb = process.memoryUsage().rss / (1024 * 1024);
  return Math.round(mb * 10) / 10;
}

function runSingleNight(nightSeed: number, night: NightNumber, onLoaded?: () => void): "won" | "lost" {
  let sim: Sim | null = new Sim({ seed: nightSeed, night });
  if (onLoaded) {
    onLoaded();
  }

  const inputRng = mulberry32(nightSeed);
  const maxTicks = nightConfig(night).duration_s * SIM_CONSTANTS.tick_rate_hz;
  const move: [number, number] = [0, 0];
  const stepInput = { move, jump: false, dash: false, pulse: false, interact: false };
  let result: "won" | "lost" | null = null;

  for (let t = 0; t < maxTicks; t++) {
    if (t % 30 === 0) {
      const angle = inputRng() * 2 * Math.PI;
      move[0] = Math.cos(angle);
      move[1] = Math.sin(angle);
    }
    stepInput.jump = inputRng() < 0.05;
    stepInput.dash = inputRng() < 0.03;
    stepInput.pulse = inputRng() < 0.02;
    stepInput.interact = inputRng() < 0.1;

    sim.step(stepInput);
    const events = sim.drainEvents();
    for (let e = 0; e < events.length; e++) {
      const ev = events[e];
      if (ev.name === "game_over") {
        result = ev.data.result;
        break;
      }
    }
    if (result !== null) {
      break;
    }
  }

  if (result === null) {
    const finalState = sim.getState().state;
    result = finalState === "won" ? "won" : "lost";
  }

  // Drop simulation reference explicitly for GC
  sim = null;
  return result;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const startMs = Date.now();

  let crashes = 0;
  const results: Array<"won" | "lost"> = [];
  let memStartMb = 0;

  for (let i = 0; i < args.nights; i++) {
    const night = ((i % 3) + 1) as NightNumber;
    const nightSeed = args.seed + i;

    try {
      const res = runSingleNight(
        nightSeed,
        night,
        i === 0
          ? () => {
              maybeGc();
              memStartMb = getRssMb();
            }
          : undefined,
      );
      results.push(res);
    } catch {
      crashes += 1;
      results.push("lost");
      if (i === 0 && memStartMb === 0) {
        maybeGc();
        memStartMb = getRssMb();
      }
    }
  }

  maybeGc();
  const memEndMb = getRssMb();
  const durationS = Math.round(((Date.now() - startMs) / 1000) * 10) / 10;

  const report: SoakReport = {
    nights: args.nights,
    crashes,
    results,
    mem_start_mb: memStartMb,
    mem_end_mb: memEndMb,
    duration_s: durationS,
  };

  mkdirSync(dirname(args.outPath), { recursive: true });
  writeFileSync(args.outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

try {
  main();
  process.exit(0);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Soak error: ${msg}\n`);
  process.exit(1);
}
