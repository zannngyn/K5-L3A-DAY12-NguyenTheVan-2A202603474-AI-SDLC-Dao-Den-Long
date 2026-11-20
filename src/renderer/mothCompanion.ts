import * as THREE from "three";
import type { SimEvent, SimSnapshot } from "../sim";
import { PALETTE } from "./palette";

interface SparkleParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

const CARRY_CAPACITY = 10;
const MAX_SPARKLES = 24;

/**
 * Creativity Feature: Lantern Moth Companion ("Bướm Đèn").
 * Purely visual 3D client layer — reads SimSnapshot & SimEvent[] only,
 * never mutates Sim or touches Sim's PRNG, and is never imported in headless mode.
 * Uses emissive meshes (no extra PointLight) to honor the 4-PointLight scene budget.
 */
export class MothCompanion {
  private readonly root = new THREE.Group();
  private readonly mothGroup = new THREE.Group();
  private readonly leftWing: THREE.Mesh;
  private readonly rightWing: THREE.Mesh;
  private readonly sparkles: SparkleParticle[] = [];
  private readonly currentPos = new THREE.Vector3(0.8, 2.1, 0.4);
  private readonly targetPos = new THREE.Vector3();

  private elapsed = 0;
  private trailTimer = 0;
  private burstRemaining = 0;

