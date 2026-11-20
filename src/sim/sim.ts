import { getGroundHeight, nightConfig } from "./maps.js";
import { mulberry32 } from "./rng.js";
import { SIM_CONSTANTS, TUNING } from "./tuning.js";
import type {
  CharmState,
  DrifterBehaviorState,
  DrifterState,
  GameState,
  LanternState,
  MoteKind,
  MoteState,
  NightConfig,
  NightNumber,
  PlayerState,
  ScenarioConfig,
  ShadeBehaviorState,
  ShadeState,
  SimEvent,
  SimOptions,
  SimSnapshot,
  StepInput,
  Vec3,
  WindState,
} from "./types.js";

interface InternalLantern {
  id: string;
  pos: Vec3;
  lit: boolean;
  deposited: number;
  fuel_units: number;
  ever_lit: boolean;
  relit_count: number;
}

interface InternalMote {
  id: string;
  pos: Vec3;
  kind: MoteKind;
  ttl_ticks: number | null;
  spawned_this_tick: boolean;
}

interface InternalShade {
  id: string;
  pos: Vec3;
  state: ShadeBehaviorState;
  state_ticks_left: number;
  pulse_push_ticks_left: number;
  pulse_push_dir: [number, number];
  recoil_dir: [number, number];
  safe_push_ticks_left: number;
  safe_push_lantern_id: string | null;
  target_lantern_id: string | null;
  drain_ticks: number;
  wander_dir: [number, number];
  wander_ticks_left: number;
  spawned_this_tick: boolean;
}

interface InternalDrifter {
  id: string;
  pos: Vec3;
  state: DrifterBehaviorState;
  stolen: number;
  has_stolen: boolean;
  flee_ticks_left: number;
  wander_dir: [number, number];
  wander_ticks_left: number;
  spawned_this_tick: boolean;
}

interface InternalCharm {
  id: string;
  pos: Vec3;
  available: boolean;
  respawn_ticks: number;
}

interface HeldInput {
  move: [number, number];
  cam_yaw_deg: number;
  jump: boolean;
  interact: boolean;
  pulse: boolean;
  dash: boolean;
  pause: boolean;
}

