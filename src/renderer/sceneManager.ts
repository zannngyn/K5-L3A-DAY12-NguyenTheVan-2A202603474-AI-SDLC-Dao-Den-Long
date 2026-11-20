import * as THREE from "three";
import {
  getGroundHeight,
  nightConfig,
  type CharmState,
  type DrifterState,
  type LanternState,
  type MoteState,
  type NightConfig,
  type NightNumber,
  type ShadeState,
  type SimEvent,
  type SimSnapshot,
} from "../sim";
import { MothCompanion } from "./mothCompanion";
import { PALETTE } from "./palette";

interface LanternVisual {
  group: THREE.Group;
  coreMesh: THREE.Mesh;
  coreMat: THREE.MeshStandardMaterial;
  safeRing: THREE.Mesh;
  warmDisc: THREE.Mesh;
}

interface MoteVisual {
  group: THREE.Group;
  coreMesh: THREE.Mesh;
  haloMesh: THREE.Mesh;
  kind: "random" | "dropped";
  phase: number;
}

interface ShadeVisual {
  group: THREE.Group;
  bodyMesh: THREE.Mesh;
  tailMesh: THREE.Mesh;
  bodyMat: THREE.MeshStandardMaterial;
  eyeLeftMat: THREE.MeshBasicMaterial;
  eyeRightMat: THREE.MeshBasicMaterial;
  stunHalo: THREE.Mesh;
  spawnRing: THREE.Mesh;
  phase: number;
  prevX: number;
  prevY: number;
  prevZ: number;
  currX: number;
  currY: number;
  currZ: number;
}

interface DrifterVisual {
  group: THREE.Group;
  segments: THREE.Mesh[];
  ribbonMat: THREE.MeshStandardMaterial;
  lootOrbs: THREE.Mesh[];
  phase: number;
}

interface CharmVisual {
  group: THREE.Group;
  talismanGroup: THREE.Group;
  respawnRing: THREE.Mesh;
}

interface PulseWave {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  duration: number;
  active: boolean;
}

interface WindLeaf {
  mesh: THREE.Mesh;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  speed: number;
  phase: number;
}

export interface OffscreenArrowProjection {
  visible: boolean;
  screenX: number; // 0..1 normalized viewport
  screenY: number; // 0..1 normalized viewport
  angleRad: number; // CSS rotation angle in radians (0 = pointing right)
  distanceM: number;
}

const SAFE_RADIUS = 6.0;
const PULSE_RADIUS = 5.0;
const CAMERA_ORBIT_RADIUS = 12.5;
const CAMERA_LOOK_HEIGHT = 1.35;
const CAMERA_MIN_Y = 0.35;
const CAMERA_DEFAULT_PITCH_DEG = 22;
const CAMERA_FOLLOW_SMOOTH = 16.0;
const TELEPORT_SNAP_DIST_SQ = 4.0;
const MAX_POOLED_LANTERN_LIGHTS = 3; // + 1 hat light = 4 active PointLights max
const MAX_PULSE_WAVES = 4;
const WIND_LEAF_COUNT = 44;

export class SceneManager {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly fog: THREE.Fog;
  private readonly ambientLight: THREE.AmbientLight;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly moonLight: THREE.DirectionalLight;

  // Dynamic pooled lantern point lights (strictly capped at 3 + 1 hat light = 4)
  private readonly pooledLanternLights: THREE.PointLight[] = [];

  private readonly nightEnvGroup = new THREE.Group();
  private currentBuiltNight: NightNumber | null = null;
  private readonly jumpPadRings: THREE.Mesh[] = [];

  private readonly playerGroup: THREE.Group;
  private readonly playerModel: THREE.Group;
  private readonly charmAuraRing: THREE.Mesh;
  private readonly carriedOrbs: THREE.Mesh[] = [];
  private readonly moth: MothCompanion;

  private readonly lanterns = new Map<string, LanternVisual>();
  private readonly motes = new Map<string, MoteVisual>();
  private readonly shades = new Map<string, ShadeVisual>();
  private readonly drifters = new Map<string, DrifterVisual>();
  private readonly charms = new Map<string, CharmVisual>();
  private readonly pulseWaves: PulseWave[] = [];
  private readonly windLeaves: WindLeaf[] = [];
  private readonly windLeavesGroup = new THREE.Group();

  // Shared geometries & materials (reused across entities to avoid GC / draw overhead)
  private readonly sharedGeos: {
    lanternBase: THREE.CylinderGeometry;
    lanternPole: THREE.CylinderGeometry;
    lanternRoof: THREE.ConeGeometry;
    lanternCore: THREE.CylinderGeometry;
    safeRing: THREE.RingGeometry;
    warmDisc: THREE.CircleGeometry;
    moteCore: THREE.OctahedronGeometry;
    moteHalo: THREE.RingGeometry;
    droppedCore: THREE.OctahedronGeometry;
    droppedHalo: THREE.RingGeometry;
    shadeBody: THREE.IcosahedronGeometry;
    shadeTail: THREE.ConeGeometry;
    shadeEye: THREE.SphereGeometry;
    stunHalo: THREE.TorusGeometry;
    spawnRing: THREE.RingGeometry;
    drifterSeg: THREE.BoxGeometry;
    drifterLoot: THREE.OctahedronGeometry;
    charmBody: THREE.BoxGeometry;
    charmBorder: THREE.BoxGeometry;
    charmRing: THREE.RingGeometry;
    pulseRing: THREE.RingGeometry;
    windLeaf: THREE.PlaneGeometry;
  };

  private readonly sharedMats: {
    grass: THREE.MeshStandardMaterial;
    sand: THREE.MeshStandardMaterial;
    wood: THREE.MeshStandardMaterial;
    stone: THREE.MeshStandardMaterial;
    cloudSea: THREE.MeshBasicMaterial;
    gold: THREE.MeshStandardMaterial;
    moteCore: THREE.MeshStandardMaterial;
    moteHalo: THREE.MeshBasicMaterial;
    droppedCore: THREE.MeshStandardMaterial;
    droppedHalo: THREE.MeshBasicMaterial;
    safeRing: THREE.MeshBasicMaterial;
    warmDisc: THREE.MeshBasicMaterial;
    stunHalo: THREE.MeshBasicMaterial;
    spawnRing: THREE.MeshBasicMaterial;
    charmBody: THREE.MeshStandardMaterial;
    charmBorder: THREE.MeshStandardMaterial;
    charmRespawn: THREE.MeshBasicMaterial;
    jumpPad: THREE.MeshStandardMaterial;
    jumpPadRing: THREE.MeshBasicMaterial;
    windLeaf: THREE.MeshBasicMaterial;
  };

  private readonly colorSky = new THREE.Color(PALETTE.nightSky);
  private readonly colorMist = new THREE.Color(PALETTE.nightMist);
  private readonly colorGrass = new THREE.Color(PALETTE.grass);
  private readonly colorGroundWarm = new THREE.Color(PALETTE.litGroundWarmth);

  // Pre-allocated scratch buffers (zero per-frame allocations in hot paths)
  private readonly cameraTarget = new THREE.Vector3(0, 0, 0);
  private readonly cameraPos = new THREE.Vector3(0, 6.0, -11.5);
  private readonly cameraLook = new THREE.Vector3(0, CAMERA_LOOK_HEIGHT, 0);
  private readonly scratchVec = new THREE.Vector3();
  private readonly seenIds = new Set<string>();
  private readonly lightCandidates: Array<{ lantern: LanternState; distSq: number }> = [];

  private readonly prevPlayerPos: [number, number, number] = [0, 0, 0];
  private readonly currPlayerPos: [number, number, number] = [0, 0, 0];
  private readonly interpPlayerPos: [number, number, number] = [0, 0, 0];

  private lastPlayerX = 0;
  private lastPlayerZ = 0;
  private playerFacingYaw = 0;
  private walkPhase = 0;
  private walkBlend = 0;
  private elapsed = 0;
  private smoothedLitRatio = 0;
  private dashFlashTimer = 0;

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(
      container.clientWidth || window.innerWidth,
      container.clientHeight || window.innerHeight
    );
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.fog = new THREE.Fog(PALETTE.nightMist, 42, 120);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(PALETTE.nightSky);

    const aspect =
      (container.clientWidth || window.innerWidth) /
      Math.max(1, container.clientHeight || window.innerHeight);
    this.camera = new THREE.PerspectiveCamera(56, aspect, 0.2, 260);
    this.camera.position.copy(this.cameraPos);
    this.camera.lookAt(this.cameraLook);

    // Lighting:
    // ambientLight strictly follows Ticket-02 formula: 0.15 + 0.55 * (lit / total)
    // hemiLight + moonLight maintain a readable moonlit floor (>= Phase 1 brightness at 0 lit)
    this.ambientLight = new THREE.AmbientLight(0xd8dff8, 0.15);
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(0x98a8e8, 0x2a3b48, 1.05);
    this.scene.add(this.hemiLight);

    this.moonLight = new THREE.DirectionalLight(0xc8d8ff, 0.95);
    this.moonLight.position.set(-28, 44, -22);
    this.scene.add(this.moonLight);