  constructor(scene: THREE.Scene) {
    // Moth body (tiny glowing golden spindle)
    const bodyGeo = new THREE.CapsuleGeometry(0.045, 0.14, 4, 8);
    bodyGeo.rotateX(Math.PI / 2);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: PALETTE.gold,
      emissive: PALETTE.litLantern,
      emissiveIntensity: 1.6,
      roughness: 0.3,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    this.mothGroup.add(body);

    // Paper wings (primitive flattened cones)
    const wingGeo = new THREE.ConeGeometry(0.18, 0.28, 3);
    wingGeo.scale(1.0, 1.0, 0.12);
    const wingMat = new THREE.MeshStandardMaterial({
      color: PALETTE.moteCore,
      emissive: PALETTE.litLantern,
      emissiveIntensity: 1.25,
      roughness: 0.4,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
    });

    this.leftWing = new THREE.Mesh(wingGeo, wingMat);
    this.leftWing.position.set(-0.12, 0.02, 0);
    this.leftWing.rotation.z = Math.PI / 2;
    this.mothGroup.add(this.leftWing);

    this.rightWing = new THREE.Mesh(wingGeo, wingMat);
    this.rightWing.position.set(0.12, 0.02, 0);
    this.rightWing.rotation.z = -Math.PI / 2;
    this.mothGroup.add(this.rightWing);

    this.mothGroup.position.copy(this.currentPos);
    this.root.add(this.mothGroup);

    // Pre-allocate sparkle trail pool (shared geometry)
    const sparkleGeo = new THREE.OctahedronGeometry(0.055, 0);
    for (let i = 0; i < MAX_SPARKLES; i++) {
      const sparkleMat = new THREE.MeshBasicMaterial({
        color: PALETTE.moteHalo,
        transparent: true,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(sparkleGeo, sparkleMat);
      mesh.visible = false;
      this.root.add(mesh);
      this.sparkles.push({
        mesh,
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 0.7,
      });
    }

    scene.add(this.root);
  }

  public reset(playerPos: [number, number, number]): void {
    this.currentPos.set(playerPos[0] + 0.8, playerPos[1] + 2.1, playerPos[2] + 0.4);
    this.mothGroup.position.copy(this.currentPos);
    this.burstRemaining = 0;
    for (const p of this.sparkles) {
      p.life = 0;
      p.mesh.visible = false;
    }
  }

  public onEvents(events: readonly SimEvent[]): void {
    for (const ev of events) {
      if (ev.name === "lantern_lit" || ev.name === "pulse" || ev.name === "charm_picked") {
        this.burstRemaining = Math.max(this.burstRemaining, 0.9);
        this.emitSparkles(8);
      }
    }
  }

  public update(snapshot: SimSnapshot, dtSec: number): void {
    this.elapsed += dtSec;
    const [px, py, pz] = snapshot.player.pos;

    // Guide toward nearest unlit lantern when carrying a full load (10 motes)
    let guideLantern: [number, number, number] | null = null;
    if (snapshot.player.carried >= CARRY_CAPACITY) {
      let bestDistSq = Infinity;
      for (const l of snapshot.lanterns) {
        if (l.lit) continue;
        const dx = l.pos[0] - px;
        const dz = l.pos[2] - pz;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          guideLantern = l.pos;
        }
      }
    }

    if (guideLantern) {
      const dx = guideLantern[0] - px;
      const dz = guideLantern[2] - pz;
      const dist = Math.hypot(dx, dz);
      const lead = Math.min(3.2, Math.max(1.2, dist * 0.45));
      const nx = dist > 0.001 ? dx / dist : 0;
      const nz = dist > 0.001 ? dz / dist : 1;
      const sway = Math.sin(this.elapsed * 4.2) * 0.45;
      const sx = -nz * sway;
      const sz = nx * sway;

      this.targetPos.set(
        px + nx * lead + sx,
        py + 2.0 + Math.sin(this.elapsed * 5.0) * 0.25,
        pz + nz * lead + sz
      );
    } else {
      const angle = this.elapsed * 1.65;
      const radius = 0.95 + Math.sin(this.elapsed * 1.1) * 0.15;
      this.targetPos.set(
        px + Math.cos(angle) * radius,
        py + 2.15 + Math.sin(this.elapsed * 3.1) * 0.18,
        pz + Math.sin(angle) * radius
      );
    }

    const prevX = this.currentPos.x;
    const prevZ = this.currentPos.z;
    const lerpAlpha = 1 - Math.exp(-5.5 * dtSec);
    this.currentPos.lerp(this.targetPos, lerpAlpha);
    this.mothGroup.position.copy(this.currentPos);

    const vx = this.currentPos.x - prevX;
    const vz = this.currentPos.z - prevZ;
    if (vx * vx + vz * vz > 1e-6) {
      this.mothGroup.rotation.y = Math.atan2(vx, vz);
    }

    const flapSpeed = guideLantern || this.burstRemaining > 0 ? 22 : 13;
    const flap = Math.sin(this.elapsed * flapSpeed) * 0.65;
    this.leftWing.rotation.z = Math.PI / 2 + flap;
    this.rightWing.rotation.z = -Math.PI / 2 - flap;

    if (this.burstRemaining > 0) {
      this.burstRemaining = Math.max(0, this.burstRemaining - dtSec);
      this.trailTimer += dtSec;
      if (this.trailTimer >= 0.05) {
        this.trailTimer = 0;
        this.emitSparkles(2);
      }
    } else if (guideLantern) {
      this.trailTimer += dtSec;
      if (this.trailTimer >= 0.16) {
        this.trailTimer = 0;
        this.emitSparkles(1);
      }
    }

    for (const p of this.sparkles) {
      if (p.life <= 0) continue;
      p.life -= dtSec;
      if (p.life <= 0) {
        p.mesh.visible = false;
        continue;
      }
      p.mesh.position.addScaledVector(p.vel, dtSec);
      p.mesh.rotation.y += dtSec * 4;
      const ratio = p.life / p.maxLife;
      p.mesh.scale.setScalar(0.4 + ratio * 0.9);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = ratio * 0.9;
    }
  }

  private emitSparkles(count: number): void {
    let spawned = 0;
    for (const p of this.sparkles) {
      if (p.life > 0) continue;
      p.mesh.position.set(
        this.currentPos.x + (Math.random() - 0.5) * 0.25,
        this.currentPos.y + (Math.random() - 0.5) * 0.2,
        this.currentPos.z + (Math.random() - 0.5) * 0.25
      );
      p.vel.set(
        (Math.random() - 0.5) * 0.9,
        0.35 + Math.random() * 0.7,
        (Math.random() - 0.5) * 0.9
      );
      p.maxLife = 0.45 + Math.random() * 0.4;
      p.life = p.maxLife;
      p.mesh.visible = true;
      spawned += 1;
      if (spawned >= count) break;
    }
  }

  public dispose(): void {
    this.root.parent?.remove(this.root);
  }
}
