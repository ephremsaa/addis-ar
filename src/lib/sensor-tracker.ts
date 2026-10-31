export interface OrientationState {
  azimuth: number; // 0 to 360 degrees (compass / yaw)
  elevation: number; // 0 to 90 degrees (pitch relative to horizontal table)
  roll: number; // -180 to 180 degrees
  isCalibrated: boolean;
  angularVelocity: number; // deg/sec for "Move slower" warning
  trackingSource: 'sensors' | 'optical' | 'hybrid';
}

export type OrientationCallback = (state: OrientationState) => void;

export class SensorTracker {
  private listener: ((e: DeviceOrientationEvent) => void) | null = null;
  private callbacks: Set<OrientationCallback> = new Set();

  private currentAzimuth = 0;
  private currentElevation = 30;
  private currentRoll = 0;
  private initialAlpha: number | null = null;
  private lastAlpha: number = 0;
  private lastTimestamp = Date.now();
  private angularSpeed = 0;
  private hasSensorData = false;

  // Optical flow motion tracking from video
  private prevFrameData: Uint8Array | null = null;
  private opticalCanvas: HTMLCanvasElement | null = null;
  private opticalCtx: CanvasRenderingContext2D | null = null;
  private integratedOpticalAzimuth = 0;

  constructor() {
    if (typeof document !== 'undefined') {
      this.opticalCanvas = document.createElement('canvas');
      this.opticalCanvas.width = 64;
      this.opticalCanvas.height = 48;
      this.opticalCtx = this.opticalCanvas.getContext('2d', { willReadFrequently: true });
    }
  }

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
    return true;
  }

  public start(): void {
    if (this.listener) return;

    this.listener = (e: DeviceOrientationEvent) => {
      // Check if real sensor numbers are delivered
      if (e.alpha === null && e.beta === null) return;

      this.hasSensorData = true;
      let alpha = e.alpha ?? 0;
      let beta = e.beta ?? 30; // Pitch
      let gamma = e.gamma ?? 0; // Roll

      if (this.initialAlpha === null && alpha !== 0) {
        this.initialAlpha = alpha;
      }

      let relativeAzimuth = 0;
      if (this.initialAlpha !== null) {
        relativeAzimuth = (alpha - this.initialAlpha + 360) % 360;
      } else {
        relativeAzimuth = alpha;
      }

      // Convert portrait beta (typically 75° facing table) to elevation relative to table
      let elevationDeg = 30;
      if (beta !== null) {
        elevationDeg = Math.max(10, Math.min(85, 90 - Math.abs(beta - 75)));
      }

      // Angular velocity
      const now = Date.now();
      const dt = Math.max(0.016, (now - this.lastTimestamp) / 1000);
      let dAlpha = Math.abs(alpha - this.lastAlpha);
      if (dAlpha > 180) dAlpha = 360 - dAlpha;
      const speed = dAlpha / dt;
      this.angularSpeed = this.angularSpeed * 0.7 + speed * 0.3;

      this.lastAlpha = alpha;
      this.lastTimestamp = now;

      // Smooth azimuth and elevation
      this.currentAzimuth = (this.currentAzimuth * 0.6 + relativeAzimuth * 0.4 + 360) % 360;
      this.currentElevation = this.currentElevation * 0.75 + elevationDeg * 0.25;
      this.currentRoll = gamma;

      this.notify();
    };

    window.addEventListener('deviceorientation', this.listener, true);
  }

  /**
   * Optical Motion Tracker: tracks horizontal scene displacement from the camera feed.
   * If gyroscope is unavailable, this tracks the user walking around the product!
   */
  public processVideoFrame(video: HTMLVideoElement): void {
    if (!this.opticalCanvas || !this.opticalCtx || video.readyState < 2) return;

    const w = 64;
    const h = 48;
    this.opticalCtx.drawImage(video, 0, 0, w, h);
    const imgData = this.opticalCtx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // Create 1D horizontal intensity projection
    const colSum = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = 10; y < h - 10; y++) {
        const idx = (y * w + x) * 4;
        sum += 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      }
      colSum[x] = sum / (h - 20);
    }

    if (this.prevFrameData) {
      // Find 1D cross-correlation shift between -8 and +8 pixels
      let bestShift = 0;
      let minDiff = Infinity;

      for (let shift = -8; shift <= 8; shift++) {
        let diff = 0;
        let count = 0;
        for (let x = 10; x < w - 10; x++) {
          const prevX = x + shift;
          if (prevX >= 0 && prevX < w) {
            diff += Math.abs(colSum[x] - this.prevFrameData[prevX]);
            count++;
          }
        }
        if (count > 0) {
          const avgDiff = diff / count;
          if (avgDiff < minDiff) {
            minDiff = avgDiff;
            bestShift = shift;
          }
        }
      }

      // Convert pixel shift to angular degrees (around 0.8 degrees per pixel at this scale)
      if (Math.abs(bestShift) >= 1 && Math.abs(bestShift) <= 7) {
        const dAngle = bestShift * 0.85;
        this.integratedOpticalAzimuth = (this.integratedOpticalAzimuth + dAngle + 360) % 360;

        // If gyroscope is missing, drive azimuth via optical flow
        if (!this.hasSensorData) {
          this.currentAzimuth = this.integratedOpticalAzimuth;
          this.notify();
        }
      }
    }

    // Save previous frame projection
    if (!this.prevFrameData) {
      this.prevFrameData = new Uint8Array(w);
    }
    for (let x = 0; x < w; x++) {
      this.prevFrameData[x] = Math.min(255, colSum[x]);
    }
  }

  /**
   * Manually step azimuth to the next angle (e.g. on manual capture)
   */
  public stepAngle(degrees = 30): void {
    this.currentAzimuth = (this.currentAzimuth + degrees + 360) % 360;
    this.notify();
  }

  public setElevation(deg: number): void {
    this.currentElevation = Math.max(10, Math.min(85, deg));
    this.notify();
  }

  private notify(): void {
    const state: OrientationState = {
      azimuth: this.currentAzimuth,
      elevation: this.currentElevation,
      roll: this.currentRoll,
      isCalibrated: this.hasSensorData || this.prevFrameData !== null,
      angularVelocity: this.angularSpeed,
      trackingSource: this.hasSensorData ? 'sensors' : 'optical',
    };

    for (const cb of this.callbacks) {
      cb(state);
    }
  }

  public stop(): void {
    if (this.listener) {
      window.removeEventListener('deviceorientation', this.listener, true);
      this.listener = null;
    }
    this.prevFrameData = null;
  }

  public resetCalibration(): void {
    this.initialAlpha = null;
    this.currentAzimuth = 0;
    this.integratedOpticalAzimuth = 0;
  }
}

export const sensorTracker = new SensorTracker();