    // Pooled lantern PointLights (max 3 active + 1 hat light = 4 total)
    for (let i = 0; i < MAX_POOLED_LANTERN_LIGHTS; i++) {
      const pl = new THREE.PointLight(PALETTE.litLantern, 0, 20);
      pl.visible = false;
      this.scene.add(pl);
      this.pooledLanternLights.push(pl);
    }

    // Shared geometries
    const safeRingGeo = new THREE.RingGeometry(SAFE_RADIUS - 0.16, SAFE_RADIUS, 40);
    safeRingGeo.rotateX(-Math.PI / 2);
    const warmDiscGeo = new THREE.CircleGeometry(SAFE_RADIUS - 0.16, 32);
    warmDiscGeo.rotateX(-Math.PI / 2);
    const stunHaloGeo = new THREE.TorusGeometry(0.45, 0.045, 6, 16);
    stunHaloGeo.rotateX(Math.PI / 2);
    const spawnRingGeo = new THREE.RingGeometry(0.55, 0.85, 24);
    spawnRingGeo.rotateX(-Math.PI / 2);
    const shadeTailGeo = new THREE.ConeGeometry(0.52, 0.9, 7);
    shadeTailGeo.rotateX(Math.PI);
    const charmRingGeo = new THREE.RingGeometry(0.45, 0.65, 20);
    charmRingGeo.rotateX(-Math.PI / 2);
    const pulseRingGeo = new THREE.RingGeometry(0.84, 1.0, 40);
    pulseRingGeo.rotateX(-Math.PI / 2);

    this.sharedGeos = {
      lanternBase: new THREE.CylinderGeometry(0.55, 0.72, 0.45, 8),
      lanternPole: new THREE.CylinderGeometry(0.13, 0.18, 3.6, 8),
      lanternRoof: new THREE.ConeGeometry(0.75, 0.48, 6),
      lanternCore: new THREE.CylinderGeometry(0.36, 0.32, 0.78, 6),
      safeRing: safeRingGeo,
      warmDisc: warmDiscGeo,
      moteCore: new THREE.OctahedronGeometry(0.22, 0),
      moteHalo: new THREE.RingGeometry(0.28, 0.36, 14),
      droppedCore: new THREE.OctahedronGeometry(0.17, 0),
      droppedHalo: new THREE.RingGeometry(0.26, 0.38, 14),
      shadeBody: new THREE.IcosahedronGeometry(0.68, 1),
      shadeTail: shadeTailGeo,
      shadeEye: new THREE.SphereGeometry(0.11, 8, 8),
      stunHalo: stunHaloGeo,
      spawnRing: spawnRingGeo,
      drifterSeg: new THREE.BoxGeometry(0.38, 0.12, 0.62),
      drifterLoot: new THREE.OctahedronGeometry(0.13, 0),
      charmBody: new THREE.BoxGeometry(0.42, 0.68, 0.07),
      charmBorder: new THREE.BoxGeometry(0.5, 0.76, 0.045),
      charmRing: charmRingGeo,
      pulseRing: pulseRingGeo,
      windLeaf: new THREE.PlaneGeometry(0.26, 0.12),
    };

    // Shared materials
    this.sharedMats = {
      grass: new THREE.MeshStandardMaterial({
        color: PALETTE.grass,
        roughness: 0.9,
        metalness: 0.04,
      }),
      sand: new THREE.MeshStandardMaterial({
        color: PALETTE.sand,
        roughness: 0.92,
        metalness: 0.02,
      }),
      wood: new THREE.MeshStandardMaterial({
        color: PALETTE.wood,
        roughness: 0.85,
      }),
      stone: new THREE.MeshStandardMaterial({
        color: PALETTE.unlitLantern,
        roughness: 0.9,
        flatShading: true,
      }),
      cloudSea: new THREE.MeshBasicMaterial({
        color: PALETTE.cloudSea,
        side: THREE.DoubleSide,
      }),
      gold: new THREE.MeshStandardMaterial({
        color: PALETTE.gold,
        emissive: PALETTE.gold,
        emissiveIntensity: 0.5,
        roughness: 0.3,
        metalness: 0.6,
      }),
      moteCore: new THREE.MeshStandardMaterial({
        color: PALETTE.moteCore,
        emissive: PALETTE.moteCore,
        emissiveIntensity: 1.7,
        roughness: 0.2,
      }),
      moteHalo: new THREE.MeshBasicMaterial({
        color: PALETTE.moteHalo,
        transparent: true,
        opacity: 0.48,
        side: THREE.DoubleSide,
      }),
      droppedCore: new THREE.MeshStandardMaterial({
        color: PALETTE.gold,
        emissive: PALETTE.litLantern,
        emissiveIntensity: 1.9,
        roughness: 0.2,
      }),
      droppedHalo: new THREE.MeshBasicMaterial({
        color: PALETTE.dangerUi,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
      }),
      safeRing: new THREE.MeshBasicMaterial({
        color: PALETTE.litLantern,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
      }),
      warmDisc: new THREE.MeshBasicMaterial({
        color: PALETTE.litGroundWarmth,
        transparent: true,
        opacity: 0.3,
      }),
      stunHalo: new THREE.MeshBasicMaterial({ color: PALETTE.gold }),
      spawnRing: new THREE.MeshBasicMaterial({
        color: PALETTE.shadeOutline,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
      }),
      charmBody: new THREE.MeshStandardMaterial({
        color: PALETTE.windCharm,
        emissive: PALETTE.windCharm,
        emissiveIntensity: 0.55,
        roughness: 0.4,
      }),
      charmBorder: new THREE.MeshStandardMaterial({
        color: PALETTE.gold,
        emissive: PALETTE.gold,
        emissiveIntensity: 0.7,
        roughness: 0.3,
        metalness: 0.5,
      }),
      charmRespawn: new THREE.MeshBasicMaterial({
        color: PALETTE.windCharm,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
      }),
      jumpPad: new THREE.MeshStandardMaterial({
        color: PALETTE.sand,
        emissive: PALETTE.litLantern,
        emissiveIntensity: 0.35,
        roughness: 0.5,
      }),
      jumpPadRing: new THREE.MeshBasicMaterial({
        color: PALETTE.gold,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      }),
      windLeaf: new THREE.MeshBasicMaterial({
        color: PALETTE.sand,
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
      }),
    };

    // Static sky starfield + cloud sea + dynamic per-night environment group
    this.buildStaticBackdrop();
    this.scene.add(this.nightEnvGroup);

    // Pre-allocate pulse wave pool
    for (let i = 0; i < MAX_PULSE_WAVES; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: PALETTE.moteHalo,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.sharedGeos.pulseRing, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.pulseWaves.push({ mesh, mat, age: 0, duration: 0.45, active: false });
    }

    // Pre-allocate Night 3 wind leaves pool
    for (let i = 0; i < WIND_LEAF_COUNT; i++) {
      const mesh = new THREE.Mesh(this.sharedGeos.windLeaf, this.sharedMats.windLeaf);
      mesh.visible = false;
      this.windLeavesGroup.add(mesh);
      this.windLeaves.push({
        mesh,
        offsetX: (Math.random() - 0.5) * 32,
        offsetY: 0.6 + Math.random() * 5.2,
        offsetZ: (Math.random() - 0.5) * 32,
        speed: 7 + Math.random() * 6,
        phase: Math.random() * Math.PI * 2,
      });
    }
    this.scene.add(this.windLeavesGroup);

    // Player (May)
    const { root, model, charmAura } = this.buildPlayer();
    this.playerGroup = root;
    this.playerModel = model;
    this.charmAuraRing = charmAura;
    this.scene.add(this.playerGroup);

    // Lantern Moth Companion ("Bướm Đèn")
    this.moth = new MothCompanion(this.scene);

