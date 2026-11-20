import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  Sim,
  type EndLine,
  type InputFrame,
  type NightNumber,
  type ScenarioConfig,
  type SimSnapshot,
  type Vec3,
} from "../sim/index.js";

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

interface CliArgs {
  seed: number;
  night: NightNumber;
  scenarioPath?: string;
  inputsPath?: string;
  ticks: number;
  outPath: string;
  snapshotEvery: number;
}

const VALID_SHADE_STATES = new Set(["spawning", "wander", "chase", "recoil", "stunned", "drain"]);
const VALID_DRIFTER_STATES = new Set(["idle", "chase", "flee"]);
const VALID_MOTE_KINDS = new Set(["random", "dropped"]);

function round1(n: number): number {
  const r = Math.round(n * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
}

function round3(n: number): number {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}

function roundVec3(v: Vec3): Vec3 {
  return [round3(v[0]), round3(v[1]), round3(v[2])];
}

function serializeSnapshot(snap: SimSnapshot): SimSnapshot {
  return {
    type: "snapshot",
    tick: snap.tick,
    sim_tick: snap.sim_tick,
    night: snap.night,
    state: snap.state,
    time_left_s: round3(snap.time_left_s),
    score: snap.score,
    wind: {
      active: snap.wind.active,
      dir_deg: round3(snap.wind.dir_deg),
    },
    player: {
      pos: roundVec3(snap.player.pos),
      vel: roundVec3(snap.player.vel),
      grounded: snap.player.grounded,
      flames: snap.player.flames,
      carried: snap.player.carried,
      capacity: snap.player.capacity,
      invuln: snap.player.invuln,
      dash_cd_s: round3(snap.player.dash_cd_s),
      pulse_cd_s: round3(snap.player.pulse_cd_s),
      charm_s: round3(snap.player.charm_s),
    },
    lanterns: snap.lanterns.map((l) => ({
      id: l.id,
      pos: roundVec3(l.pos),
      lit: l.lit,
      deposited: l.deposited,
      fuel: round1(l.fuel),
      ever_lit: l.ever_lit,
      relit_count: l.relit_count,
    })),
    shades: snap.shades.map((s) => ({
      id: s.id,
      pos: roundVec3(s.pos),
      state: s.state,
    })),
    motes_active: snap.motes_active,
    motes: snap.motes.map((m) => ({
      id: m.id,
      pos: roundVec3(m.pos),
      kind: m.kind,
      ttl_s: m.ttl_s === null ? null : round3(m.ttl_s),
    })),
    drifters: snap.drifters.map((d) => ({
      id: d.id,
      pos: roundVec3(d.pos),
      state: d.state,
      stolen: d.stolen,
    })),
    charms: snap.charms.map((c) => ({
      id: c.id,
      pos: roundVec3(c.pos),
      available: c.available,
      respawn_s: round3(c.respawn_s),
    })),
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNonNegNumber(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0;
}

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber);
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

function parseCliArgs(argv: string[]): CliArgs {
  let seed: number | undefined;
  let night: number | undefined;
  let scenarioPath: string | undefined;
  let inputsPath: string | undefined;
  let ticks: number | undefined;
  let outPath: string | undefined;
  let snapshotEvery = 10;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--seed":
        seed = parseIntArg("--seed", argv[++i]);
        break;
      case "--night":
        night = parseIntArg("--night", argv[++i]);
        break;
      case "--scenario":
        scenarioPath = argv[++i];
        if (!scenarioPath) throw new Error("Missing value for --scenario");
        break;
      case "--inputs":
        inputsPath = argv[++i];
        if (!inputsPath) throw new Error("Missing value for --inputs");
        break;
      case "--ticks":
        ticks = parseIntArg("--ticks", argv[++i]);
        break;
      case "--out":
        outPath = argv[++i];
        if (!outPath) throw new Error("Missing value for --out");
        break;
      case "--snapshot-every":
        snapshotEvery = parseIntArg("--snapshot-every", argv[++i]);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (seed === undefined) throw new Error("Missing required argument: --seed");
  if (night === undefined) throw new Error("Missing required argument: --night");
  if (night !== 1 && night !== 2 && night !== 3) {
    throw new Error(`Unsupported --night ${night}; expected 1, 2, or 3`);
  }
  if (ticks === undefined) throw new Error("Missing required argument: --ticks");
  if (ticks < 0) throw new Error(`--ticks must be >= 0, got ${ticks}`);
  if (!outPath) throw new Error("Missing required argument: --out");
  if (snapshotEvery < 1) throw new Error(`--snapshot-every must be >= 1, got ${snapshotEvery}`);

  return { seed, night, scenarioPath, inputsPath, ticks, outPath, snapshotEvery };
}

function loadScenario(filePath: string): ScenarioConfig {
  const rawText = readFileSync(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new ValidationError(`Malformed JSON in scenario file: ${(err as Error).message}`);
  }

  if (!isPlainObject(parsed)) {
    throw new ValidationError("Scenario root must be a JSON object");
  }

  if (parsed.player !== undefined) {
    if (!isPlainObject(parsed.player)) {
      throw new ValidationError("scenario.player must be an object");
    }
    if (parsed.player.pos !== undefined && !isVec3(parsed.player.pos)) {
      throw new ValidationError("scenario.player.pos must be [x, y, z] numbers");
    }
    if (parsed.player.carried !== undefined && !isNonNegNumber(parsed.player.carried)) {
      throw new ValidationError("scenario.player.carried must be a non-negative number");
    }
    if (parsed.player.flames !== undefined && !isNonNegNumber(parsed.player.flames)) {
      throw new ValidationError("scenario.player.flames must be a non-negative number");
    }
    if (parsed.player.invuln_ticks !== undefined && !isNonNegNumber(parsed.player.invuln_ticks)) {
      throw new ValidationError("scenario.player.invuln_ticks must be a non-negative number");
    }
    if (parsed.player.dash_cd_ticks !== undefined && !isNonNegNumber(parsed.player.dash_cd_ticks)) {
      throw new ValidationError("scenario.player.dash_cd_ticks must be a non-negative number");
    }
    if (parsed.player.pulse_cd_ticks !== undefined && !isNonNegNumber(parsed.player.pulse_cd_ticks)) {
      throw new ValidationError("scenario.player.pulse_cd_ticks must be a non-negative number");
    }
    if (parsed.player.charm_ticks !== undefined && !isNonNegNumber(parsed.player.charm_ticks)) {
      throw new ValidationError("scenario.player.charm_ticks must be a non-negative number");
    }
    if (
      parsed.player.successful_lights !== undefined &&
      !isNonNegNumber(parsed.player.successful_lights)
    ) {
      throw new ValidationError("scenario.player.successful_lights must be a non-negative number");
    }
  }

  if (parsed.random_motes !== undefined && typeof parsed.random_motes !== "boolean") {
    throw new ValidationError("scenario.random_motes must be a boolean");
  }
  if (parsed.random_shades !== undefined && typeof parsed.random_shades !== "boolean") {
    throw new ValidationError("scenario.random_shades must be a boolean");
  }
  if (parsed.random_drifters !== undefined && typeof parsed.random_drifters !== "boolean") {
    throw new ValidationError("scenario.random_drifters must be a boolean");
  }
  if (parsed.wind_enabled !== undefined && typeof parsed.wind_enabled !== "boolean") {
    throw new ValidationError("scenario.wind_enabled must be a boolean");
  }

  if (parsed.motes !== undefined) {
    if (!Array.isArray(parsed.motes)) {
      throw new ValidationError("scenario.motes must be an array");
    }
    for (let i = 0; i < parsed.motes.length; i++) {
      const m = parsed.motes[i];
      if (isVec3(m)) continue;
      if (!isPlainObject(m) || !isVec3(m.pos)) {
        throw new ValidationError(
          `scenario.motes[${i}] must be [x, y, z] or an object with valid pos [x, y, z]`,
        );
      }
      if (m.id !== undefined && (typeof m.id !== "string" || m.id.length === 0)) {
        throw new ValidationError(`scenario.motes[${i}].id must be a non-empty string`);
      }
      if (m.kind !== undefined && (typeof m.kind !== "string" || !VALID_MOTE_KINDS.has(m.kind))) {
        throw new ValidationError(`scenario.motes[${i}].kind must be "random" or "dropped"`);
      }
      if (m.ttl_ticks !== undefined && !isNonNegNumber(m.ttl_ticks)) {
        throw new ValidationError(`scenario.motes[${i}].ttl_ticks must be a non-negative number`);
      }
    }
  }

  if (parsed.shades !== undefined) {
    if (!Array.isArray(parsed.shades)) {
      throw new ValidationError("scenario.shades must be an array");
    }
    for (let i = 0; i < parsed.shades.length; i++) {
      const s = parsed.shades[i];
      if (!isPlainObject(s) || !isVec3(s.pos)) {
        throw new ValidationError(`scenario.shades[${i}] must be an object with valid pos [x, y, z]`);
      }
      if (s.id !== undefined && (typeof s.id !== "string" || s.id.length === 0)) {
        throw new ValidationError(`scenario.shades[${i}].id must be a non-empty string`);
      }
      if (s.state !== undefined && (typeof s.state !== "string" || !VALID_SHADE_STATES.has(s.state))) {
        throw new ValidationError(
          `scenario.shades[${i}].state must be one of spawning, wander, chase, recoil, stunned, drain`,
        );
      }
      if (s.state_ticks_left !== undefined && !isNonNegNumber(s.state_ticks_left)) {
        throw new ValidationError(`scenario.shades[${i}].state_ticks_left must be a non-negative number`);
      }
      if (
        s.target_lantern_id !== undefined &&
        (typeof s.target_lantern_id !== "string" || s.target_lantern_id.length === 0)
      ) {
        throw new ValidationError(`scenario.shades[${i}].target_lantern_id must be a non-empty string`);
      }
    }
  }

  if (parsed.lanterns !== undefined) {
    if (!Array.isArray(parsed.lanterns)) {
      throw new ValidationError("scenario.lanterns must be an array");
    }
    for (let i = 0; i < parsed.lanterns.length; i++) {
      const l = parsed.lanterns[i];
      if (!isPlainObject(l) || typeof l.id !== "string" || l.id.length === 0) {
        throw new ValidationError(`scenario.lanterns[${i}] must be an object with string id`);
      }
      if (l.pos !== undefined && !isVec3(l.pos)) {
        throw new ValidationError(`scenario.lanterns[${i}].pos must be [x, y, z] numbers`);
      }
      if (l.deposited !== undefined && !isNonNegNumber(l.deposited)) {
        throw new ValidationError(`scenario.lanterns[${i}].deposited must be a non-negative number`);
      }
      if (l.lit !== undefined && typeof l.lit !== "boolean") {
        throw new ValidationError(`scenario.lanterns[${i}].lit must be a boolean`);
      }
      if (l.fuel !== undefined && !isNonNegNumber(l.fuel)) {
        throw new ValidationError(`scenario.lanterns[${i}].fuel must be a non-negative number`);
      }
      if (l.ever_lit !== undefined && typeof l.ever_lit !== "boolean") {
        throw new ValidationError(`scenario.lanterns[${i}].ever_lit must be a boolean`);
      }
    }
  }

  if (parsed.drifters !== undefined) {
    if (!Array.isArray(parsed.drifters)) {
      throw new ValidationError("scenario.drifters must be an array");
    }
    for (let i = 0; i < parsed.drifters.length; i++) {
      const d = parsed.drifters[i];
      if (!isPlainObject(d) || !isVec3(d.pos)) {
        throw new ValidationError(`scenario.drifters[${i}] must be an object with valid pos [x, y, z]`);
      }
      if (d.id !== undefined && (typeof d.id !== "string" || d.id.length === 0)) {
        throw new ValidationError(`scenario.drifters[${i}].id must be a non-empty string`);
      }
      if (
        d.state !== undefined &&
        (typeof d.state !== "string" || !VALID_DRIFTER_STATES.has(d.state))
      ) {
        throw new ValidationError(`scenario.drifters[${i}].state must be idle, chase, or flee`);
      }
      if (d.stolen !== undefined && !isNonNegNumber(d.stolen)) {
        throw new ValidationError(`scenario.drifters[${i}].stolen must be a non-negative number`);
      }
      if (d.flee_ticks_left !== undefined && !isNonNegNumber(d.flee_ticks_left)) {
        throw new ValidationError(`scenario.drifters[${i}].flee_ticks_left must be a non-negative number`);
      }
    }
  }

  if (parsed.charms !== undefined) {
    if (!Array.isArray(parsed.charms)) {
      throw new ValidationError("scenario.charms must be an array");
    }
    for (let i = 0; i < parsed.charms.length; i++) {
      const c = parsed.charms[i];
      if (!isPlainObject(c) || !isVec3(c.pos)) {
        throw new ValidationError(`scenario.charms[${i}] must be an object with valid pos [x, y, z]`);
      }
      if (c.id !== undefined && (typeof c.id !== "string" || c.id.length === 0)) {
        throw new ValidationError(`scenario.charms[${i}].id must be a non-empty string`);
      }
      if (c.available !== undefined && typeof c.available !== "boolean") {
        throw new ValidationError(`scenario.charms[${i}].available must be a boolean`);
      }
      if (c.respawn_ticks !== undefined && !isNonNegNumber(c.respawn_ticks)) {
        throw new ValidationError(`scenario.charms[${i}].respawn_ticks must be a non-negative number`);
      }
    }
  }

  if (parsed.time_left_s !== undefined && !isNonNegNumber(parsed.time_left_s)) {
    throw new ValidationError("scenario.time_left_s must be a non-negative number");
  }

  return parsed as unknown as ScenarioConfig;
}

function loadInputs(filePath: string): Map<number, InputFrame> {
  const rawText = readFileSync(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new ValidationError(`Malformed JSON in inputs file: ${(err as Error).message}`);
  }

  if (!isPlainObject(parsed) || !Array.isArray(parsed.frames)) {
    throw new ValidationError("Inputs file must be an object with a 'frames' array");
  }

  const map = new Map<number, InputFrame>();
  let prevTick = -1;

  for (let i = 0; i < parsed.frames.length; i++) {
    const f = parsed.frames[i];
    if (!isPlainObject(f)) {
      throw new ValidationError(`inputs.frames[${i}] must be an object`);
    }
    if (!isFiniteNumber(f.tick) || !Number.isInteger(f.tick) || f.tick < 0) {
      throw new ValidationError(`inputs.frames[${i}].tick must be a non-negative integer`);
    }
    if (f.tick <= prevTick) {
      throw new ValidationError(
        `inputs.frames ticks must be strictly increasing (frame ${i} has tick ${f.tick} <= previous ${prevTick})`,
      );
    }
    prevTick = f.tick;

    if (f.move !== undefined) {
      if (
        !Array.isArray(f.move) ||
        f.move.length !== 2 ||
        !isFiniteNumber(f.move[0]) ||
        !isFiniteNumber(f.move[1])
      ) {
        throw new ValidationError(`inputs.frames[${i}].move must be [x, z] numbers`);
      }
    }
    if (f.cam_yaw_deg !== undefined && !isFiniteNumber(f.cam_yaw_deg)) {
      throw new ValidationError(`inputs.frames[${i}].cam_yaw_deg must be a finite number`);
    }
    if (f.jump !== undefined && typeof f.jump !== "boolean") {
      throw new ValidationError(`inputs.frames[${i}].jump must be a boolean`);
    }
    if (f.interact !== undefined && typeof f.interact !== "boolean") {
      throw new ValidationError(`inputs.frames[${i}].interact must be a boolean`);
    }
    if (f.pulse !== undefined && typeof f.pulse !== "boolean") {
      throw new ValidationError(`inputs.frames[${i}].pulse must be a boolean`);
    }
    if (f.dash !== undefined && typeof f.dash !== "boolean") {
      throw new ValidationError(`inputs.frames[${i}].dash must be a boolean`);
    }
    if (f.pause !== undefined && typeof f.pause !== "boolean") {
      throw new ValidationError(`inputs.frames[${i}].pause must be a boolean`);
    }

    map.set(f.tick, f as unknown as InputFrame);
  }

  return map;
}

function main(): void {
  const args = parseCliArgs(process.argv.slice(2));
  const scenario = args.scenarioPath ? loadScenario(args.scenarioPath) : undefined;
  const inputMap = args.inputsPath ? loadInputs(args.inputsPath) : new Map<number, InputFrame>();

  const sim = new Sim({ seed: args.seed, night: args.night, scenario });
  const lines: string[] = [];

  let currentSnap = sim.getState();
  lines.push(JSON.stringify(serializeSnapshot(currentSnap)));

  for (let k = 0; k < args.ticks; k++) {
    if (currentSnap.state === "won" || currentSnap.state === "lost") {
      break;
    }
    const frame = inputMap.get(k);
    sim.step(frame ?? {});

    const events = sim.drainEvents();
    for (const ev of events) {
      lines.push(JSON.stringify(ev));
    }

    currentSnap = sim.getState();
    if (currentSnap.state === "won" || currentSnap.state === "lost") {
      lines.push(JSON.stringify(serializeSnapshot(currentSnap)));
      break;
    } else if (currentSnap.tick % args.snapshotEvery === 0) {
      lines.push(JSON.stringify(serializeSnapshot(currentSnap)));
    }
  }

  const endLine: EndLine = {
    type: "end",
    ticks: currentSnap.tick,
    state: currentSnap.state,
    score: currentSnap.score,
  };
  lines.push(JSON.stringify(endLine));

  mkdirSync(dirname(args.outPath), { recursive: true });
  writeFileSync(args.outPath, `${lines.join("\n")}\n`, "utf8");
}

try {
  main();
  process.exit(0);
} catch (err) {
  if (err instanceof ValidationError) {
    process.stderr.write(`Validation error: ${err.message}\n`);
    process.exit(2);
  }
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
}
