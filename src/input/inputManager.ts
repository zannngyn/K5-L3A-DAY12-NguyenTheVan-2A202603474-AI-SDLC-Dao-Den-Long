import type { StepInput } from "../sim";

export interface InputCallbacks {
  onFirstInteraction?: () => void;
  onRestartKey?: () => void;
  onPauseKey?: () => void;
  onPointerLockChange?: (locked: boolean) => void;
}

const CAMERA_KEY_YAW_SPEED_DEG = 105; // deg/s for J/K keys
export const MOUSE_SENSITIVITY = 0.22; // base deg per px
const DEFAULT_CAM_PITCH_DEG = 22;
const MIN_CAM_PITCH_DEG = -10;
const MAX_CAM_PITCH_DEG = 60;

/**
 * Keyboard & mouse input manager producing contract-compliant StepInput frames.
 * Preserves pointer-lock mouse look and J/K camera rotation, adds Shift dash,
 * Esc/P pause, and configurable mouse sensitivity.
 */
export class InputManager {
  private readonly target: HTMLElement;
  private readonly callbacks: InputCallbacks;
  private readonly keys = new Set<string>();

  private camYawDeg = 0;
  private camPitchDeg = DEFAULT_CAM_PITCH_DEG;
  private sensitivityMultiplier = 1.0;
  private gameplayActive = false;
  private pointerLocked = false;
  private rightMouseDown = false;
  private interacted = false;

  // Edge latches so brief taps between 60Hz ticks are never missed.
  private pendingJump = false;
  private pendingInteract = false;
  private pendingPulse = false;
  private pendingDash = false;
  private pendingPause = false;

  constructor(target: HTMLElement, callbacks: InputCallbacks = {}) {
    this.target = target;
    this.callbacks = callbacks;
    this.bindEvents();
  }

  public setSensitivity(multiplier: number): void {
    this.sensitivityMultiplier = Math.min(3.0, Math.max(0.2, multiplier));
  }

  public setGameplayActive(active: boolean): void {
    this.gameplayActive = active;
    if (!active) {
      this.keys.clear();
      this.rightMouseDown = false;
      this.pendingJump = false;
      this.pendingInteract = false;
      this.pendingPulse = false;
      this.pendingDash = false;
    }
  }

  public queuePausePulse(): void {
    this.pendingPause = true;
  }

  public getCamYawDeg(): number {
    return this.camYawDeg;
  }

  public getCamPitchDeg(): number {
    return this.camPitchDeg;
  }

  public isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  public resetCameraYaw(deg = 0): void {
    this.camYawDeg = deg;
  }

  public resetCameraPitch(deg = DEFAULT_CAM_PITCH_DEG): void {
    this.camPitchDeg = this.clampPitch(deg);
  }

  public exitPointerLock(): void {
    if (!this.pointerLocked) return;
    try {
      if (typeof document.exitPointerLock === "function") {
        document.exitPointerLock();
      }
    } catch {
      // Ignore if pointer lock exit is unavailable
    }
  }

  public updateCamera(dtSec: number): void {
    if (!this.gameplayActive) return;
    let yawDelta = 0;
    if (this.keys.has("KeyJ")) yawDelta += CAMERA_KEY_YAW_SPEED_DEG * dtSec;
    if (this.keys.has("KeyK")) yawDelta -= CAMERA_KEY_YAW_SPEED_DEG * dtSec;
    if (yawDelta !== 0) {
      this.camYawDeg = this.wrapDeg(this.camYawDeg + yawDelta);
    }
  }