    window.addEventListener("resize", this.handleResize);
  }

  public reset(snapshot: SimSnapshot): void {
    this.ensureNightEnvironment(snapshot.night);

    const [px, py, pz] = snapshot.player.pos;
    this.prevPlayerPos[0] = px;
    this.prevPlayerPos[1] = py;
    this.prevPlayerPos[2] = pz;
    this.currPlayerPos[0] = px;
    this.currPlayerPos[1] = py;
    this.currPlayerPos[2] = pz;
    this.interpPlayerPos[0] = px;
    this.interpPlayerPos[1] = py;
    this.interpPlayerPos[2] = pz;

    this.lastPlayerX = px;
    this.lastPlayerZ = pz;
    this.playerFacingYaw = 0;
    this.walkPhase = 0;
    this.walkBlend = 0;
    this.dashFlashTimer = 0;
    const totalLanterns = Math.max(1, snapshot.lanterns.length);
    this.smoothedLitRatio = snapshot.lanterns.filter((l) => l.lit).length / totalLanterns;

    // Clear dynamic entity pools
    for (const l of this.lanterns.values()) {
      this.scene.remove(l.group);
      l.coreMat.dispose();
    }
    this.lanterns.clear();

    for (const m of this.motes.values()) this.scene.remove(m.group);
    this.motes.clear();

    for (const s of this.shades.values()) {
      this.scene.remove(s.group);
      s.bodyMat.dispose();
      s.eyeLeftMat.dispose();
      s.eyeRightMat.dispose();
    }
    this.shades.clear();

    for (const d of this.drifters.values()) {
      this.scene.remove(d.group);
      d.ribbonMat.dispose();
    }
    this.drifters.clear();

    for (const c of this.charms.values()) this.scene.remove(c.group);
    this.charms.clear();

    for (const w of this.pulseWaves) {
      w.active = false;
      w.mesh.visible = false;
    }

    for (const leaf of this.windLeaves) {
      leaf.mesh.visible = false;
    }

    for (const pl of this.pooledLanternLights) {
      pl.visible = false;
      pl.intensity = 0;
    }

    // Snap camera immediately to player start (no drift/smoothing across reset)
    this.cameraTarget.set(px, py, pz);
    this.applyCameraOrbit(0, CAMERA_DEFAULT_PITCH_DEG);
    this.moth.reset(snapshot.player.pos);
  }

  /**
   * Captures previous/current entity positions after each fixed sim step for smooth
   * render interpolation. Snaps interpolation and camera target on teleports or pad launches.
   */
  public onSimStep(snapshot: SimSnapshot, forceSnap = false): void {
    const [nx, ny, nz] = snapshot.player.pos;
    const dx = nx - this.currPlayerPos[0];
    const dy = ny - this.currPlayerPos[1];
    const dz = nz - this.currPlayerPos[2];
    const distSq = dx * dx + dy * dy + dz * dz;

    if (forceSnap || distSq > TELEPORT_SNAP_DIST_SQ) {
      this.prevPlayerPos[0] = nx;
      this.prevPlayerPos[1] = ny;
      this.prevPlayerPos[2] = nz;
      this.currPlayerPos[0] = nx;
      this.currPlayerPos[1] = ny;
      this.currPlayerPos[2] = nz;
      this.cameraTarget.set(nx, ny, nz);
    } else {
      this.prevPlayerPos[0] = this.currPlayerPos[0];
      this.prevPlayerPos[1] = this.currPlayerPos[1];
      this.prevPlayerPos[2] = this.currPlayerPos[2];
      this.currPlayerPos[0] = nx;
      this.currPlayerPos[1] = ny;
      this.currPlayerPos[2] = nz;
    }

    for (let i = 0; i < snapshot.shades.length; i++) {
      const s = snapshot.shades[i];
      const vis = this.shades.get(s.id);
      if (!vis) continue;
      const sdx = s.pos[0] - vis.currX;
      const sdy = s.pos[1] - vis.currY;
      const sdz = s.pos[2] - vis.currZ;
      if (sdx * sdx + sdy * sdy + sdz * sdz > TELEPORT_SNAP_DIST_SQ) {
        vis.prevX = s.pos[0];
        vis.prevY = s.pos[1];
        vis.prevZ = s.pos[2];
      } else {
        vis.prevX = vis.currX;
        vis.prevY = vis.currY;
        vis.prevZ = vis.currZ;
      }
      vis.currX = s.pos[0];
      vis.currY = s.pos[1];
      vis.currZ = s.pos[2];
    }
  }

  public handleEvents(events: readonly SimEvent[], snapshot: SimSnapshot): void {
    this.moth.onEvents(events);
    for (const ev of events) {
      if (ev.name === "pulse") {
        this.spawnPulseWave(snapshot.player.pos);
      } else if (ev.name === "dash") {
        this.dashFlashTimer = 0.22;
      }
    }
  }

  public render(
    snapshot: SimSnapshot,
    camYawDeg: number,
    dtSec: number,
    camPitchDeg = CAMERA_DEFAULT_PITCH_DEG,
    paused = false,
    alpha = 1
  ): void {
    this.ensureNightEnvironment(snapshot.night);

    const animDt = paused ? 0 : dtSec;
    this.elapsed += animDt;
    if (this.dashFlashTimer > 0 && !paused) {
      this.dashFlashTimer = Math.max(0, this.dashFlashTimer - animDt);
    }

    const clampedAlpha = paused ? 1 : Math.max(0, Math.min(1, alpha));
    if (paused) {
      // Lock interpolation endpoints to current sim state so pause/resume never jumps
      this.prevPlayerPos[0] = snapshot.player.pos[0];
      this.prevPlayerPos[1] = snapshot.player.pos[1];
      this.prevPlayerPos[2] = snapshot.player.pos[2];
      this.currPlayerPos[0] = snapshot.player.pos[0];
      this.currPlayerPos[1] = snapshot.player.pos[1];
      this.currPlayerPos[2] = snapshot.player.pos[2];
    }

    this.interpPlayerPos[0] =
      this.prevPlayerPos[0] + (this.currPlayerPos[0] - this.prevPlayerPos[0]) * clampedAlpha;
    this.interpPlayerPos[1] =
      this.prevPlayerPos[1] + (this.currPlayerPos[1] - this.prevPlayerPos[1]) * clampedAlpha;
    this.interpPlayerPos[2] =
      this.prevPlayerPos[2] + (this.currPlayerPos[2] - this.prevPlayerPos[2]) * clampedAlpha;

    this.updateLightingAndFog(snapshot, animDt);
    this.updatePlayer(snapshot, this.interpPlayerPos, animDt);
    this.syncLanterns(snapshot.lanterns, this.interpPlayerPos);
    this.syncMotes(snapshot.motes);
    this.syncShades(snapshot.shades, clampedAlpha, paused);
    this.syncDrifters(snapshot.drifters);
    this.syncCharms(snapshot.charms);
    this.updateJumpPads(animDt);
    this.updateWindLeaves(snapshot, this.interpPlayerPos, animDt);
    this.updatePulseWaves(animDt);
    this.moth.update(snapshot, animDt);
    this.updateCamera(this.interpPlayerPos, camYawDeg, camPitchDeg, animDt, paused);

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Projects the nearest unlit lantern to viewport coordinates for the off-screen HUD arrow.
   * Zero allocations — writes directly into `out`.
   */
  public projectNearestUnlitLantern(
    snapshot: SimSnapshot,
    out: OffscreenArrowProjection
  ): void {
    const [px, , pz] = snapshot.player.pos;
    let nearest: LanternState | null = null;
    let bestDistSq = Infinity;
    for (let i = 0; i < snapshot.lanterns.length; i++) {
      const l = snapshot.lanterns[i];
      if (l.lit) continue;
      const dx = l.pos[0] - px;
      const dz = l.pos[2] - pz;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        nearest = l;
      }
    }

    if (!nearest) {
      out.visible = false;
      return;
    }

    this.scratchVec.set(nearest.pos[0], nearest.pos[1] + 2.8, nearest.pos[2]);
    this.scratchVec.project(this.camera);

    const behind = this.scratchVec.z > 1.0;
    let ndcX = this.scratchVec.x;
    let ndcY = this.scratchVec.y;

    const onScreen = !behind && ndcX >= -0.92 && ndcX <= 0.92 && ndcY >= -0.9 && ndcY <= 0.9;
    if (onScreen) {
      out.visible = false;
      return;
    }

    if (behind) {
      ndcX = -ndcX;
      ndcY = -ndcY;
    }

    const len = Math.hypot(ndcX, ndcY) || 1;
    const dirX = ndcX / len;
    const dirY = ndcY / len;

    // Clamp to an inset screen border ellipse/box
    const marginX = 0.86;
    const marginY = 0.82;
    const scaleX = Math.abs(dirX) > 1e-4 ? marginX / Math.abs(dirX) : 999;
    const scaleY = Math.abs(dirY) > 1e-4 ? marginY / Math.abs(dirY) : 999;
    const scale = Math.min(scaleX, scaleY);

    const edgeX = dirX * scale;
    const edgeY = dirY * scale;

    out.visible = true;
    out.screenX = (edgeX + 1) * 0.5;
    out.screenY = (1 - edgeY) * 0.5;
    // Screen Y is inverted relative to NDC Y
    out.angleRad = Math.atan2(-dirY, dirX);
    out.distanceM = Math.sqrt(bestDistSq);
  }

  public dispose(): void {
    window.removeEventListener("resize", this.handleResize);
    this.moth.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private buildStaticBackdrop(): void {
    // Cloud sea plane far below islands
    const seaGeo = new THREE.PlaneGeometry(460, 460);
    seaGeo.rotateX(-Math.PI / 2);
    const sea = new THREE.Mesh(seaGeo, this.sharedMats.cloudSea);
    sea.position.set(25, -4.5, 0);
    this.scene.add(sea);

    // Subtle mist rings on the cloud sea
    const mistRingGeo = new THREE.RingGeometry(48, 170, 48);
    mistRingGeo.rotateX(-Math.PI / 2);
    const mistRingMat = new THREE.MeshBasicMaterial({
      color: PALETTE.nightMist,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
    });
    const mistRing = new THREE.Mesh(mistRingGeo, mistRingMat);
    mistRing.position.set(25, -3.2, 0);
    this.scene.add(mistRing);

    // Starfield dome
    const starCount = 260;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.42 + 0.08;
      const r = 135 + Math.random() * 35;
      starPositions[i * 3] = 20 + r * Math.cos(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.sin(phi) + 10;
      starPositions[i * 3 + 2] = r * Math.cos(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      color: PALETTE.uiText,
      size: 0.75,
      transparent: true,
      opacity: 0.75,
      fog: false,
    });
    this.scene.add(new THREE.Points(starGeo, starMat));
  }

  private ensureNightEnvironment(night: NightNumber): void {
    if (this.currentBuiltNight === night) return;
    this.currentBuiltNight = night;

    // Clear previous night meshes
    while (this.nightEnvGroup.children.length > 0) {
      const child = this.nightEnvGroup.children[0];
      this.nightEnvGroup.remove(child);
    }
    this.jumpPadRings.length = 0;

    const cfg: NightConfig = nightConfig(night);
    const geom = cfg.geometry;

    // 1. Islands from nightConfig(night).geometry.islands
    for (const isl of geom.islands) {
      const [cx, cz] = isl.center;
      const r = isl.radius;
      const y = isl.y;

      // Grass main island cylinder (top at y)
      const islandGeo = new THREE.CylinderGeometry(r, r + 2.0, 3.0, 52);
      const islandMesh = new THREE.Mesh(islandGeo, this.sharedMats.grass);
      islandMesh.position.set(cx, y - 1.5, cz);
      this.nightEnvGroup.add(islandMesh);

      // Sandy coastal rim around island edge
      const sandRimGeo = new THREE.RingGeometry(Math.max(1, r - 2.4), r, 52);
      sandRimGeo.rotateX(-Math.PI / 2);
      const sandRim = new THREE.Mesh(sandRimGeo, this.sharedMats.sand);
      sandRim.position.set(cx, y + 0.012, cz);
      this.nightEnvGroup.add(sandRim);

      // Subtle rocky border torus
      const rimGeo = new THREE.TorusGeometry(r - 0.2, 0.28, 6, 52);
      rimGeo.rotateX(Math.PI / 2);
      const rim = new THREE.Mesh(rimGeo, this.sharedMats.stone);
      rim.position.set(cx, y + 0.02, cz);
      this.nightEnvGroup.add(rim);

      // Decorative rocks along perimeter (verified via getGroundHeight so they sit on island)
      const rockGeo = new THREE.DodecahedronGeometry(0.75, 0);
      const rockCount = Math.min(16, Math.max(8, Math.floor(r * 0.4)));
      for (let i = 0; i < rockCount; i++) {
        const angle = (i / rockCount) * Math.PI * 2 + 0.23;
        const dist = r - 1.8;
        const rx = cx + Math.cos(angle) * dist;
        const rz = cz + Math.sin(angle) * dist;
        const gh = getGroundHeight(night, rx, rz);
        if (gh === null || Math.abs(gh - y) > 0.2) continue;
        // Skip bridge entry zone on Night 2
        if (geom.bridge && rx >= geom.bridge.xMin - 2 && rx <= geom.bridge.xMax + 2 && Math.abs(rz) < 3.5) {
          continue;
        }
        const rock = new THREE.Mesh(rockGeo, this.sharedMats.stone);
        const s = 0.55 + (i % 3) * 0.22;
        rock.scale.set(s * 1.2, s * 0.7, s);
        rock.position.set(rx, gh + s * 0.22, rz);
        rock.rotation.y = angle * 1.7;
        this.nightEnvGroup.add(rock);
      }
    }

    // Start medallion at playerStart
    const [sx, sy, sz] = cfg.playerStart;
    const startH = getGroundHeight(night, sx, sz) ?? sy;
    const medGeo = new THREE.RingGeometry(1.0, 1.4, 28);
    medGeo.rotateX(-Math.PI / 2);
    const medMat = new THREE.MeshBasicMaterial({
      color: PALETTE.litLantern,
      transparent: true,
      opacity: 0.28,
    });
    const medallion = new THREE.Mesh(medGeo, medMat);
    medallion.position.set(sx, startH + 0.02, sz);
    this.nightEnvGroup.add(medallion);

    // 2. Night 2 Bamboo Bridge (no rails)
    if (geom.bridge) {
      const b = geom.bridge;
      const lengthX = b.xMax - b.xMin;
      const widthZ = b.zMax - b.zMin;
      const midX = (b.xMin + b.xMax) * 0.5;
      const midZ = (b.zMin + b.zMax) * 0.5;

      // Main wooden deck
      const deckGeo = new THREE.BoxGeometry(lengthX, 0.24, widthZ);
      const deck = new THREE.Mesh(deckGeo, this.sharedMats.wood);
      deck.position.set(midX, b.y - 0.12, midZ);
      this.nightEnvGroup.add(deck);

      // Bamboo slats across deck for visual texture
      const slatGeo = new THREE.CylinderGeometry(0.11, 0.11, widthZ + 0.15, 6);
      slatGeo.rotateX(Math.PI / 2);
      const slatCount = Math.max(8, Math.floor(lengthX * 1.3));
      for (let i = 0; i <= slatCount; i++) {
        const x = b.xMin + (i / slatCount) * lengthX;
        const slat = new THREE.Mesh(slatGeo, i % 2 === 0 ? this.sharedMats.wood : this.sharedMats.sand);
        slat.position.set(x, b.y - 0.02, midZ);
        this.nightEnvGroup.add(slat);
      }

      // Two bamboo side beams (flush, no rails)
      const beamGeo = new THREE.CylinderGeometry(0.14, 0.14, lengthX + 1.0, 6);
      beamGeo.rotateZ(Math.PI / 2);
      const beamNorth = new THREE.Mesh(beamGeo, this.sharedMats.wood);
      beamNorth.position.set(midX, b.y - 0.14, b.zMin + 0.15);
      const beamSouth = new THREE.Mesh(beamGeo, this.sharedMats.wood);
      beamSouth.position.set(midX, b.y - 0.14, b.zMax - 0.15);
      this.nightEnvGroup.add(beamNorth, beamSouth);
    }

    // 3. Night 3 Tiers, Ramps, and Bell Tower
    if (geom.tiers) {
      const { tier1, tier2, ramps, bellTower } = geom.tiers;

      // Tier 1 semicircular annulus (rMin..rMax, z >= zMin, height 0..tier1.y)
      const t1Shape = new THREE.Shape();
      t1Shape.absarc(0, 0, tier1.rMax, 0, Math.PI, false);
      t1Shape.lineTo(-tier1.rMin, 0);
      t1Shape.absarc(0, 0, tier1.rMin, Math.PI, 0, true);
      t1Shape.closePath();

      const t1Geo = new THREE.ExtrudeGeometry(t1Shape, {
        depth: tier1.y,
        bevelEnabled: false,
        curveSegments: 36,
      });
      // Rotate +90 deg X so shape (x, y, z) -> (x, -z, y); translate y up by tier1.y
      t1Geo.rotateX(Math.PI / 2);
      const t1Mesh = new THREE.Mesh(t1Geo, [this.sharedMats.grass, this.sharedMats.stone]);
      t1Mesh.position.y = tier1.y;
      this.nightEnvGroup.add(t1Mesh);

      // Tier 2 central disc (radius, height 0..tier2.y)
      const t2WallGeo = new THREE.CylinderGeometry(tier2.radius, tier2.radius + 0.25, tier2.y, 36);
      const t2Wall = new THREE.Mesh(t2WallGeo, this.sharedMats.stone);
      t2Wall.position.y = tier2.y * 0.5;
      this.nightEnvGroup.add(t2Wall);

      const t2TopGeo = new THREE.CircleGeometry(tier2.radius, 36);
      t2TopGeo.rotateX(-Math.PI / 2);
      const t2Top = new THREE.Mesh(t2TopGeo, this.sharedMats.grass);
      t2Top.position.y = tier2.y + 0.015;
      this.nightEnvGroup.add(t2Top);

      // Ramps (straight ramps along radial angles)
      for (const ramp of ramps) {
        const rad = (ramp.angle_deg * Math.PI) / 180;
        const ux = Math.cos(rad);
        const uz = Math.sin(rad);
        const rMid = (ramp.r_foot + ramp.r_top) * 0.5;
        const yMid = (ramp.y_foot + ramp.y_top) * 0.5;
        const run = Math.abs(ramp.r_foot - ramp.r_top);
        const rise = ramp.y_top - ramp.y_foot;
        const slopeLen = Math.hypot(run, rise) + 0.5;
        const slopeAngle = Math.atan2(rise, run);
        const thickness = 0.36;

        const rampGroup = new THREE.Group();
        rampGroup.position.set(rMid * ux, yMid, rMid * uz);
        // Local +Z points inward (-ux, -uz) from foot to top
        rampGroup.rotation.y = Math.atan2(-ux, -uz);

        const plankGeo = new THREE.BoxGeometry(ramp.width, thickness, slopeLen);
        const plank = new THREE.Mesh(plankGeo, this.sharedMats.wood);
        plank.rotation.x = -slopeAngle;
        plank.position.y = -thickness * 0.5;
        rampGroup.add(plank);

        // Side curbs for visual clarity
        const curbGeo = new THREE.BoxGeometry(0.18, 0.22, slopeLen);
        const curbL = new THREE.Mesh(curbGeo, this.sharedMats.sand);
        curbL.rotation.x = -slopeAngle;
        curbL.position.set(-ramp.width * 0.5 + 0.09, 0.05, 0);
        const curbR = new THREE.Mesh(curbGeo, this.sharedMats.sand);
        curbR.rotation.x = -slopeAngle;
        curbR.position.set(ramp.width * 0.5 - 0.09, 0.05, 0);
        rampGroup.add(curbL, curbR);

        this.nightEnvGroup.add(rampGroup);
      }

      // Bell Tower at center of Tier 2 (solid cylinder radius 2 m, height 8 m)
      const btGroup = new THREE.Group();
      btGroup.position.set(bellTower.center[0], bellTower.yBase, bellTower.center[1]);

      const btBaseGeo = new THREE.CylinderGeometry(bellTower.radius, bellTower.radius + 0.15, 1.1, 16);
      const btBase = new THREE.Mesh(btBaseGeo, this.sharedMats.stone);
      btBase.position.y = 0.55;
      btGroup.add(btBase);

      // 4 wooden corner pillars around the bell
      const pillarGeo = new THREE.CylinderGeometry(0.2, 0.24, bellTower.height - 2.2, 8);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const p = new THREE.Mesh(pillarGeo, this.sharedMats.wood);
        p.position.set(
          Math.cos(a) * (bellTower.radius - 0.45),
          1.1 + (bellTower.height - 2.2) * 0.5,
          Math.sin(a) * (bellTower.radius - 0.45)
        );
        btGroup.add(p);
      }

      // Golden Bell hanging inside
      const bellGeo = new THREE.ConeGeometry(0.85, 1.5, 14);
      const bell = new THREE.Mesh(bellGeo, this.sharedMats.gold);
      bell.position.y = bellTower.height * 0.48;
      btGroup.add(bell);

      // Pagoda double roof
      const roof1Geo = new THREE.ConeGeometry(bellTower.radius + 0.9, 1.7, 8);
      const roof1 = new THREE.Mesh(roof1Geo, this.sharedMats.wood);
      roof1.position.y = bellTower.height - 0.9;
      btGroup.add(roof1);

      const roof2Geo = new THREE.ConeGeometry(bellTower.radius * 0.75, 1.3, 8);
      const roof2 = new THREE.Mesh(roof2Geo, this.sharedMats.gold);
      roof2.position.y = bellTower.height + 0.35;
      btGroup.add(roof2);

      this.nightEnvGroup.add(btGroup);
    }

    // 4. Jump Pads (Night 2 & Night 3)
    for (const pad of cfg.jumpPads) {
      const padGroup = new THREE.Group();
      const padH = getGroundHeight(night, pad.pos[0], pad.pos[2]) ?? pad.pos[1];
      padGroup.position.set(pad.pos[0], padH, pad.pos[2]);

      const discGeo = new THREE.CylinderGeometry(pad.radius, pad.radius * 1.15, 0.22, 20);
      const disc = new THREE.Mesh(discGeo, this.sharedMats.jumpPad);
      disc.position.y = 0.11;
      padGroup.add(disc);

      const ringGeo = new THREE.RingGeometry(pad.radius * 0.72, pad.radius * 1.05, 24);
      ringGeo.rotateX(-Math.PI / 2);
      const ring = new THREE.Mesh(ringGeo, this.sharedMats.jumpPadRing);
      ring.position.y = 0.24;
      padGroup.add(ring);
      this.jumpPadRings.push(ring);

      // Directional arrow chevron pointing along pad.dir
      const arrowGeo = new THREE.ConeGeometry(0.32, 0.65, 3);
      arrowGeo.rotateX(Math.PI / 2);
      const arrow = new THREE.Mesh(arrowGeo, this.sharedMats.gold);
      arrow.position.y = 0.3;
      arrow.rotation.y = Math.atan2(pad.dir[0], pad.dir[1]);
      padGroup.add(arrow);

      this.nightEnvGroup.add(padGroup);
    }
  }

  private buildPlayer(): { root: THREE.Group; model: THREE.Group; charmAura: THREE.Mesh } {
    const root = new THREE.Group();
    const model = new THREE.Group();

    // Cream shirt / dress (#E8E2D0 per Ticket-02 palette)
    const shirtGeo = new THREE.ConeGeometry(0.46, 1.05, 10);
    const shirtMat = new THREE.MeshStandardMaterial({
      color: PALETTE.mayShirt,
      roughness: 0.78,
    });
    const shirt = new THREE.Mesh(shirtGeo, shirtMat);
    shirt.position.y = 0.55;
    model.add(shirt);

    // Crimson scarf (#C8102E per Ticket-02 palette)
    const scarfGeo = new THREE.TorusGeometry(0.24, 0.08, 6, 12);
    scarfGeo.rotateX(Math.PI / 2);
    const scarfMat = new THREE.MeshStandardMaterial({
      color: PALETTE.mayScarf,
      roughness: 0.65,
    });
    const scarf = new THREE.Mesh(scarfGeo, scarfMat);
    scarf.position.y = 1.04;
    model.add(scarf);

    // Trailing scarf tail
    const tailGeo = new THREE.BoxGeometry(0.14, 0.42, 0.05);
    const tail = new THREE.Mesh(tailGeo, scarfMat);
    tail.position.set(0, 0.88, -0.26);
    tail.rotation.x = 0.35;
    model.add(tail);

    // Head
    const headGeo = new THREE.SphereGeometry(0.22, 12, 10);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xf4dcc4,
      roughness: 0.65,
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.24;
    model.add(head);

    // Conical leaf hat (Nón Lá)
    const hatGeo = new THREE.ConeGeometry(0.72, 0.42, 16);
    const hatMat = new THREE.MeshStandardMaterial({
      color: PALETTE.hatStraw,
      roughness: 0.75,
      side: THREE.DoubleSide,
    });
    const hat = new THREE.Mesh(hatGeo, hatMat);
    hat.position.y = 1.54;
    model.add(hat);

    // Hanging hat lantern
    const cordGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.24, 6);
    const cord = new THREE.Mesh(cordGeo, this.sharedMats.wood);
    cord.position.set(0, 1.26, 0.62);
    model.add(cord);

    const miniLanternGeo = new THREE.OctahedronGeometry(0.11, 0);
    const miniLanternMat = new THREE.MeshStandardMaterial({
      color: PALETTE.litLantern,
      emissive: PALETTE.litLanternCore,
      emissiveIntensity: 2.2,
      roughness: 0.25,
    });
    const miniLantern = new THREE.Mesh(miniLanternGeo, miniLanternMat);
    miniLantern.position.set(0, 1.1, 0.62);
    model.add(miniLantern);

    // Personal PointLight #1 (out of 4 max active PointLights)
    const hatLight = new THREE.PointLight(PALETTE.litLantern, 2.5, 13);
    hatLight.position.set(0, 1.25, 0.62);
    model.add(hatLight);

    // Wind Charm active aura ring around May's feet
    const auraGeo = new THREE.RingGeometry(0.65, 0.88, 24);
    auraGeo.rotateX(-Math.PI / 2);
    const auraMat = new THREE.MeshBasicMaterial({
      color: PALETTE.windCharm,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
    });
    const charmAura = new THREE.Mesh(auraGeo, auraMat);
    charmAura.position.y = 0.08;
    charmAura.visible = false;
    root.add(charmAura);

    // Orbiting carried mote indicators (up to 10)
    const orbGeo = new THREE.OctahedronGeometry(0.075, 0);
    const orbMat = new THREE.MeshBasicMaterial({ color: PALETTE.moteCore });
    for (let i = 0; i < 10; i++) {
      const orb = new THREE.Mesh(orbGeo, orbMat);
      orb.visible = false;
      root.add(orb);
      this.carriedOrbs.push(orb);
    }

    root.add(model);
    return { root, model, charmAura };
  }

  private createLanternVisual(lantern: LanternState): LanternVisual {
    const group = new THREE.Group();
    group.position.set(lantern.pos[0], lantern.pos[1], lantern.pos[2]);

    const base = new THREE.Mesh(this.sharedGeos.lanternBase, this.sharedMats.stone);
    base.position.y = 0.225;
    group.add(base);

    const pole = new THREE.Mesh(this.sharedGeos.lanternPole, this.sharedMats.wood);
    pole.position.y = 2.0;
    group.add(pole);

    const roof = new THREE.Mesh(this.sharedGeos.lanternRoof, this.sharedMats.wood);
    roof.position.y = 4.22;
    group.add(roof);

    // Per-lantern core material so each lantern displays its own deposit/lit state
    const coreMat = new THREE.MeshStandardMaterial({
      color: PALETTE.unlitLantern,
      emissive: PALETTE.litLantern,
      emissiveIntensity: 0.08,
      roughness: 0.35,
    });
    const coreMesh = new THREE.Mesh(this.sharedGeos.lanternCore, coreMat);
    coreMesh.position.y = 3.65;
    group.add(coreMesh);

    const safeRing = new THREE.Mesh(this.sharedGeos.safeRing, this.sharedMats.safeRing);
    safeRing.position.y = 0.035;
    safeRing.visible = false;
    group.add(safeRing);

    const warmDisc = new THREE.Mesh(this.sharedGeos.warmDisc, this.sharedMats.warmDisc);
    warmDisc.position.y = 0.02;
    warmDisc.visible = false;
    group.add(warmDisc);

    this.scene.add(group);
    return { group, coreMesh, coreMat, safeRing, warmDisc };
  }

  private createMoteVisual(mote: MoteState): MoteVisual {
    const group = new THREE.Group();
    const isDropped = mote.kind === "dropped";

    const coreMesh = new THREE.Mesh(
      isDropped ? this.sharedGeos.droppedCore : this.sharedGeos.moteCore,
      isDropped ? this.sharedMats.droppedCore : this.sharedMats.moteCore
    );
    group.add(coreMesh);

    const haloMesh = new THREE.Mesh(
      isDropped ? this.sharedGeos.droppedHalo : this.sharedGeos.moteHalo,
      isDropped ? this.sharedMats.droppedHalo : this.sharedMats.moteHalo
    );
    if (isDropped) {
      haloMesh.rotation.x = -Math.PI / 2;
    }
    group.add(haloMesh);

    let hash = 0;
    for (let i = 0; i < mote.id.length; i++) hash = (hash * 31 + mote.id.charCodeAt(i)) | 0;
    const phase = (Math.abs(hash) % 628) / 100;

    this.scene.add(group);
    return { group, coreMesh, haloMesh, kind: mote.kind, phase };
  }

  private createShadeVisual(id: string, initialPos: [number, number, number]): ShadeVisual {
    const group = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({
      color: PALETTE.shadeBody,
      emissive: PALETTE.shadeOutline,
      emissiveIntensity: 0.28,
      roughness: 0.7,
      flatShading: true,
    });
    const bodyMesh = new THREE.Mesh(this.sharedGeos.shadeBody, bodyMat);
    bodyMesh.scale.set(1, 1.18, 1);
    group.add(bodyMesh);

    const tailMesh = new THREE.Mesh(this.sharedGeos.shadeTail, bodyMat);
    tailMesh.position.y = -0.65;
    group.add(tailMesh);

    const eyeLeftMat = new THREE.MeshBasicMaterial({ color: PALETTE.shadeOutline });
    const eyeRightMat = new THREE.MeshBasicMaterial({ color: PALETTE.shadeOutline });
    const eyeLeft = new THREE.Mesh(this.sharedGeos.shadeEye, eyeLeftMat);
    eyeLeft.position.set(-0.22, 0.16, 0.56);
    const eyeRight = new THREE.Mesh(this.sharedGeos.shadeEye, eyeRightMat);
    eyeRight.position.set(0.22, 0.16, 0.56);
    group.add(eyeLeft, eyeRight);

    const stunHalo = new THREE.Mesh(this.sharedGeos.stunHalo, this.sharedMats.stunHalo);
    stunHalo.position.y = 1.05;
    stunHalo.visible = false;
    group.add(stunHalo);

    const spawnRing = new THREE.Mesh(this.sharedGeos.spawnRing, this.sharedMats.spawnRing);
    spawnRing.position.y = -0.92;
    spawnRing.visible = false;
    group.add(spawnRing);

    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 37 + id.charCodeAt(i)) | 0;
    const phase = (Math.abs(hash) % 628) / 100;

    this.scene.add(group);
    return {
      group,
      bodyMesh,
      tailMesh,
      bodyMat,
      eyeLeftMat,
      eyeRightMat,
      stunHalo,
      spawnRing,
      phase,
      prevX: initialPos[0],
      prevY: initialPos[1],
      prevZ: initialPos[2],
      currX: initialPos[0],
      currY: initialPos[1],
      currZ: initialPos[2],
    };
  }

  private createDrifterVisual(id: string): DrifterVisual {
    const group = new THREE.Group();
    const ribbonMat = new THREE.MeshStandardMaterial({
      color: PALETTE.drifter,
      emissive: PALETTE.drifter,
      emissiveIntensity: 0.45,
      roughness: 0.35,
      transparent: true,
      opacity: 0.9,
    });

    const segments: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Mesh(this.sharedGeos.drifterSeg, ribbonMat);
      seg.position.set(0, 0, -i * 0.52);
      const scale = 1 - i * 0.14;
      seg.scale.set(scale, 1, scale);
      group.add(seg);
      segments.push(seg);
    }

    const lootOrbs: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const orb = new THREE.Mesh(this.sharedGeos.drifterLoot, this.sharedMats.moteCore);
      orb.visible = false;
      group.add(orb);
      lootOrbs.push(orb);
    }

    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 41 + id.charCodeAt(i)) | 0;
    const phase = (Math.abs(hash) % 628) / 100;

    this.scene.add(group);
    return { group, segments, ribbonMat, lootOrbs, phase };
  }

  private createCharmVisual(charm: CharmState): CharmVisual {
    const group = new THREE.Group();
    group.position.set(charm.pos[0], charm.pos[1], charm.pos[2]);

    const talismanGroup = new THREE.Group();
    const body = new THREE.Mesh(this.sharedGeos.charmBody, this.sharedMats.charmBody);
    const border = new THREE.Mesh(this.sharedGeos.charmBorder, this.sharedMats.charmBorder);
    talismanGroup.add(border, body);
    talismanGroup.position.y = 1.15;
    group.add(talismanGroup);

    const respawnRing = new THREE.Mesh(this.sharedGeos.charmRing, this.sharedMats.charmRespawn);
    respawnRing.position.y = 0.04;
    respawnRing.visible = false;
    group.add(respawnRing);

    this.scene.add(group);
    return { group, talismanGroup, respawnRing };
  }

  private spawnPulseWave(origin: [number, number, number]): void {
    let slot: PulseWave | null = null;
    for (let i = 0; i < this.pulseWaves.length; i++) {
      if (!this.pulseWaves[i].active) {
        slot = this.pulseWaves[i];
        break;
      }
    }
    if (!slot) slot = this.pulseWaves[0];
    slot.active = true;
    slot.age = 0;
    slot.duration = 0.45;
    slot.mesh.visible = true;
    slot.mesh.position.set(origin[0], origin[1] + 0.35, origin[2]);
    slot.mesh.scale.setScalar(0.5);
    slot.mat.opacity = 0.85;
  }

  private updateLightingAndFog(snapshot: SimSnapshot, dtSec: number): void {
    const total = Math.max(1, snapshot.lanterns.length);
    let litCount = 0;
    for (let i = 0; i < snapshot.lanterns.length; i++) {
      if (snapshot.lanterns[i].lit) litCount++;
    }
    const targetRatio = litCount / total;
    this.smoothedLitRatio += (targetRatio - this.smoothedLitRatio) * Math.min(1, dtSec * 3.5);
    const r = this.smoothedLitRatio;

    // Exact Ticket-02 ambient formula: 0.15 + 0.55 * (lit / total)
    this.ambientLight.intensity = 0.15 + 0.55 * r;

    // Readable moonlit floor (kept >= Phase 1 brightness even at 0 lit)
    this.hemiLight.intensity = 1.05 + 0.25 * r;
    this.moonLight.intensity = 0.95 + 0.2 * r;

    this.fog.near = 42 + 14 * r;
    this.fog.far = 120 + 38 * r;
    this.fog.color.copy(this.colorSky).lerp(this.colorMist, 0.35 + 0.65 * r);
    (this.scene.background as THREE.Color).copy(this.fog.color);

    this.sharedMats.grass.color.copy(this.colorGrass).lerp(this.colorGroundWarm, r * 0.22);
  }

  private updatePlayer(
    snapshot: SimSnapshot,
    playerPos: readonly [number, number, number],
    dtSec: number
  ): void {
    const [px, py, pz] = playerPos;
    const vx = snapshot.player.vel[0];
    const vz = snapshot.player.vel[2];
    const horizSpeed = Math.hypot(vx, vz);

    if (horizSpeed > 0.15 && dtSec > 0) {
      const targetYaw = Math.atan2(vx, vz);
      let diff = targetYaw - this.playerFacingYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.playerFacingYaw += diff * (1 - Math.exp(-14 * dtSec));
    }
    this.lastPlayerX = px;
    this.lastPlayerZ = pz;

    this.playerGroup.position.set(px, py, pz);
    this.playerModel.rotation.y = this.playerFacingYaw;

    // Smooth walk cycle driven by sim horizontal velocity (never frame-step noise)
    const isWalking = snapshot.player.grounded && horizSpeed > 0.2;
    if (dtSec > 0) {
      const targetBlend = isWalking ? Math.min(1, horizSpeed / 5.5) : 0;
      this.walkBlend += (targetBlend - this.walkBlend) * (1 - Math.exp(-14 * dtSec));
      if (isWalking) {
        this.walkPhase += dtSec * Math.min(14, 4.5 + horizSpeed * 1.4);
      }
    }

    // Subtle walk bob, sway, and forward lean applied ONLY to playerModel inside playerGroup
    const bob = Math.abs(Math.sin(this.walkPhase)) * 0.07 * this.walkBlend;
    this.playerModel.position.y = bob;
    this.playerModel.rotation.z = Math.sin(this.walkPhase) * 0.045 * this.walkBlend;
    const dashTilt = this.dashFlashTimer > 0 ? 0.28 : 0;
    const walkLean = 0.065 * this.walkBlend;
    this.playerModel.rotation.x = Math.max(walkLean, dashTilt);

    // Invulnerability blink driven directly from SimSnapshot
    if (snapshot.player.invuln) {
      this.playerModel.visible = Math.floor(this.elapsed * 16) % 2 === 0;
    } else {
      this.playerModel.visible = true;
    }

    // Wind Charm active aura
    if (snapshot.player.charm_s > 0) {
      this.charmAuraRing.visible = true;
      this.charmAuraRing.rotation.z = this.elapsed * 3.5;
      const pulse = 1 + Math.sin(this.elapsed * 8) * 0.08;
      this.charmAuraRing.scale.setScalar(pulse);
    } else {
      this.charmAuraRing.visible = false;
    }

    // Orbiting carried motes around May (up to 10)
    const carried = snapshot.player.carried;
    for (let i = 0; i < this.carriedOrbs.length; i++) {
      const orb = this.carriedOrbs[i];
      if (i < carried) {
        orb.visible = true;
        const a = this.elapsed * 2.5 + (i / Math.max(1, carried)) * Math.PI * 2;
        const radius = carried > 5 ? 0.96 : 0.84;
        orb.position.set(
          Math.cos(a) * radius,
          0.95 + Math.sin(a * 2 + i) * 0.14,
          Math.sin(a) * radius
        );
        orb.rotation.y += dtSec * 3;
      } else {
        orb.visible = false;
      }
    }
  }

  private syncLanterns(
    lanternStates: readonly LanternState[],
    playerPos: [number, number, number]
  ): void {
    this.seenIds.clear();
    this.lightCandidates.length = 0;
    const pulse = 1 + Math.sin(this.elapsed * 3.2) * 0.08;

    for (let i = 0; i < lanternStates.length; i++) {
      const l = lanternStates[i];
      this.seenIds.add(l.id);
      let vis = this.lanterns.get(l.id);
      if (!vis) {
        vis = this.createLanternVisual(l);
        this.lanterns.set(l.id, vis);
      }
      vis.group.position.set(l.pos[0], l.pos[1], l.pos[2]);

      if (l.lit) {
        vis.coreMat.color.setHex(PALETTE.litLanternCore);
        vis.coreMat.emissive.setHex(PALETTE.litLantern);
        vis.coreMat.emissiveIntensity = 2.0 * pulse;
        vis.safeRing.visible = true;
        vis.warmDisc.visible = true;
      } else {
        const progress = Math.min(1, l.deposited / 10);
        vis.coreMat.color.setHex(progress > 0 ? PALETTE.litLantern : PALETTE.unlitLantern);
        vis.coreMat.emissive.setHex(PALETTE.litLantern);
        vis.coreMat.emissiveIntensity = 0.1 + progress * 0.95;
        vis.safeRing.visible = false;
        vis.warmDisc.visible = false;
      }

      if (l.lit || l.deposited > 0) {
        const dx = l.pos[0] - playerPos[0];
        const dz = l.pos[2] - playerPos[2];
        this.lightCandidates.push({ lantern: l, distSq: dx * dx + dz * dz });
      }
    }

    for (const [id, vis] of this.lanterns.entries()) {
      if (!this.seenIds.has(id)) {
        this.scene.remove(vis.group);
        vis.coreMat.dispose();
        this.lanterns.delete(id);
      }
    }

    // Assign pooled PointLights to the nearest 3 lit/active lanterns (cap = 4 total with hat light)
    this.lightCandidates.sort((a, b) => a.distSq - b.distSq);
    for (let i = 0; i < MAX_POOLED_LANTERN_LIGHTS; i++) {
      const pl = this.pooledLanternLights[i];
      const cand = this.lightCandidates[i];
      if (cand) {
        const l = cand.lantern;
        pl.visible = true;
        pl.position.set(l.pos[0], l.pos[1] + 3.65, l.pos[2]);
        pl.intensity = l.lit ? 4.4 * pulse : (l.deposited / 10) * 1.6;
      } else {
        pl.visible = false;
        pl.intensity = 0;
      }
    }
  }

  private syncMotes(moteStates: readonly MoteState[]): void {
    this.seenIds.clear();
    for (let i = 0; i < moteStates.length; i++) {
      const m = moteStates[i];
      this.seenIds.add(m.id);
      let vis = this.motes.get(m.id);
      if (!vis) {
        vis = this.createMoteVisual(m);
        this.motes.set(m.id, vis);
      }
      if (m.kind === "dropped") {
        const floatY = m.pos[1] + 0.45 + 0.14 * Math.sin(this.elapsed * 4.5 + vis.phase);
        vis.group.position.set(m.pos[0], floatY, m.pos[2]);
        vis.group.rotation.y = this.elapsed * 3.4 + vis.phase;
        // Blink when TTL is low (< 2s)
        if (m.ttl_s !== null && m.ttl_s < 2.0) {
          vis.group.visible = Math.floor(this.elapsed * 14) % 2 === 0;
        } else {
          vis.group.visible = true;
        }
      } else {
        const floatY = m.pos[1] + 0.8 + 0.25 * Math.sin(this.elapsed * 2.2 + vis.phase);
        vis.group.position.set(m.pos[0], floatY, m.pos[2]);
        vis.group.rotation.y = this.elapsed * 1.8 + vis.phase;
        vis.group.visible = true;
      }
    }

    for (const [id, vis] of this.motes.entries()) {
      if (!this.seenIds.has(id)) {
        this.scene.remove(vis.group);
        this.motes.delete(id);
      }
    }
  }

  private syncShades(shadeStates: readonly ShadeState[], alpha: number, paused: boolean): void {
    this.seenIds.clear();
    for (let i = 0; i < shadeStates.length; i++) {
      const s = shadeStates[i];
      this.seenIds.add(s.id);
      let vis = this.shades.get(s.id);
      if (!vis) {
        vis = this.createShadeVisual(s.id, s.pos);
        this.shades.set(s.id, vis);
      }

      if (paused) {
        vis.prevX = s.pos[0];
        vis.prevY = s.pos[1];
        vis.prevZ = s.pos[2];
        vis.currX = s.pos[0];
        vis.currY = s.pos[1];
        vis.currZ = s.pos[2];
      }

      const sx = vis.prevX + (vis.currX - vis.prevX) * alpha;
      const sy = vis.prevY + (vis.currY - vis.prevY) * alpha;
      const sz = vis.prevZ + (vis.currZ - vis.prevZ) * alpha;

      const hoverY = sy + Math.sin(this.elapsed * 3.4 + vis.phase) * 0.14;
      vis.group.position.set(sx, hoverY, sz);

      const dx = this.lastPlayerX - sx;
      const dz = this.lastPlayerZ - sz;
      if (dx * dx + dz * dz > 0.001) {
        vis.group.rotation.y = Math.atan2(dx, dz);
      }

      // Reset default transform before applying state visuals
      vis.group.scale.setScalar(1);
      vis.bodyMesh.rotation.set(0, 0, 0);
      vis.stunHalo.visible = false;
      vis.spawnRing.visible = false;

      if (s.state === "spawning") {
        const pulseScale = 0.45 + 0.45 * Math.abs(Math.sin(this.elapsed * 8 + vis.phase));
        vis.group.scale.set(pulseScale, pulseScale, pulseScale);
        vis.bodyMat.color.setHex(PALETTE.shadeBody);
        vis.bodyMat.emissive.setHex(PALETTE.shadeOutline);
        vis.bodyMat.emissiveIntensity = 0.9;
        vis.eyeLeftMat.color.setHex(PALETTE.shadeOutline);
        vis.eyeRightMat.color.setHex(PALETTE.shadeOutline);
        vis.spawnRing.visible = true;
        vis.spawnRing.scale.setScalar(0.8 + 0.5 * Math.sin(this.elapsed * 10));
      } else if (s.state === "stunned") {
        vis.bodyMat.color.setHex(PALETTE.shadeStunned);
        vis.bodyMat.emissive.setHex(PALETTE.shadeStunned);
        vis.bodyMat.emissiveIntensity = 0.42;
        vis.eyeLeftMat.color.setHex(PALETTE.gold);
        vis.eyeRightMat.color.setHex(PALETTE.gold);
        vis.stunHalo.visible = true;
        vis.stunHalo.rotation.z = this.elapsed * 4.2;
        vis.bodyMesh.rotation.z = Math.sin(this.elapsed * 18) * 0.16;
      } else if (s.state === "recoil") {
        vis.bodyMat.color.setHex(PALETTE.shadeBody);
        vis.bodyMat.emissive.setHex(PALETTE.dangerUi);
        vis.bodyMat.emissiveIntensity = 0.55;
        vis.eyeLeftMat.color.setHex(PALETTE.dangerUi);
        vis.eyeRightMat.color.setHex(PALETTE.dangerUi);
        vis.bodyMesh.rotation.x = -0.35;
      } else if (s.state === "chase") {
        vis.bodyMat.color.setHex(PALETTE.shadeBody);
        vis.bodyMat.emissive.setHex(PALETTE.shadeOutline);
        vis.bodyMat.emissiveIntensity = 0.48;
        vis.eyeLeftMat.color.setHex(PALETTE.shadeOutline);
        vis.eyeRightMat.color.setHex(PALETTE.shadeOutline);
        vis.bodyMesh.rotation.x = 0.18;
      } else {
        // wander
        vis.bodyMat.color.setHex(PALETTE.shadeBody);
        vis.bodyMat.emissive.setHex(PALETTE.shadeOutline);
        vis.bodyMat.emissiveIntensity = 0.2;
        vis.eyeLeftMat.color.setHex(PALETTE.shadeOutline);
        vis.eyeRightMat.color.setHex(PALETTE.shadeOutline);
      }
    }

    for (const [id, vis] of this.shades.entries()) {
      if (!this.seenIds.has(id)) {
        this.scene.remove(vis.group);
        vis.bodyMat.dispose();
        vis.eyeLeftMat.dispose();
        vis.eyeRightMat.dispose();
        this.shades.delete(id);
      }
    }
  }

  private syncDrifters(drifterStates: readonly DrifterState[]): void {
    this.seenIds.clear();
    for (let i = 0; i < drifterStates.length; i++) {
      const d = drifterStates[i];
      this.seenIds.add(d.id);
      let vis = this.drifters.get(d.id);
      if (!vis) {
        vis = this.createDrifterVisual(d.id);
        this.drifters.set(d.id, vis);
      }

      const hoverY = d.pos[1] + Math.sin(this.elapsed * 4.0 + vis.phase) * 0.22;
      vis.group.position.set(d.pos[0], hoverY, d.pos[2]);

      const dx = this.lastPlayerX - d.pos[0];
      const dz = this.lastPlayerZ - d.pos[2];
      if (dx * dx + dz * dz > 0.001) {
        const toPlayerYaw = Math.atan2(dx, dz);
        vis.group.rotation.y = d.state === "flee" ? toPlayerYaw + Math.PI : toPlayerYaw;
      }

      const waveSpeed = d.state === "idle" ? 5.0 : 12.0;
      for (let s = 0; s < vis.segments.length; s++) {
        const seg = vis.segments[s];
        seg.position.x = Math.sin(this.elapsed * waveSpeed - s * 0.9 + vis.phase) * (0.14 + s * 0.05);
        seg.position.y = Math.cos(this.elapsed * (waveSpeed * 0.7) - s * 0.7 + vis.phase) * 0.08;
      }

      if (d.state === "chase") {
        vis.ribbonMat.emissive.setHex(PALETTE.gold);
        vis.ribbonMat.emissiveIntensity = 0.55;
      } else if (d.state === "flee") {
        vis.ribbonMat.emissive.setHex(PALETTE.moteHalo);
        vis.ribbonMat.emissiveIntensity = d.stolen > 0 ? 0.75 : 0.3;
      } else {
        vis.ribbonMat.emissive.setHex(PALETTE.drifter);
        vis.ribbonMat.emissiveIntensity = 0.35;
      }

      for (let k = 0; k < vis.lootOrbs.length; k++) {
        const orb = vis.lootOrbs[k];
        if (k < d.stolen) {
          orb.visible = true;
          const a = this.elapsed * 5 + k * 2.1;
          orb.position.set(Math.cos(a) * 0.42, 0.22 + Math.sin(a) * 0.1, -0.4 - k * 0.35);
        } else {
          orb.visible = false;
        }
      }
    }

    for (const [id, vis] of this.drifters.entries()) {
      if (!this.seenIds.has(id)) {
        this.scene.remove(vis.group);
        vis.ribbonMat.dispose();
        this.drifters.delete(id);
      }
    }
  }

  private syncCharms(charmStates: readonly CharmState[]): void {
    this.seenIds.clear();
    for (let i = 0; i < charmStates.length; i++) {
      const c = charmStates[i];
      this.seenIds.add(c.id);
      let vis = this.charms.get(c.id);
      if (!vis) {
        vis = this.createCharmVisual(c);
        this.charms.set(c.id, vis);
      }
      vis.group.position.set(c.pos[0], c.pos[1], c.pos[2]);
      vis.talismanGroup.visible = c.available;
      vis.respawnRing.visible = !c.available;

      if (c.available) {
        vis.talismanGroup.position.y = 1.15 + Math.sin(this.elapsed * 2.8) * 0.18;
        vis.talismanGroup.rotation.y = this.elapsed * 1.9;
      } else {
        vis.respawnRing.rotation.z = this.elapsed * 1.2;
      }
    }

    for (const [id, vis] of this.charms.entries()) {
      if (!this.seenIds.has(id)) {
        this.scene.remove(vis.group);
        this.charms.delete(id);
      }
    }
  }

  private updateJumpPads(dtSec: number): void {
    if (dtSec <= 0) return;
    const pulse = 1 + Math.sin(this.elapsed * 4.5) * 0.08;
    for (let i = 0; i < this.jumpPadRings.length; i++) {
      this.jumpPadRings[i].scale.setScalar(pulse);
    }
  }

  private updateWindLeaves(
    snapshot: SimSnapshot,
    playerPos: readonly [number, number, number],
    dtSec: number
  ): void {
    const phase = snapshot.sim_tick % 1800;
    const warning = snapshot.night === 3 && snapshot.sim_tick >= 1680 && phase >= 1680;
    const active = snapshot.wind.active;
    const show = warning || active;

    if (!show) {
      for (let i = 0; i < this.windLeaves.length; i++) {
        this.windLeaves[i].mesh.visible = false;
      }
      return;
    }

    const rad = (snapshot.wind.dir_deg * Math.PI) / 180;
    const wx = Math.cos(rad);
    const wz = Math.sin(rad);
    const speedMult = active ? 1.55 : 0.9;
    const [px, py, pz] = playerPos;

    for (let i = 0; i < this.windLeaves.length; i++) {
      const leaf = this.windLeaves[i];
      leaf.mesh.visible = true;
      leaf.offsetX += wx * leaf.speed * speedMult * dtSec;
      leaf.offsetZ += wz * leaf.speed * speedMult * dtSec;

      // Wrap around a 32x32 box centered on the player
      if (leaf.offsetX > 16) leaf.offsetX -= 32;
      else if (leaf.offsetX < -16) leaf.offsetX += 32;
      if (leaf.offsetZ > 16) leaf.offsetZ -= 32;
      else if (leaf.offsetZ < -16) leaf.offsetZ += 32;

      const flutterY = Math.sin(this.elapsed * 6 + leaf.phase) * 0.35;
      leaf.mesh.position.set(px + leaf.offsetX, py + leaf.offsetY + flutterY, pz + leaf.offsetZ);
      leaf.mesh.rotation.set(
        this.elapsed * 4 + leaf.phase,
        this.elapsed * 5 + leaf.phase,
        this.elapsed * 3
      );
    }
  }

  private updatePulseWaves(dtSec: number): void {
    for (let i = 0; i < this.pulseWaves.length; i++) {
      const w = this.pulseWaves[i];
      if (!w.active) continue;
      w.age += dtSec;
      const t = w.age / w.duration;
      if (t >= 1) {
        w.active = false;
        w.mesh.visible = false;
        continue;
      }
      const radius = 0.5 + (PULSE_RADIUS - 0.5) * (1 - Math.pow(1 - t, 2));
      w.mesh.scale.setScalar(radius);
      w.mat.opacity = (1 - t) * 0.85;
    }
  }

  private applyCameraOrbit(camYawDeg: number, camPitchDeg: number): void {
    const theta = (camYawDeg * Math.PI) / 180;
    const phi = (camPitchDeg * Math.PI) / 180;
    const lookY = this.cameraTarget.y + CAMERA_LOOK_HEIGHT;
    const horizontalDist = CAMERA_ORBIT_RADIUS * Math.cos(phi);
    const verticalOffset = CAMERA_ORBIT_RADIUS * Math.sin(phi);

    this.cameraLook.set(this.cameraTarget.x, lookY, this.cameraTarget.z);
    this.cameraPos.set(
      this.cameraTarget.x - Math.sin(theta) * horizontalDist,
      Math.max(CAMERA_MIN_Y + this.cameraTarget.y * 0.5, lookY + verticalOffset),
      this.cameraTarget.z - Math.cos(theta) * horizontalDist
    );

    this.camera.position.copy(this.cameraPos);
    this.camera.lookAt(this.cameraLook);
  }

  private updateCamera(
    playerPos: readonly [number, number, number],
    camYawDeg: number,
    camPitchDeg: number,
    dtSec: number,
    paused: boolean
  ): void {
    if (!paused && dtSec > 0) {
      const followAlpha = 1 - Math.exp(-CAMERA_FOLLOW_SMOOTH * dtSec);
      this.cameraTarget.x += (playerPos[0] - this.cameraTarget.x) * followAlpha;
      this.cameraTarget.y += (playerPos[1] - this.cameraTarget.y) * followAlpha;
      this.cameraTarget.z += (playerPos[2] - this.cameraTarget.z) * followAlpha;
    }

    // Both camera position and look-at derive from the same smoothed target,
    // while yaw/pitch apply immediately for responsive mouse look with zero shake.
    this.applyCameraOrbit(camYawDeg, camPitchDeg);
  }

  private readonly handleResize = (): void => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };
}
