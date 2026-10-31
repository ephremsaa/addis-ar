/**
 * Addis AR · Dual Sensor Fusion & 360° Camera Orbit Tracker
 * Combines DeviceOrientation gyro sensors with real-time 2D Optical Flow motion tracking.
 * Ensures smooth, reliable 360° angle tracking even if hardware gyro is uncalibrated or blocked.
 */

export interface OrientationState {
  azimuth: number; // 0 to 360 degrees
  elevation: number; // 0 to 90 degrees
  roll: number; // -180 to 180 degrees
  isCalibrated: boolean;
  angularVelocity: number; // deg/sec
  trackingSource: 'sensors' | 'optical' | 'hybrid';
}

export type OrientationCallback = (state: OrientationState) => void;

export class SensorTracker {
  private listener: ((e: DeviceOrientationEvent) => void) | null = null;
  private callbacks: Set<OrientationCallback> = new Set();

  private currentAzimuth = 0;
  private currentElevation = 35;
  private currentRoll = 0;
  private initialAlpha: number | null = null;
  private lastAlpha: number = 0;
  private lastAlphaTimestamp = Date.now();
  private alphaVarianceHistory: number[] = [];
  private hasActiveSensor = false;

  private lastTimestamp = Date.now();
  private angularSpeed = 0;

  // Optical flow motion tracking
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
    cb(this.getState());
    return () => {
      this.callbacks.delete(cb);
    };
  }

  public async requestPermission(): Promise<boolean> {
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
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
      const alpha = e.alpha;
      const beta = e.beta;
      const gamma = e.gamma;

      // If alpha is valid number and updating
      if (alpha !== null && alpha !== undefined) {
        const now = Date.now();
        const dt = Math.max(0.016, (now - this.lastTimestamp) / 1000);

        // Check if alpha actually varies over time
        const dAlphaRaw = Math.abs(alpha - this.lastAlpha);
        const dAlpha = dAlphaRaw > 180 ? 360 - dAlphaRaw : dAlphaRaw;

        this.alphaVarianceHistory.push(dAlpha);
        if (this.alphaVarianceHistory.length > 20) {
          this.alphaVarianceHistory.shift();
        }
        const totalVariance = this.alphaVarianceHistory.reduce((a, b) => a + b, 0);

        // Has active gyro if variance > 0.5 degrees
        this.hasActiveSensor = totalVariance > 0.5;

        if (this.initialAlpha === null) {
          this.initialAlpha = alpha;
        }

        const relativeAzimuth = (alpha - this.initialAlpha + 360) % 360;

        // Elevation from pitch (beta: 0=flat, 90=upright)
        let elevationDeg = 35;
        if (beta !== null) {
          elevationDeg = Math.max(10, Math.min(85, 90 - Math.abs(beta - 65)));
        }

        // Angular speed
        const speed = dAlpha / dt;
        this.angularSpeed = this.angularSpeed * 0.7 + speed * 0.3;

        this.lastAlpha = alpha;
        this.lastTimestamp = now;

        // If sensor is active, use it for azimuth
        if (this.hasActiveSensor) {
          this.currentAzimuth = (this.currentAzimuth * 0.6 + relativeAzimuth * 0.4 + 360) % 360;
        }

        this.currentElevation = this.currentElevation * 0.75 + elevationDeg * 0.25;
        if (gamma !== null) {
          this.currentRoll = gamma;
        }

        this.notify();
      }
    };

    window.addEventListener('deviceorientation', this.listener, true);
  }

  /**
   * Real-time 2D Optical Flow Motion Tracker.
   * Tracks camera orbit displacement from video frames.
   * Seamlessly drives azimuth when walking around product!
   */
  public processVideoFrame(video: HTMLVideoElement): void {
    if (!this.opticalCanvas || !this.opticalCtx || video.readyState < 2) return;

    const w = 64;
    const h = 48;
    this.opticalCtx.drawImage(video, 0, 0, w, h);
    const imgData = this.opticalCtx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // 1D horizontal intensity projection
    const colSum = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = 8; y < h - 8; y++) {
        const idx = (y * w + x) * 4;
        sum += 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      }
      colSum[x] = sum / (h - 16);
    }

    if (this.prevFrameData) {
      // Find 1D cross-correlation shift between -8 and +8 pixels
      let bestShift = 0;
      let minDiff = Infinity;

      for (let shift = -8; shift <= 8; shift++) {
        let diff = 0;
        let count = 0;
        for (let x = 8; x < w - 8; x++) {
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

      // Convert pixel shift to orbit angle (orbiting around center object)
      if (Math.abs(bestShift) >= 1 && Math.abs(bestShift) <= 7) {
        const dAngle = bestShift * 1.2;
        this.integratedOpticalAzimuth = (this.integratedOpticalAzimuth + dAngle + 360) % 360;

        // If hardware gyro is static, let optical flow drive azimuth!
        if (!this.hasActiveSensor) {
          this.currentAzimuth = (this.currentAzimuth * 0.7 + this.integratedOpticalAzimuth * 0.3 + 360) % 360;
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

  public calibrateFront(): void {
    this.initialAlpha = this.lastAlpha;
    this.currentAzimuth = 0;
    this.integratedOpticalAzimuth = 0;
    this.notify();
  }

  public setAzimuth(deg: number): void {
    this.currentAzimuth = (deg + 360) % 360;
    this.integratedOpticalAzimuth = this.currentAzimuth;
    this.notify();
  }

  public stepAngle(degrees = 30): void {
    this.currentAzimuth = (this.currentAzimuth + degrees + 360) % 360;
    this.integratedOpticalAzimuth = this.currentAzimuth;
    this.notify();
  }

  public setElevation(deg: number): void {
    this.currentElevation = Math.max(10, Math.min(85, deg));
    this.notify();
  }

  private getState(): OrientationState {
    return {
      azimuth: this.currentAzimuth,
      elevation: this.currentElevation,
      roll: this.currentRoll,
      isCalibrated: this.hasActiveSensor || this.prevFrameData !== null,
      angularVelocity: this.angularSpeed,
      trackingSource: this.hasActiveSensor ? 'sensors' : 'optical',
    };
  }

  private notify(): void {
    const state = this.getState();
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
    this.alphaVarianceHistory = [];
    this.hasActiveSensor = false;
  }
}

export const sensorTracker = new SensorTracker();