  public consumeStepInput(): StepInput {
    let mx = 0;
    let mz = 0;

    if (this.gameplayActive) {
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) mz += 1;
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) mz -= 1;
      if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) mx += 1;
      if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) mx -= 1;
    }

    const jump = this.gameplayActive && (this.keys.has("Space") || this.pendingJump);
    const interact = this.gameplayActive && (this.keys.has("KeyE") || this.pendingInteract);
    const pulse =
      this.gameplayActive &&
      (this.keys.has("KeyQ") || this.rightMouseDown || this.pendingPulse);
    const dash =
      this.gameplayActive &&
      (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") || this.pendingDash);
    const pause = this.pendingPause;

    this.pendingJump = false;
    this.pendingInteract = false;
    this.pendingPulse = false;
    this.pendingDash = false;
    this.pendingPause = false;

    return {
      move: [mx, mz],
      cam_yaw_deg: this.camYawDeg,
      jump,
      interact,
      pulse,
      dash,
      pause,
    };
  }

  public dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleBlur);
    this.target.removeEventListener("pointerdown", this.handlePointerDown);
    window.removeEventListener("mousemove", this.handleMouseMove);
    window.removeEventListener("pointerup", this.handlePointerUp);
    this.target.removeEventListener("contextmenu", this.handleContextMenu);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
    document.removeEventListener("pointerlockerror", this.handlePointerLockError);
  }

  private notifyFirstInteraction(): void {
    if (!this.interacted) {
      this.interacted = true;
      this.callbacks.onFirstInteraction?.();
    }
  }

  private wrapDeg(deg: number): number {
    let d = deg % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }

  private clampPitch(deg: number): number {
    return Math.min(MAX_CAM_PITCH_DEG, Math.max(MIN_CAM_PITCH_DEG, deg));
  }

  private requestPointerLock(): void {
    const req = this.target.requestPointerLock as
      | (() => Promise<void> | void)
      | undefined;
    if (typeof req !== "function") return;
    try {
      const maybePromise = req.call(this.target);
      if (maybePromise && typeof maybePromise.catch === "function") {
        maybePromise.catch(() => {
          // Pointer lock denied or interrupted — fall back cleanly to J/K
        });
      }
    } catch {
      // Pointer lock unavailable or denied — fall back cleanly to J/K
    }
  }

  private bindEvents(): void {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleBlur);
    this.target.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("mousemove", this.handleMouseMove);
    window.addEventListener("pointerup", this.handlePointerUp);
    this.target.addEventListener("contextmenu", this.handleContextMenu);
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
    document.addEventListener("pointerlockerror", this.handlePointerLockError);
  }

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    this.notifyFirstInteraction();

    if (
      this.gameplayActive &&
      (e.code === "Space" ||
        e.code === "ArrowUp" ||
        e.code === "ArrowDown" ||
        e.code === "ArrowLeft" ||
        e.code === "ArrowRight")
    ) {
      e.preventDefault();
    }

    if (!e.repeat) {
      if (e.code === "Escape" || e.code === "KeyP") {
        this.callbacks.onPauseKey?.();
        return;
      }
      if (this.gameplayActive) {
        if (e.code === "Space") this.pendingJump = true;
        if (e.code === "KeyE") this.pendingInteract = true;
        if (e.code === "KeyQ") this.pendingPulse = true;
        if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.pendingDash = true;
      }
      if (e.code === "KeyR") {
        this.callbacks.onRestartKey?.();
      }
    }

    if (this.gameplayActive) {
      this.keys.add(e.code);
    }
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly handleBlur = (): void => {
    this.keys.clear();
    this.rightMouseDown = false;
  };

  private readonly handlePointerDown = (e: PointerEvent): void => {
    this.notifyFirstInteraction();
    if (!this.gameplayActive) return;
    if (e.button === 0) {
      if (!this.pointerLocked) {
        this.requestPointerLock();
      }
    } else if (e.button === 2) {
      this.rightMouseDown = true;
      this.pendingPulse = true;
    }
  };

  private readonly handleMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked || !this.gameplayActive) return;
    const dx = e.movementX || 0;
    const dy = e.movementY || 0;
    const sens = MOUSE_SENSITIVITY * this.sensitivityMultiplier;
    if (dx !== 0) {
      this.camYawDeg = this.wrapDeg(this.camYawDeg - dx * sens);
    }
    if (dy !== 0) {
      this.camPitchDeg = this.clampPitch(this.camPitchDeg + dy * sens);
    }
  };

  private readonly handlePointerUp = (e: PointerEvent): void => {
    if (e.button === 2) {
      this.rightMouseDown = false;
    }
  };

  private readonly handleContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private readonly handlePointerLockChange = (): void => {
    const locked = document.pointerLockElement === this.target;
    if (locked !== this.pointerLocked) {
      this.pointerLocked = locked;
      this.callbacks.onPointerLockChange?.(locked);
    }
  };

  private readonly handlePointerLockError = (): void => {
    if (this.pointerLocked) {
      this.pointerLocked = false;
    }
    this.callbacks.onPointerLockChange?.(false);
  };
}