function compareIds(a: string, b: string): number {
  const ma = /^([A-Za-z]+)(\d+)$/.exec(a);
  const mb = /^([A-Za-z]+)(\d+)$/.exec(b);
  if (ma && mb && ma[1] === mb[1]) {
    return Number(ma[2]) - Number(mb[2]);
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function distXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function dist3D(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function normalizeXZ(dx: number, dz: number): [number, number] {
  const d = Math.hypot(dx, dz);
  return d === 0 ? [1, 0] : [dx / d, dz / d];
}

function fuelUnitsToDisplay(units: number): number {
  if (units <= 0) return 0;
  const r = Math.round((units * 10) / SIM_CONSTANTS.fuel_units_per_point) / 10;
  return Object.is(r, -0) ? 0 : r;
}

function hasSafeZone(l: InternalLantern): boolean {
  return l.lit && l.fuel_units >= SIM_CONSTANTS.low_fuel_threshold_units;
}

function resolvePlayerHorizontal(
  night: NightNumber,
  curX: number,
  curZ: number,
  curY: number,
  candX: number,
  candZ: number,
): [number, number] {
  let resX = candX;
  let resZ = candZ;

  // Tier vertical wall check (Night 3; harmless on Nights 1 & 2 where ground is 0)
  const hCand = getGroundHeight(night, resX, resZ);
  if (hCand !== null && hCand > curY + SIM_CONSTANTS.max_step_up_m) {
    const hX = getGroundHeight(night, resX, curZ);
    const hZ = getGroundHeight(night, curX, resZ);
    const okX = hX === null || hX <= curY + SIM_CONSTANTS.max_step_up_m;
    const okZ = hZ === null || hZ <= curY + SIM_CONSTANTS.max_step_up_m;
    if (okX) {
      resZ = curZ;
    } else if (okZ) {
      resX = curX;
    } else {
      resX = curX;
      resZ = curZ;
    }
  }

  // Night 3 Bell Tower cylinder (center (0, 0), radius 2.0, top Y = 14.0)
  if (night === 3 && curY < 14.0) {
    const br = Math.hypot(resX, resZ);
    if (br < 2.0) {
      if (br === 0) {
        resX = 2.001;
        resZ = 0;
      } else {
        const s = 2.001 / br;
        resX *= s;
        resZ *= s;
      }
    }
  }

  return [resX, resZ];
}

function isShadeBlocked(
  night: NightNumber,
  prevGroundY: number,
  x: number,
  z: number,
): { blocked: boolean; groundY: number } {
  const h = getGroundHeight(night, x, z);
  if (h === null) return { blocked: true, groundY: prevGroundY };
  if (h > prevGroundY + SIM_CONSTANTS.max_step_up_m) return { blocked: true, groundY: prevGroundY };
  if (night === 3 && Math.hypot(x, z) < 2.0) return { blocked: true, groundY: prevGroundY };
  return { blocked: false, groundY: h };
}

export class Sim {
  private readonly rng: () => number;
  private readonly night: NightNumber;
  private readonly cfg: NightConfig;
  private readonly randomMotes: boolean;
  private readonly randomShades: boolean;
  private readonly randomDrifters: boolean;
  private readonly windEnabled: boolean;

  private tick = 0;
  private simTick = 0;
  private state: GameState = "playing";
  private remainingTicks: number;
  private timeLeftS: number;
  private score = 0;

  private playerPos: Vec3;
  private playerVel: Vec3 = [0, 0, 0];
  private grounded = true;
  private facing: [number, number] = [0, 1];
  private flames: number;
  private carried: number;

  private invulnTicks: number;
  private dashCdTicks: number;
  private pulseCdTicks: number;
  private charmTicks: number;
  private dashTicksLeft = 0;
  private dashDir: [number, number] = [0, 1];
  private launchLocked = false;
  private fallRespawnTicks = 0;

  private wind: WindState = { active: false, dir_deg: 0 };
  private nextWindDirDeg = 0;
  private currentWindDirDeg = 0;

  private lanterns: LanternState[];
  private motes: InternalMote[] = [];
  private shades: InternalShade[] = [];
  private drifters: InternalDrifter[] = [];
  private charms: InternalCharm[] = [];

  private nextMoteNum = 1;
  private nextShadeNum = 1;
  private nextDrifterNum = 1;

  private heldInput: HeldInput = {
    move: [0, 0],
    cam_yaw_deg: 0,
    jump: false,
    interact: false,
    pulse: false,
    dash: false,
    pause: false,
  };

  private eventQueue: SimEvent[] = [];

  constructor(options: SimOptions) {
    this.rng = mulberry32(options.seed);
    this.night = options.night ?? 1;
    this.cfg = nightConfig(this.night);
    const scenario: ScenarioConfig | undefined = options.scenario;

    this.randomMotes = scenario?.random_motes ?? true;
    this.randomShades = scenario?.random_shades ?? true;
    this.randomDrifters = scenario?.random_drifters ?? this.cfg.drifters_enabled;
    this.windEnabled = scenario?.wind_enabled ?? this.cfg.wind_enabled;

    const initialTimeLeftS = scenario?.time_left_s ?? this.cfg.duration_s;
    this.remainingTicks = Math.max(0, Math.round(initialTimeLeftS * SIM_CONSTANTS.tick_rate_hz));
    this.timeLeftS = this.remainingTicks / SIM_CONSTANTS.tick_rate_hz;

    this.playerPos = scenario?.player?.pos
      ? [scenario.player.pos[0], scenario.player.pos[1], scenario.player.pos[2]]
      : [this.cfg.playerStart[0], this.cfg.playerStart[1], this.cfg.playerStart[2]];
    const startH = getGroundHeight(this.night, this.playerPos[0], this.playerPos[2]);
    this.grounded = startH !== null && Math.abs(this.playerPos[1] - startH) <= 0.05;

    this.flames = scenario?.player?.flames ?? TUNING.flames;
    this.carried = scenario?.player?.carried ?? 0;
    this.invulnTicks = scenario?.player?.invuln_ticks ?? 0;
    this.dashCdTicks = scenario?.player?.dash_cd_ticks ?? 0;
    this.pulseCdTicks = scenario?.player?.pulse_cd_ticks ?? 0;
    this.charmTicks = scenario?.player?.charm_ticks ?? 0;

    // Lanterns
    this.lanterns = this.cfg.lanterns.map((l) => ({
      id: l.id,
      pos: [l.pos[0], l.pos[1], l.pos[2]],
      lit: false,
      deposited: 0,
    }));
    if (scenario?.lanterns) {
      for (const patch of scenario.lanterns) {
        const target = this.lanterns.find((l) => l.id === patch.id);
        if (!target) continue;
        if (patch.pos !== undefined) {
          target.pos = [patch.pos[0], patch.pos[1], patch.pos[2]];
        }
        if (patch.deposited !== undefined) {
          target.deposited = patch.deposited;
        }
        if (patch.lit !== undefined) {
          target.lit = patch.lit;
        }
      }
    }

    // Motes
    if (scenario?.motes !== undefined) {
      let maxParsedM = 0;
      const usedIds = new Set<string>();
      for (const entry of scenario.motes) {
        if (!Array.isArray(entry) && entry.id !== undefined) {
          usedIds.add(entry.id);
          const m = /^M(\d+)$/.exec(entry.id);
          if (m) maxParsedM = Math.max(maxParsedM, Number(m[1]));
        }
      }
      let autoNum = 1;
      for (const entry of scenario.motes) {
        if (Array.isArray(entry)) {
          while (usedIds.has(`M${autoNum}`)) autoNum++;
          const id = `M${autoNum}`;
          usedIds.add(id);
          maxParsedM = Math.max(maxParsedM, autoNum);
          autoNum++;
          this.motes.push({
            id,
            pos: [entry[0], entry[1], entry[2]],
            kind: "random",
            ttl_ticks: null,
            spawned_this_tick: false,
          });
        } else {
          let id = entry.id;
          if (id === undefined) {
            while (usedIds.has(`M${autoNum}`)) autoNum++;
            id = `M${autoNum}`;
            usedIds.add(id);
            maxParsedM = Math.max(maxParsedM, autoNum);
            autoNum++;
          }
          const kind: MoteKind = entry.kind ?? "random";
          const ttlTicks =
            kind === "dropped"
              ? (entry.ttl_ticks ?? SIM_CONSTANTS.dropped_mote_ttl_ticks)
              : null;
          this.motes.push({
            id,
            pos: [entry.pos[0], entry.pos[1], entry.pos[2]],
            kind,
            ttl_ticks: ttlTicks,
            spawned_this_tick: false,
          });
        }
      }
      this.motes.sort((a, b) => compareIds(a.id, b.id));
      this.nextMoteNum = Math.max(maxParsedM, scenario.motes.length) + 1;
    } else if (this.randomMotes) {
      // Partial Fisher-Yates shuffle on ordered moteSpawnPoints (20 distinct points)
      const pts = this.cfg.moteSpawnPoints.slice();
      const count = Math.min(SIM_CONSTANTS.mote_initial_count, pts.length);
      for (let i = 0; i < count; i++) {
        const j = i + Math.floor(this.rng() * (pts.length - i));
        const tmp = pts[i];
        pts[i] = pts[j];
        pts[j] = tmp;
        const p = pts[i];
        this.motes.push({
          id: `M${this.nextMoteNum++}`,
          pos: [p[0], p[1], p[2]],
          kind: "random",
          ttl_ticks: null,
          spawned_this_tick: false,
        });
      }
    }

    // Shades
    if (scenario?.shades !== undefined) {
      let maxParsedS = 0;
      const usedIds = new Set<string>();
      for (const s of scenario.shades) {
        if (s.id !== undefined) {
          usedIds.add(s.id);
          const m = /^S(\d+)$/.exec(s.id);
          if (m) maxParsedS = Math.max(maxParsedS, Number(m[1]));
        }
      }
      let autoNum = 1;
      for (const s of scenario.shades) {
        let id = s.id;
        if (id === undefined) {
          while (usedIds.has(`S${autoNum}`)) autoNum++;
          id = `S${autoNum}`;
          usedIds.add(id);
          maxParsedS = Math.max(maxParsedS, autoNum);
          autoNum++;
        }
        const st: ShadeBehaviorState = s.state ?? "wander";
        const defaultTicks =
          st === "spawning"
            ? SIM_CONSTANTS.shade_spawn_state_ticks
            : st === "stunned"
              ? Math.round(TUNING.pulse_stun_s * SIM_CONSTANTS.tick_rate_hz)
              : st === "recoil"
                ? SIM_CONSTANTS.shade_recoil_ticks
                : 0;
        this.shades.push({
          id,
          pos: [s.pos[0], s.pos[1], s.pos[2]],
          state: st,
          state_ticks_left: s.state_ticks_left ?? defaultTicks,
          pulse_push_ticks_left: 0,
          pulse_push_dir: [1, 0],
          recoil_dir: [1, 0],
          safe_push_ticks_left: 0,
          safe_push_lantern_id: null,
          wander_dir: [1, 0],
          wander_ticks_left: 0,
          spawned_this_tick: false,
        });
      }
      this.shades.sort((a, b) => compareIds(a.id, b.id));
      this.nextShadeNum = Math.max(maxParsedS, scenario.shades.length) + 1;
    }

    // Drifters
    if (scenario?.drifters !== undefined) {
      let maxParsedD = 0;
      const usedIds = new Set<string>();
      for (const d of scenario.drifters) {
        if (d.id !== undefined) {
          usedIds.add(d.id);
          const m = /^D(\d+)$/.exec(d.id);
          if (m) maxParsedD = Math.max(maxParsedD, Number(m[1]));
        }
      }
      let autoNum = 1;
      for (const d of scenario.drifters) {
        let id = d.id;
        if (id === undefined) {
          while (usedIds.has(`D${autoNum}`)) autoNum++;
          id = `D${autoNum}`;
          usedIds.add(id);
          maxParsedD = Math.max(maxParsedD, autoNum);
          autoNum++;
        }
        const st: DrifterBehaviorState = d.state ?? "idle";
        const stolen = d.stolen ?? 0;
        this.drifters.push({
          id,
          pos: [d.pos[0], d.pos[1], d.pos[2]],
          state: st,
          stolen,
          has_stolen: stolen > 0 || st === "flee",
          flee_ticks_left:
            st === "flee" ? (d.flee_ticks_left ?? SIM_CONSTANTS.drifter_flee_ticks) : 0,
          wander_dir: [1, 0],
          wander_ticks_left: 0,
          spawned_this_tick: false,
        });
      }
      this.drifters.sort((a, b) => compareIds(a.id, b.id));
      this.nextDrifterNum = Math.max(maxParsedD, scenario.drifters.length) + 1;
    }

    // Charms
    if (scenario?.charms !== undefined) {
      const usedIds = new Set<string>();
      for (const c of scenario.charms) {
        if (c.id !== undefined) usedIds.add(c.id);
      }
      let autoNum = 1;
      for (const c of scenario.charms) {
        let id = c.id;
        if (id === undefined) {
          while (usedIds.has(`C${autoNum}`)) autoNum++;
          id = `C${autoNum}`;
          usedIds.add(id);
          autoNum++;
        }
        const available = c.available ?? true;
        this.charms.push({
          id,
          pos: [c.pos[0], c.pos[1], c.pos[2]],
          available,
          respawn_ticks: available
            ? 0
            : (c.respawn_ticks ?? SIM_CONSTANTS.charm_respawn_ticks),
        });
      }
      this.charms.sort((a, b) => compareIds(a.id, b.id));
    } else {
      this.charms = this.cfg.charms.map((c) => ({
        id: c.id,
        pos: [c.pos[0], c.pos[1], c.pos[2]],
        available: true,
        respawn_ticks: 0,
      }));
    }
  }

  public step(input: StepInput = {}): void {
    if (this.state === "won" || this.state === "lost") {
      return;
    }

    const dt = SIM_CONSTANTS.dt;

    // 1. Read Input & Pause Handling
    const nextTick = this.tick + 1;

    if (input.move !== undefined) {
      this.heldInput.move = [input.move[0], input.move[1]];
    }
    if (input.cam_yaw_deg !== undefined) {
      this.heldInput.cam_yaw_deg = input.cam_yaw_deg;
    }

    const nextJump = input.jump !== undefined ? input.jump : this.heldInput.jump;
    const nextInteract = input.interact !== undefined ? input.interact : this.heldInput.interact;
    const nextPulse = input.pulse !== undefined ? input.pulse : this.heldInput.pulse;
    const nextDash = input.dash !== undefined ? input.dash : this.heldInput.dash;
    const nextPause = input.pause !== undefined ? input.pause : this.heldInput.pause;

    const jumpPressed = !this.heldInput.jump && nextJump;
    const interactPressed = !this.heldInput.interact && nextInteract;
    const pulsePressed = !this.heldInput.pulse && nextPulse;
    const dashPressed = !this.heldInput.dash && nextDash;
    const pausePressed = !this.heldInput.pause && nextPause;

    this.heldInput.jump = nextJump;
    this.heldInput.interact = nextInteract;
    this.heldInput.pulse = nextPulse;
    this.heldInput.dash = nextDash;
    this.heldInput.pause = nextPause;

    if (this.state === "playing" && pausePressed) {
      this.state = "paused";
      this.tick = nextTick;
      this.eventQueue.push({ type: "event", tick: nextTick, name: "paused", data: {} });
      return;
    }
    if (this.state === "paused" && !pausePressed) {
      this.tick = nextTick;
      return;
    }
    if (this.state === "paused" && pausePressed) {
      this.state = "playing";
      this.eventQueue.push({ type: "event", tick: nextTick, name: "resumed", data: {} });
    }

    this.tick = nextTick;
    this.simTick += 1;

    if (this.simTick === 1) {
      this.eventQueue.push({
        type: "event",
        tick: nextTick,
        name: "night_start",
        data: { night: this.night },
      });
    }

    // 2. Decrement Counters
    for (const m of this.motes) m.spawned_this_tick = false;
    for (const s of this.shades) s.spawned_this_tick = false;
    for (const d of this.drifters) d.spawned_this_tick = false;

    this.remainingTicks = Math.max(0, this.remainingTicks - 1);
    this.timeLeftS = this.remainingTicks / SIM_CONSTANTS.tick_rate_hz;

    if (this.pulseCdTicks > 0) this.pulseCdTicks -= 1;
    if (this.dashCdTicks > 0) this.dashCdTicks -= 1;
    if (this.invulnTicks > 0) this.invulnTicks -= 1;
    if (this.charmTicks > 0) this.charmTicks -= 1;

    if (this.fallRespawnTicks > 0) {
      this.fallRespawnTicks -= 1;
      if (this.fallRespawnTicks === 0) {
        this.playerPos = [
          this.cfg.playerStart[0],
          this.cfg.playerStart[1],
          this.cfg.playerStart[2],
        ];
        this.playerVel = [0, 0, 0];
        this.grounded = true;
        this.facing = [0, 1];
        this.invulnTicks = Math.round(TUNING.invuln_s * SIM_CONSTANTS.tick_rate_hz);
      }
    }

    for (const shade of this.shades) {
      if (shade.state_ticks_left > 0) {
        shade.state_ticks_left -= 1;
        if (
          shade.state_ticks_left === 0 &&
          (shade.state === "spawning" || shade.state === "stunned" || shade.state === "recoil")
        ) {
          shade.state = "wander";
        }
      }
      if (shade.safe_push_ticks_left > 0) {
        shade.safe_push_ticks_left -= 1;
      }
    }

    if (this.drifters.length > 0) {
      const keptDrifters: InternalDrifter[] = [];
      for (const drifter of this.drifters) {
        if (drifter.state === "flee") {
          drifter.flee_ticks_left -= 1;
          if (drifter.flee_ticks_left <= 0) continue;
        }
        keptDrifters.push(drifter);
      }
      this.drifters = keptDrifters;
    }

    if (this.motes.length > 0) {
      const keptMotes: InternalMote[] = [];
      for (const mote of this.motes) {
        if (mote.kind === "dropped" && mote.ttl_ticks !== null) {
          mote.ttl_ticks -= 1;
          if (mote.ttl_ticks <= 0) continue;
        }
        keptMotes.push(mote);
      }
      this.motes = keptMotes;
    }

    for (const charm of this.charms) {
      if (!charm.available) {
        if (charm.respawn_ticks > 0) charm.respawn_ticks -= 1;
        if (charm.respawn_ticks <= 0) {
          charm.available = true;
          charm.respawn_ticks = 0;
        }
      }
    }

    // Wind schedule
    if (this.windEnabled) {
      const phase = this.simTick % SIM_CONSTANTS.wind_cycle_ticks;
      const warnStart = SIM_CONSTANTS.wind_cycle_ticks - SIM_CONSTANTS.wind_warn_ticks; // 1680
      if (this.simTick >= warnStart && phase === warnStart) {
        this.nextWindDirDeg = this.rng() * 360;
      }
      if (this.simTick >= SIM_CONSTANTS.wind_cycle_ticks && phase === 0) {
        this.currentWindDirDeg = this.nextWindDirDeg;
      }
      if (
        this.simTick >= SIM_CONSTANTS.wind_cycle_ticks &&
        phase < SIM_CONSTANTS.wind_gust_ticks
      ) {
        this.wind = { active: true, dir_deg: this.currentWindDirDeg };
      } else {
        this.wind = {
          active: false,
          dir_deg: this.simTick >= warnStart && phase >= warnStart ? this.nextWindDirDeg : 0,
        };
      }
    } else {
      this.wind = { active: false, dir_deg: 0 };
    }

    // 3. Move May (Jump, Dash, Jump Pads, Wind) & Fall Check
    if (this.fallRespawnTicks > 0) {
      this.playerVel = [0, 0, 0];
      this.grounded = false;
    } else {
      let mx = clamp(this.heldInput.move[0], -1, 1);
      let mz = clamp(this.heldInput.move[1], -1, 1);
      const mLen = Math.hypot(mx, mz);
      if (mLen > 1) {
        mx /= mLen;
        mz /= mLen;
      }

      const theta = (this.heldInput.cam_yaw_deg * Math.PI) / 180;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const wx = mx * cosT + mz * sinT;
      const wz = -mx * sinT + mz * cosT;
      const wLen = Math.hypot(wx, wz);
      if (wLen > 1e-6) {
        this.facing = [wx / wLen, wz / wLen];
      }

      // 3.2 Dash activation
      if (
        dashPressed &&
        this.dashTicksLeft === 0 &&
        (this.dashCdTicks === 0 || this.charmTicks > 0)
      ) {
        this.dashDir =
          wLen > 1e-6 ? [wx / wLen, wz / wLen] : [this.facing[0], this.facing[1]];
        this.dashTicksLeft = Math.round(TUNING.dash_duration_s * SIM_CONSTANTS.tick_rate_hz);
        this.dashCdTicks =
          this.charmTicks > 0
            ? 0
            : Math.round(TUNING.dash_cooldown_s * SIM_CONSTANTS.tick_rate_hz);
        this.launchLocked = false;
        this.eventQueue.push({ type: "event", tick: nextTick, name: "dash", data: {} });
      }

      // 3.3 Horizontal velocity
      const maxSpeed =
        this.charmTicks > 0 ? SIM_CONSTANTS.charm_speed_m_s : TUNING.player_speed;
      if (this.dashTicksLeft > 0) {
        this.playerVel[0] = this.dashDir[0] * TUNING.dash_speed;
        this.playerVel[2] = this.dashDir[1] * TUNING.dash_speed;
      } else if (!this.launchLocked) {
        const targetVx = wx * maxSpeed;
        const targetVz = wz * maxSpeed;
        const dvx = targetVx - this.playerVel[0];
        const dvz = targetVz - this.playerVel[2];
        const dvLen = Math.hypot(dvx, dvz);
        const maxDv = (maxSpeed / SIM_CONSTANTS.accel_time_s) * dt;
        if (dvLen <= maxDv) {
          this.playerVel[0] = targetVx;
          this.playerVel[2] = targetVz;
        } else {
          this.playerVel[0] += (dvx / dvLen) * maxDv;
          this.playerVel[2] += (dvz / dvLen) * maxDv;
        }
      }

      // 3.4 Jump
      if (jumpPressed && this.grounded && this.dashTicksLeft === 0 && !this.launchLocked) {
        this.playerVel[1] = SIM_CONSTANTS.jump_velocity;
        this.grounded = false;
      }

      // 3.5 Jump Pads
      if (!this.launchLocked && this.cfg.jumpPads.length > 0) {
        for (const pad of this.cfg.jumpPads) {
          if (
            distXZ(this.playerPos, pad.pos) <= pad.radius &&
            Math.abs(this.playerPos[1] - pad.pos[1]) <= SIM_CONSTANTS.jump_pad_y_tolerance_m &&
            (this.grounded || this.playerVel[1] <= 0)
          ) {
            this.dashTicksLeft = 0;
            this.playerVel[0] = pad.dir[0] * pad.launch_vh;
            this.playerVel[2] = pad.dir[1] * pad.launch_vh;
            this.playerVel[1] = pad.launch_vy;
            this.launchLocked = true;
            this.grounded = false;
            break;
          }
        }
      }

      // 3.6 Wind displacement
      let windDx = 0;
      let windDz = 0;
      if (this.wind.active && !this.launchLocked) {
        const rad = (this.wind.dir_deg * Math.PI) / 180;
        windDx = Math.cos(rad) * SIM_CONSTANTS.wind_push_speed_m_s * dt;
        windDz = Math.sin(rad) * SIM_CONSTANTS.wind_push_speed_m_s * dt;
      }

      // 3.7 Horizontal integration & collision
      const candX = this.playerPos[0] + this.playerVel[0] * dt + windDx;
      const candZ = this.playerPos[2] + this.playerVel[2] * dt + windDz;
      const [nx, nz] = resolvePlayerHorizontal(
        this.night,
        this.playerPos[0],
        this.playerPos[2],
        this.playerPos[1],
        candX,
        candZ,
      );
      this.playerPos[0] = nx;
      this.playerPos[2] = nz;

      // 3.8 Vertical integration & grounded resolution
      const prevY = this.playerPos[1];
      if (this.dashTicksLeft > 0 && !this.grounded) {
        this.playerVel[1] = 0;
      } else {
        this.playerVel[1] -= SIM_CONSTANTS.gravity * dt;
        this.playerPos[1] += this.playerVel[1] * dt;
      }

      const h = getGroundHeight(this.night, this.playerPos[0], this.playerPos[2]);
      if (h !== null && this.playerPos[1] <= h && prevY >= h - SIM_CONSTANTS.max_step_up_m) {
        this.playerPos[1] = h;
        this.playerVel[1] = 0;
        this.grounded = true;
        this.launchLocked = false;
      } else if (
        h !== null &&
        this.grounded &&
        this.playerPos[1] > h &&
        this.playerPos[1] - h <= SIM_CONSTANTS.ramp_snap_down_m
      ) {
        this.playerPos[1] = h;
        this.playerVel[1] = 0;
        this.grounded = true;
      } else {
        this.grounded = false;
      }

      // 3.9 Dash tick decrement
      if (this.dashTicksLeft > 0) {
        this.dashTicksLeft -= 1;
        if (this.dashTicksLeft === 0) {
          const spd = Math.hypot(this.playerVel[0], this.playerVel[2]);
          if (spd > maxSpeed) {
            const scale = maxSpeed / spd;
            this.playerVel[0] *= scale;
            this.playerVel[2] *= scale;
          }
        }
      }

      // 3.10 Fall check
      if (this.playerPos[1] < SIM_CONSTANTS.fall_y_threshold) {
        this.flames = Math.max(0, this.flames - 1);
        const lost = this.carried;
        this.carried = 0;
        this.eventQueue.push({
          type: "event",
          tick: nextTick,
          name: "player_hit",
          data: { by: "fall", flames: this.flames, dropped: 0, lost },
        });
        if (this.flames > 0) {
          this.fallRespawnTicks = SIM_CONSTANTS.fall_respawn_wait_ticks;
          this.playerVel = [0, 0, 0];
          this.grounded = false;
          this.dashTicksLeft = 0;
          this.launchLocked = false;
        }
      }
    }

    // 4. Pick Up Motes and Charms
    if (this.fallRespawnTicks === 0) {
      if (this.carried < TUNING.carry_capacity && this.motes.length > 0) {
        const remaining: InternalMote[] = [];
        for (const mote of this.motes) {
          if (
            !mote.spawned_this_tick &&
            this.carried < TUNING.carry_capacity &&
            distXZ(this.playerPos, mote.pos) <= TUNING.pickup_radius &&
            Math.abs(this.playerPos[1] - mote.pos[1]) <= SIM_CONSTANTS.pickup_height_diff_m
          ) {
            this.carried += 1;
            this.eventQueue.push({
              type: "event",
              tick: nextTick,
              name: "mote_picked",
              data: { carried: this.carried },
            });
          } else {
            remaining.push(mote);
          }
        }
        this.motes = remaining;
      }

      for (const charm of this.charms) {
        if (
          charm.available &&
          distXZ(this.playerPos, charm.pos) <= TUNING.pickup_radius &&
          Math.abs(this.playerPos[1] - charm.pos[1]) <= SIM_CONSTANTS.pickup_height_diff_m
        ) {
          charm.available = false;
          charm.respawn_ticks = SIM_CONSTANTS.charm_respawn_ticks;
          this.charmTicks = SIM_CONSTANTS.charm_duration_ticks;
          this.dashCdTicks = 0;
          this.eventQueue.push({
            type: "event",
            tick: nextTick,
            name: "charm_picked",
            data: { charm_id: charm.id, charm_ticks: SIM_CONSTANTS.charm_duration_ticks },
          });
        }
      }
    }

    // 5. Interact with Lanterns
    if (this.fallRespawnTicks === 0 && interactPressed && this.carried > 0) {
      let bestLantern: LanternState | null = null;
      let bestDist = Infinity;
      for (const lantern of this.lanterns) {
        if (lantern.lit) continue;
        const d = distXZ(this.playerPos, lantern.pos);
        if (d <= TUNING.interact_radius) {
          if (
            bestLantern === null ||
            d < bestDist ||
            (d === bestDist && compareIds(lantern.id, bestLantern.id) < 0)
          ) {
            bestLantern = lantern;
            bestDist = d;
          }
        }
      }
      if (bestLantern !== null) {
        const needed = Math.max(0, TUNING.lantern_cost - bestLantern.deposited);
        const amount = Math.min(this.carried, needed);
        if (amount > 0) {
          this.carried -= amount;
          bestLantern.deposited += amount;
          this.score += amount * TUNING.score.per_mote;
          this.eventQueue.push({
            type: "event",
            tick: nextTick,
            name: "deposit",
            data: {
              lantern_id: bestLantern.id,
              amount,
              deposited: bestLantern.deposited,
            },
          });
          if (bestLantern.deposited >= TUNING.lantern_cost) {
            bestLantern.lit = true;
            this.score += TUNING.score.per_lantern;
            this.eventQueue.push({
              type: "event",
              tick: nextTick,
              name: "lantern_lit",
              data: { lantern_id: bestLantern.id },
            });
            for (const shade of this.shades) {
              if (distXZ(shade.pos, bestLantern.pos) < TUNING.safe_radius) {
                shade.safe_push_ticks_left = SIM_CONSTANTS.safe_zone_push_max_ticks;
                shade.safe_push_lantern_id = bestLantern.id;
              }
            }
          }
        }
      }
    }

    // 6. Update Safe Zones
    const litLanterns = this.lanterns.filter((l) => l.lit);
    for (const shade of this.shades) {
      if (shade.safe_push_ticks_left <= 0) continue;

      let l = litLanterns.find((lt) => lt.id === shade.safe_push_lantern_id) ?? null;
      if (!l) {
        let bestD = Infinity;
        for (const lt of litLanterns) {
          const d = distXZ(shade.pos, lt.pos);
          if (d < TUNING.safe_radius && d < bestD) {
            bestD = d;
            l = lt;
          }
        }
      }
      if (!l) {
        shade.safe_push_ticks_left = 0;
        shade.safe_push_lantern_id = null;
        continue;
      }

      const d = distXZ(shade.pos, l.pos);
      if (d >= TUNING.safe_radius) {
        shade.safe_push_ticks_left = 0;
        shade.safe_push_lantern_id = null;
        continue;
      }

      const [dirX, dirZ] = normalizeXZ(shade.pos[0] - l.pos[0], shade.pos[2] - l.pos[2]);
      const pushDist = Math.max(
        this.cfg.shade_speed * dt,
        (TUNING.safe_radius + SIM_CONSTANTS.safe_zone_push_epsilon - d) /
          shade.safe_push_ticks_left,
      );
      const prevGroundY =
        getGroundHeight(this.night, shade.pos[0], shade.pos[2]) ??
        shade.pos[1] - SIM_CONSTANTS.shade_center_y_offset_m;
      const candX = shade.pos[0] + dirX * pushDist;
      const candZ = shade.pos[2] + dirZ * pushDist;
      const check = isShadeBlocked(this.night, prevGroundY, candX, candZ);
      if (!check.blocked) {
        shade.pos[0] = candX;
        shade.pos[2] = candZ;
        shade.pos[1] = check.groundY + SIM_CONSTANTS.shade_center_y_offset_m;
      }
      if (distXZ(shade.pos, l.pos) >= TUNING.safe_radius) {
        shade.safe_push_ticks_left = 0;
        shade.safe_push_lantern_id = null;
      }
    }

    // 7. Pulse (Toa Sang)
    if (
      this.fallRespawnTicks === 0 &&
      pulsePressed &&
      this.carried >= TUNING.pulse_cost &&
      this.pulseCdTicks === 0
    ) {
      this.carried -= TUNING.pulse_cost;
      this.pulseCdTicks = Math.round(TUNING.pulse_cooldown_s * SIM_CONSTANTS.tick_rate_hz);
      const stunDurationTicks = Math.round(TUNING.pulse_stun_s * SIM_CONSTANTS.tick_rate_hz);
      const origin: Vec3 = [
        this.playerPos[0],
        this.playerPos[1] + SIM_CONSTANTS.pulse_origin_y_offset_m,
        this.playerPos[2],
      ];

      const stunnedIds: string[] = [];
      for (const shade of this.shades) {
        if (dist3D(origin, shade.pos) <= TUNING.pulse_radius) {
          shade.state = "stunned";
          shade.state_ticks_left = stunDurationTicks;
          shade.pulse_push_ticks_left = SIM_CONSTANTS.pulse_push_ticks;
          shade.pulse_push_dir = normalizeXZ(
            shade.pos[0] - this.playerPos[0],
            shade.pos[2] - this.playerPos[2],
          );
          stunnedIds.push(shade.id);
        }
      }

      this.score += TUNING.score.per_stun * stunnedIds.length;
      this.eventQueue.push({
        type: "event",
        tick: nextTick,
        name: "pulse",
        data: { stunned_ids: stunnedIds },
      });

      for (const drifter of this.drifters) {
        if (dist3D(origin, drifter.pos) <= TUNING.pulse_radius) {
          if (drifter.state === "chase") {
            drifter.state = "flee";
            drifter.flee_ticks_left = SIM_CONSTANTS.drifter_flee_ticks;
          } else if (drifter.state === "flee" && drifter.stolen > 0) {
            const amount = drifter.stolen;
            const gy = getGroundHeight(this.night, drifter.pos[0], drifter.pos[2]) ?? 0;
            for (let i = 0; i < amount; i++) {
              this.motes.push({
                id: `M${this.nextMoteNum++}`,
                pos: [drifter.pos[0], gy, drifter.pos[2]],
                kind: "dropped",
                ttl_ticks: SIM_CONSTANTS.dropped_mote_ttl_ticks,
                spawned_this_tick: true,
              });
            }
            this.eventQueue.push({
              type: "event",
              tick: nextTick,
              name: "drifter_drop",
              data: { drifter_id: drifter.id, amount },
            });
            drifter.stolen = 0;
            drifter.flee_ticks_left = SIM_CONSTANTS.drifter_drop_vanish_ticks;
          }
        }
      }
    }

    // 8. Move Shades and Drifters
    const shadeSpeed = this.cfg.shade_speed;
    for (const shade of this.shades) {
      if (shade.state === "spawning") continue;

      const prevGroundY =
        getGroundHeight(this.night, shade.pos[0], shade.pos[2]) ??
        shade.pos[1] - SIM_CONSTANTS.shade_center_y_offset_m;

      if (shade.state === "stunned") {
        if (shade.pulse_push_ticks_left > 0) {
          const pushStep = TUNING.pulse_push_m / SIM_CONSTANTS.pulse_push_ticks;
          const candX = shade.pos[0] + shade.pulse_push_dir[0] * pushStep;
          const candZ = shade.pos[2] + shade.pulse_push_dir[1] * pushStep;
          const check = isShadeBlocked(this.night, prevGroundY, candX, candZ);
          if (check.blocked) {
            shade.pulse_push_ticks_left = 0;
          } else {
            shade.pos[0] = candX;
            shade.pos[2] = candZ;
            shade.pos[1] = check.groundY + SIM_CONSTANTS.shade_center_y_offset_m;
            shade.pulse_push_ticks_left -= 1;
          }
        }
        continue;
      }

      if (shade.state === "recoil") {
        const recoilStep = SIM_CONSTANTS.shade_recoil_dist_m / SIM_CONSTANTS.shade_recoil_ticks;
        const candX = shade.pos[0] + shade.recoil_dir[0] * recoilStep;
        const candZ = shade.pos[2] + shade.recoil_dir[1] * recoilStep;
        this.applyShadeMove(shade, prevGroundY, candX, candZ, litLanterns);
        continue;
      }

      if (shade.safe_push_ticks_left > 0) {
        continue;
      }

      // wander <-> chase transitions
      if (shade.state === "wander") {
        if (
          this.fallRespawnTicks === 0 &&
          distXZ(shade.pos, this.playerPos) <= SIM_CONSTANTS.shade_detect_radius_m
        ) {
          shade.state = "chase";
        }
      } else if (shade.state === "chase") {
        if (
          this.fallRespawnTicks > 0 ||
          distXZ(shade.pos, this.playerPos) > SIM_CONSTANTS.shade_lose_radius_m
        ) {
          shade.state = "wander";
        }
      }

      if (shade.state === "wander") {
        if (shade.wander_ticks_left <= 0) {
          const angle = this.rng() * 2 * Math.PI;
          shade.wander_dir = [Math.cos(angle), Math.sin(angle)];
          shade.wander_ticks_left = 60 + Math.floor(this.rng() * 120);
        }
        shade.wander_ticks_left -= 1;
        const stepDist = 0.5 * shadeSpeed * dt;
        const candX = shade.pos[0] + shade.wander_dir[0] * stepDist;
        const candZ = shade.pos[2] + shade.wander_dir[1] * stepDist;
        const blocked = this.applyShadeMove(shade, prevGroundY, candX, candZ, litLanterns);
        if (blocked) {
          shade.wander_ticks_left = 0;
        }
      } else {
        // chase
        const dx = this.playerPos[0] - shade.pos[0];
        const dz = this.playerPos[2] - shade.pos[2];
        const d = Math.hypot(dx, dz);
        let candX = shade.pos[0];
        let candZ = shade.pos[2];
        if (d > 0) {
          const moveDist = Math.min(d, shadeSpeed * dt);
          candX += (dx / d) * moveDist;
          candZ += (dz / d) * moveDist;
        }
        this.applyShadeMove(shade, prevGroundY, candX, candZ, litLanterns);
      }
    }

    // Move Drifters
    for (const drifter of this.drifters) {
      if (drifter.state === "idle") {
        if (
          this.fallRespawnTicks === 0 &&
          !drifter.has_stolen &&
          this.carried >= SIM_CONSTANTS.drifter_aggro_motes &&
          distXZ(drifter.pos, this.playerPos) <= SIM_CONSTANTS.drifter_aggro_radius_m
        ) {
          drifter.state = "chase";
        }
      } else if (drifter.state === "chase") {
        if (
          this.fallRespawnTicks > 0 ||
          this.carried < SIM_CONSTANTS.drifter_aggro_motes ||
          distXZ(drifter.pos, this.playerPos) > SIM_CONSTANTS.drifter_aggro_radius_m
        ) {
          drifter.state = "idle";
        }
      }

      if (drifter.state === "idle") {
        if (drifter.wander_ticks_left <= 0) {
          const angle = this.rng() * 2 * Math.PI;
          drifter.wander_dir = [Math.cos(angle), Math.sin(angle)];
          drifter.wander_ticks_left = 60 + Math.floor(this.rng() * 120);
        }
        drifter.wander_ticks_left -= 1;
        const stepDist = SIM_CONSTANTS.drifter_speed_idle * dt;
        const candX = drifter.pos[0] + drifter.wander_dir[0] * stepDist;
        const candZ = drifter.pos[2] + drifter.wander_dir[1] * stepDist;
        const h = getGroundHeight(this.night, candX, candZ);
        if (h === null) {
          drifter.wander_ticks_left = 0;
        } else {
          drifter.pos[0] = candX;
          drifter.pos[2] = candZ;
          drifter.pos[1] = h + SIM_CONSTANTS.drifter_center_y_offset_m;
        }
      } else if (drifter.state === "chase") {
        const dx = this.playerPos[0] - drifter.pos[0];
        const dz = this.playerPos[2] - drifter.pos[2];
        const d = Math.hypot(dx, dz);
        if (d > 0) {
          const moveDist = Math.min(d, SIM_CONSTANTS.drifter_speed_chase * dt);
          drifter.pos[0] += (dx / d) * moveDist;
          drifter.pos[2] += (dz / d) * moveDist;
        }
        const h = getGroundHeight(this.night, drifter.pos[0], drifter.pos[2]);
        drifter.pos[1] = (h ?? this.playerPos[1]) + SIM_CONSTANTS.drifter_center_y_offset_m;
      } else {
        // flee
        const [dirX, dirZ] = normalizeXZ(
          drifter.pos[0] - this.playerPos[0],
          drifter.pos[2] - this.playerPos[2],
        );
        const moveDist = SIM_CONSTANTS.drifter_speed_chase * dt;
        drifter.pos[0] += dirX * moveDist;
        drifter.pos[2] += dirZ * moveDist;
        const h = getGroundHeight(this.night, drifter.pos[0], drifter.pos[2]);
        drifter.pos[1] = (h ?? 0) + SIM_CONSTANTS.drifter_center_y_offset_m;
      }
    }

    // 9. Contacts (Drifter first, then Shades ascending id)
    if (this.fallRespawnTicks === 0) {
      for (const drifter of this.drifters) {
        if (
          drifter.state === "chase" &&
          !drifter.has_stolen &&
          !drifter.spawned_this_tick &&
          distXZ(drifter.pos, this.playerPos) <= SIM_CONSTANTS.drifter_touch_radius_m
        ) {
          const amount = Math.min(SIM_CONSTANTS.drifter_steal_max, this.carried);
          this.carried -= amount;
          drifter.stolen = amount;
          drifter.has_stolen = true;
          drifter.state = "flee";
          drifter.flee_ticks_left = SIM_CONSTANTS.drifter_flee_ticks;
          this.eventQueue.push({
            type: "event",
            tick: nextTick,
            name: "drifter_steal",
            data: { drifter_id: drifter.id, amount, carried: this.carried },
          });
        }
      }

      if (this.invulnTicks === 0) {
        for (const shade of this.shades) {
          if (
            (shade.state === "wander" || shade.state === "chase") &&
            shade.safe_push_ticks_left === 0 &&
            !shade.spawned_this_tick &&
            distXZ(this.playerPos, shade.pos) <= TUNING.shade_hit_radius &&
            Math.abs(this.playerPos[1] - shade.pos[1]) <= SIM_CONSTANTS.shade_hit_height_diff_m
          ) {
            this.flames = Math.max(0, this.flames - 1);
            const dropped = Math.floor(this.carried * TUNING.hit_drop_ratio);
            this.carried -= dropped;

            for (let i = 0; i < dropped; i++) {
              const angle = this.rng() * 2 * Math.PI;
              const r =
                SIM_CONSTANTS.dropped_mote_ring_min_m +
                this.rng() *
                  (SIM_CONSTANTS.dropped_mote_ring_max_m -
                    SIM_CONSTANTS.dropped_mote_ring_min_m);
              const mx = this.playerPos[0] + r * Math.cos(angle);
              const mz = this.playerPos[2] + r * Math.sin(angle);
              const mh = getGroundHeight(this.night, mx, mz);
              const mPos: Vec3 =
                mh !== null
                  ? [mx, mh, mz]
                  : [this.playerPos[0], this.playerPos[1], this.playerPos[2]];
              this.motes.push({
                id: `M${this.nextMoteNum++}`,
                pos: mPos,
                kind: "dropped",
                ttl_ticks: SIM_CONSTANTS.dropped_mote_ttl_ticks,
                spawned_this_tick: true,
              });
            }

            this.invulnTicks = Math.round(TUNING.invuln_s * SIM_CONSTANTS.tick_rate_hz);
            shade.state = "recoil";
            shade.state_ticks_left = SIM_CONSTANTS.shade_recoil_ticks;
            shade.recoil_dir = normalizeXZ(
              shade.pos[0] - this.playerPos[0],
              shade.pos[2] - this.playerPos[2],
            );

            this.eventQueue.push({
              type: "event",
              tick: nextTick,
              name: "player_hit",
              data: { by: "shade", flames: this.flames, dropped },
            });
            break;
          }
        }
      }
    }

    // 10. Spawn Motes, Shades, Drifters by Schedule
    if (
      this.randomMotes &&
      this.simTick > 0 &&
      this.simTick % SIM_CONSTANTS.mote_spawn_interval_ticks === 0 &&
      this.motes.length < SIM_CONSTANTS.mote_cap
    ) {
      const free: Vec3[] = [];
      for (const pt of this.cfg.moteSpawnPoints) {
        let occupied = false;
        for (const m of this.motes) {
          if (distXZ(pt, m.pos) <= SIM_CONSTANTS.mote_free_point_radius_m) {
            occupied = true;
            break;
          }
        }
        if (!occupied) free.push(pt);
      }
      if (free.length > 0) {
        const chosen = free[Math.floor(this.rng() * free.length)];
        this.motes.push({
          id: `M${this.nextMoteNum++}`,
          pos: [chosen[0], chosen[1], chosen[2]],
          kind: "random",
          ttl_ticks: null,
          spawned_this_tick: true,
        });
      }
    }

    if (this.randomShades) {
      let toSpawn = 0;
      if (this.simTick === SIM_CONSTANTS.shade_first_spawn_tick) {
        toSpawn = 2;
      } else if (
        this.simTick > SIM_CONSTANTS.shade_first_spawn_tick &&
        (this.simTick - SIM_CONSTANTS.shade_first_spawn_tick) %
          this.cfg.shade_spawn_interval_ticks ===
          0
      ) {
        toSpawn = 1;
      }
      for (let i = 0; i < toSpawn && this.shades.length < this.cfg.shade_cap; i++) {
        const valid: Vec3[] = [];
        for (const pt of this.cfg.shadeSpawnPoints) {
          if (distXZ(pt, this.playerPos) < SIM_CONSTANTS.shade_min_player_dist_m) continue;
          let inSafe = false;
          for (const l of litLanterns) {
            if (distXZ(pt, l.pos) < TUNING.safe_radius) {
              inSafe = true;
              break;
            }
          }
          if (!inSafe) valid.push(pt);
        }
        if (valid.length === 0) break;
        const chosen = valid[Math.floor(this.rng() * valid.length)];
        const id = `S${this.nextShadeNum++}`;
        this.shades.push({
          id,
          pos: [chosen[0], chosen[1] + SIM_CONSTANTS.shade_center_y_offset_m, chosen[2]],
          state: "spawning",
          state_ticks_left: SIM_CONSTANTS.shade_spawn_state_ticks,
          pulse_push_ticks_left: 0,
          pulse_push_dir: [1, 0],
          recoil_dir: [1, 0],
          safe_push_ticks_left: 0,
          safe_push_lantern_id: null,
          wander_dir: [1, 0],
          wander_ticks_left: 0,
          spawned_this_tick: true,
        });
        this.shades.sort((a, b) => compareIds(a.id, b.id));
        this.eventQueue.push({
          type: "event",
          tick: nextTick,
          name: "shade_spawned",
          data: { id },
        });
      }
    }

    if (
      this.randomDrifters &&
      this.simTick > 0 &&
      this.simTick % SIM_CONSTANTS.drifter_spawn_interval_ticks === 0 &&
      this.drifters.length < SIM_CONSTANTS.drifter_cap
    ) {
      const pts = this.cfg.shadeSpawnPoints;
      if (pts.length > 0) {
        const chosen = pts[Math.floor(this.rng() * pts.length)];
        const id = `D${this.nextDrifterNum++}`;
        this.drifters.push({
          id,
          pos: [chosen[0], chosen[1] + SIM_CONSTANTS.drifter_center_y_offset_m, chosen[2]],
          state: "idle",
          stolen: 0,
          has_stolen: false,
          flee_ticks_left: 0,
          wander_dir: [1, 0],
          wander_ticks_left: 0,
          spawned_this_tick: true,
        });
        this.drifters.sort((a, b) => compareIds(a.id, b.id));
      }
    }

    // 11. Win / Lose Check (priority: no_flames > all_lit > dawn)
    if (this.flames <= 0) {
      this.state = "lost";
      this.eventQueue.push({
        type: "event",
        tick: nextTick,
        name: "game_over",
        data: { result: "lost", reason: "no_flames" },
      });
    } else if (this.lanterns.every((l) => l.lit)) {
      this.score +=
        Math.floor(this.timeLeftS) * TUNING.score.per_second_left +
        this.flames * TUNING.score.per_flame_left;
      this.state = "won";
      this.eventQueue.push({
        type: "event",
        tick: nextTick,
        name: "game_over",
        data: { result: "won", reason: "all_lit" },
      });
    } else if (this.remainingTicks <= 0) {
      this.timeLeftS = 0;
      this.state = "lost";
      this.eventQueue.push({
        type: "event",
        tick: nextTick,
        name: "game_over",
        data: { result: "lost", reason: "dawn" },
      });
    }
  }

  private applyShadeMove(
    shade: InternalShade,
    prevGroundY: number,
    candX: number,
    candZ: number,
    litLanterns: LanternState[],
  ): boolean {
    let blocked = false;
    let nx = candX;
    let nz = candZ;
    let groundY = prevGroundY;

    const check = isShadeBlocked(this.night, prevGroundY, nx, nz);
    if (check.blocked) {
      blocked = true;
      nx = shade.pos[0];
      nz = shade.pos[2];
    } else {
      groundY = check.groundY;
    }

    // Safe-zone exclusion (2 passes over lit lanterns in ascending id order)
    if (shade.safe_push_ticks_left === 0 && litLanterns.length > 0) {
      for (let pass = 0; pass < SIM_CONSTANTS.safe_zone_passes; pass++) {
        for (const l of litLanterns) {
          const ldx = nx - l.pos[0];
          const ldz = nz - l.pos[2];
          const ld = Math.hypot(ldx, ldz);
          if (ld < TUNING.safe_radius) {
            blocked = true;
            const pushR = TUNING.safe_radius + SIM_CONSTANTS.safe_zone_push_epsilon;
            const [dirX, dirZ] = normalizeXZ(ldx, ldz);
            const px = l.pos[0] + dirX * pushR;
            const pz = l.pos[2] + dirZ * pushR;
            const pCheck = isShadeBlocked(this.night, groundY, px, pz);
            if (!pCheck.blocked) {
              nx = px;
              nz = pz;
              groundY = pCheck.groundY;
            }
          }
        }
      }
    }

    shade.pos[0] = nx;
    shade.pos[2] = nz;
    shade.pos[1] = groundY + SIM_CONSTANTS.shade_center_y_offset_m;
    return blocked;
  }

  public getState(): SimSnapshot {
    const player: PlayerState = {
      pos: [this.playerPos[0], this.playerPos[1], this.playerPos[2]],
      vel: [this.playerVel[0], this.playerVel[1], this.playerVel[2]],
      grounded: this.grounded,
      flames: this.flames,
      carried: this.carried,
      invuln: this.invulnTicks > 0,
      dash_cd_s: this.dashCdTicks / SIM_CONSTANTS.tick_rate_hz,
      pulse_cd_s: this.pulseCdTicks / SIM_CONSTANTS.tick_rate_hz,
      charm_s: this.charmTicks / SIM_CONSTANTS.tick_rate_hz,
    };

    const lanterns: LanternState[] = this.lanterns.map((l) => ({
      id: l.id,
      pos: [l.pos[0], l.pos[1], l.pos[2]],
      lit: l.lit,
      deposited: l.deposited,
    }));

    const shades: ShadeState[] = this.shades.map((s) => ({
      id: s.id,
      pos: [s.pos[0], s.pos[1], s.pos[2]],
      state: s.state,
    }));

    const motes: MoteState[] = this.motes.map((m) => ({
      id: m.id,
      pos: [m.pos[0], m.pos[1], m.pos[2]],
      kind: m.kind,
      ttl_s: m.ttl_ticks === null ? null : m.ttl_ticks / SIM_CONSTANTS.tick_rate_hz,
    }));

    const drifters: DrifterState[] = this.drifters.map((d) => ({
      id: d.id,
      pos: [d.pos[0], d.pos[1], d.pos[2]],
      state: d.state,
      stolen: d.stolen,
    }));

    const charms: CharmState[] = this.charms.map((c) => ({
      id: c.id,
      pos: [c.pos[0], c.pos[1], c.pos[2]],
      available: c.available,
      respawn_s: c.respawn_ticks / SIM_CONSTANTS.tick_rate_hz,
    }));

    return {
      type: "snapshot",
      tick: this.tick,
      sim_tick: this.simTick,
      night: this.night,
      state: this.state,
      time_left_s: this.timeLeftS,
      score: this.score,
      wind: { active: this.wind.active, dir_deg: this.wind.dir_deg },
      player,
      lanterns,
      shades,
      motes_active: motes.length,
      motes,
      drifters,
      charms,
    };
  }

  public drainEvents(): SimEvent[] {
    if (this.eventQueue.length === 0) return [];
    const drained = this.eventQueue;
    this.eventQueue = [];
    return drained;
  }
}
