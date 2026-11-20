export type Vec3 = [number, number, number];
export type NightNumber = 1 | 2 | 3;
export type GameState = "playing" | "paused" | "won" | "lost";
export type ShadeBehaviorState = "spawning" | "wander" | "chase" | "recoil" | "stunned" | "drain";
export type DrifterBehaviorState = "idle" | "chase" | "flee";
export type MoteKind = "random" | "dropped";
export type GameOverReason = "dawn_survived" | "dawn" | "no_flames";

export interface StepInput {
  move?: [number, number]; // [x, z] in [-1, 1]
  cam_yaw_deg?: number;
  jump?: boolean;
  interact?: boolean;
  pulse?: boolean;
  dash?: boolean;
  pause?: boolean;
}

export interface InputFrame extends StepInput {
  tick: number;
}

export interface InputsFile {
  frames: InputFrame[];
}

export interface ScenarioMoteObj {
  id?: string;
  pos: Vec3;
  kind?: MoteKind;
  ttl_ticks?: number;
}

export interface ScenarioConfig {
  player?: {
    pos?: Vec3;
    carried?: number;
    flames?: number;
    invuln_ticks?: number;
    dash_cd_ticks?: number;
    pulse_cd_ticks?: number;
    charm_ticks?: number;
    successful_lights?: number;
  };
  random_motes?: boolean;
  random_shades?: boolean;
  random_drifters?: boolean;
  wind_enabled?: boolean;
  motes?: Array<Vec3 | ScenarioMoteObj>;
  shades?: Array<{
    id?: string;
    pos: Vec3;
    state?: ShadeBehaviorState;
    state_ticks_left?: number;
    target_lantern_id?: string;
  }>;
  lanterns?: Array<{
    id: string;
    pos?: Vec3;
    deposited?: number;
    lit?: boolean;
    fuel?: number;
    ever_lit?: boolean;
  }>;
  drifters?: Array<{
    id?: string;
    pos: Vec3;
    state?: DrifterBehaviorState;
    stolen?: number;
    flee_ticks_left?: number;
  }>;
  charms?: Array<{
    id?: string;
    pos: Vec3;
    available?: boolean;
    respawn_ticks?: number;
  }>;
  time_left_s?: number;
}

export interface SimOptions {
  seed: number;
  night?: NightNumber;
  scenario?: ScenarioConfig;
}

export interface PlayerState {
  pos: Vec3;
  vel: Vec3;
  grounded: boolean;
  flames: number;
  carried: number;
  capacity: number;
  invuln: boolean;
  dash_cd_s: number;
  pulse_cd_s: number;
  charm_s: number;
}

export interface LanternState {
  id: string;
  pos: Vec3;
  lit: boolean;
  deposited: number;
  fuel: number;
  ever_lit: boolean;
  relit_count: number;
}

export interface ShadeState {
  id: string;
  pos: Vec3;
  state: ShadeBehaviorState;
}

export interface MoteState {
  id: string;
  pos: Vec3;
  kind: MoteKind;
  ttl_s: number | null;
}

export interface DrifterState {
  id: string;
  pos: Vec3;
  state: DrifterBehaviorState;
  stolen: number;
}

export interface CharmState {
  id: string;
  pos: Vec3;
  available: boolean;
  respawn_s: number;
}

export interface WindState {
  active: boolean;
  dir_deg: number;
}

export interface SimSnapshot {
  type: "snapshot";
  tick: number;
  sim_tick: number;
  night: NightNumber;
  state: GameState;
  time_left_s: number;
  score: number;
  wind: WindState;
  player: PlayerState;
  lanterns: LanternState[];
  shades: ShadeState[];
  motes_active: number;
  motes: MoteState[];
  drifters: DrifterState[];
  charms: CharmState[];
}

export type SimEvent =
  | { type: "event"; tick: number; name: "night_start"; data: { night: NightNumber } }
  | { type: "event"; tick: number; name: "paused"; data: Record<string, never> }
  | { type: "event"; tick: number; name: "resumed"; data: Record<string, never> }
  | { type: "event"; tick: number; name: "dash"; data: Record<string, never> }
  | { type: "event"; tick: number; name: "mote_picked"; data: { carried: number } }
  | { type: "event"; tick: number; name: "charm_picked"; data: { charm_id: string; charm_ticks: number } }
  | { type: "event"; tick: number; name: "deposit"; data: { lantern_id: string; amount: number; deposited: number } }
  | { type: "event"; tick: number; name: "lantern_lit"; data: { lantern_id: string; relight: boolean } }
  | { type: "event"; tick: number; name: "refuel"; data: { lantern_id: string; amount: number; fuel: number } }
  | { type: "event"; tick: number; name: "lantern_out"; data: { lantern_id: string } }
  | { type: "event"; tick: number; name: "fuel_drain"; data: { lantern_id: string; shade_id: string; fuel: number } }
  | { type: "event"; tick: number; name: "pulse"; data: { stunned_ids: string[] } }
  | { type: "event"; tick: number; name: "drifter_steal"; data: { drifter_id: string; amount: number; carried: number } }
  | { type: "event"; tick: number; name: "drifter_drop"; data: { drifter_id: string; amount: number } }
  | {
      type: "event";
      tick: number;
      name: "player_hit";
      data:
        | { by: "shade"; flames: number; dropped: number }
        | { by: "fall"; flames: number; dropped: number; lost: number };
    }
  | { type: "event"; tick: number; name: "shade_spawned"; data: { id: string } }
  | { type: "event"; tick: number; name: "game_over"; data: { result: "won" | "lost"; reason: GameOverReason } };

export interface EndLine {
  type: "end";
  ticks: number;
  state: GameState;
  score: number;
}

export interface JumpPadDef {
  id: string;
  pos: Vec3;
  radius: number;
  launch_vy: number;
  launch_vh: number;
  dir: [number, number];
}

export interface RampDef {
  angle_deg: number;
  r_foot: number;
  r_top: number;
  y_foot: number;
  y_top: number;
  width: number;
}

export interface MapGeometry {
  islands: ReadonlyArray<{ center: [number, number]; radius: number; y: number }>;
  bridge?: { xMin: number; xMax: number; zMin: number; zMax: number; y: number };
  tiers?: {
    tier1: { rMin: number; rMax: number; y: number; zMin: number };
    tier2: { radius: number; y: number };
    ramps: ReadonlyArray<RampDef>;
    bellTower: { center: [number, number]; radius: number; yBase: number; height: number };
  };
}

export interface NightConfig {
  night: NightNumber;
  name: string;
  introLine: string;
  duration_s: number;
  playerStart: Vec3;
  shade_speed: number;
  shade_spawn_interval_ticks: number;
  shade_cap: number;
  drifters_enabled: boolean;
  wind_enabled: boolean;
  lanterns: ReadonlyArray<{ id: string; pos: Vec3 }>;
  moteSpawnPoints: ReadonlyArray<Vec3>;
  shadeSpawnPoints: ReadonlyArray<Vec3>;
  jumpPads: ReadonlyArray<JumpPadDef>;
  charms: ReadonlyArray<{ id: string; pos: Vec3 }>;
  geometry: MapGeometry;
}
