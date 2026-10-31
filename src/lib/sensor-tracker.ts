export interface OrientationState {
  azimuth: number; // 0 to 360 degrees (compass / yaw)
  elevation: number; // 0 to 90 degrees (pitch relative to horizontal table)
  roll: number; // -180 to 180 degrees
  isCalibrated: boolean;
  angularVelocity: number; // deg/sec for "Move slower" warning
}

export type OrientationCallback = (state: OrientationState) => void;

export class SensorTracker {
  private listener: ((e: DeviceOrientationEvent) => void) | null = null;
  private motionListener: ((e: DeviceMotionEvent) => void) | null = null;
  private callbacks: Set<OrientationCallback> = new Set();

  private currentAzimuth = 0;
  private currentElevation = 25;
  private currentRoll = 0;
  private initialAlpha: number | null = null;
  private lastAlpha: number = 0;
  private lastTimestamp = Date.now();
  private angularSpeed = 0;
  private isCalibrated = false;

  public subscribe(cb: OrientationCallback): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  public async requestPermission(): Promise<boolean> {
    if (
      typeof window !== 'undefined' &&
      typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === 'function'
    ) {
      try {
        const response = await (DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission();
        return response === 'granted';
      } catch (err) {
        console.warn('Orientation permission error:', err);
        return false;
      }
    }
    return true; // Non-iOS browsers do not require explicit prompt
  }

  public start(): void {
    if (this.listener) return;

    this.listener = (e: DeviceOrientationEvent) => {
      let alpha = e.alpha ?? 0;
      let beta = e.beta ?? 25; // Pitch (-180 to 180)
      let gamma = e.gamma ?? 0; // Roll (-90 to 90)

      if (this.initialAlpha === null && alpha !== 0) {
        this.initialAlpha = alpha;
      }

      // Compute relative azimuth from starting direction so 0° is the angle user started facing
      let relativeAzimuth = 0;
      if (this.initialAlpha !== null) {
        relativeAzimuth = (alpha - this.initialAlpha + 360) % 360;
      } else {
        relativeAzimuth = alpha;
      }

      // Compute elevation: when phone camera is horizontal facing product, beta is around 70°-90°
      // If user looks down from above (top scan), beta goes towards 0° or 20° depending on orientation
      // We clamp elevation from 5° (low eye-level) to 85° (overhead)
      let elevationDeg = 25;
      if (beta !== null) {
        // Typically upright phone in portrait: beta ~ 70-85 is low pass, beta ~ 20-40 is top pass
        elevationDeg = Math.max(5, Math.min(85, 90 - Math.abs(beta - 80)));
      }

      // Calculate angular velocity for "Move slower" guidance
      const now = Date.now();
      const dt = Math.max(0.016, (now - this.lastTimestamp) / 1000);
      let dAlpha = Math.abs(alpha - this.lastAlpha);
      if (dAlpha > 180) dAlpha = 360 - dAlpha;
      const speed = dAlpha / dt;
      this.angularSpeed = this.angularSpeed * 0.7 + speed * 0.3; // Low pass filter

      this.lastAlpha = alpha;
      this.lastTimestamp = now;

      // Smooth azimuth and elevation
      this.currentAzimuth = (this.currentAzimuth * 0.6 + relativeAzimuth * 0.4 + 360) % 360;
      this.currentElevation = this.currentElevation * 0.8 + elevationDeg * 0.2;
      this.currentRoll = gamma;
      this.isCalibrated = true;

      const state: OrientationState = {
        azimuth: this.currentAzimuth,
        elevation: this.currentElevation,
        roll: this.currentRoll,
        isCalibrated: this.isCalibrated,
        angularVelocity: this.angularSpeed,
      };

      for (const cb of this.callbacks) {
        cb(state);
      }
    };

    window.addEventListener('deviceorientation', this.listener, true);
  }

  public stop(): void {
    if (this.listener) {
      window.removeEventListener('deviceorientation', this.listener, true);
      this.listener = null;
    }
  }

  public resetCalibration(): void {
    this.initialAlpha = null;
  }
}

export const sensorTracker = new SensorTracker();
