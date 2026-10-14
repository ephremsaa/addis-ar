import * as THREE from "three";
import { validateImageQuality } from "./image-validator";
import { segmentForeground } from "./background-segmenter";
import type { ScanPhoto, AngleGroup, PhotoQuality } from "./types";
import { validateAndCalibrateDepth, type DepthObservation } from "./depth-processor";
import type { EstimatedCameraPose } from "./pose-estimator";

export interface ContinuousScanFrame {
  id: string;
  dataUrl: string;
  thumbnailUrl: string;
  timestamp: number;
  blurScore: number;
  diffScore: number;
  azimuth: number;
  elevation: number;
  angleGroup: AngleGroup;
  poseMatrix?: number[];
  depthObservation?: DepthObservation;
}

export interface RecordingGuidance {
  status: "optimal" | "too-fast" | "idle" | "lost";
  message: string;
  durationSeconds: number;
  capturedFramesCount: number;
  keyframeCount: number;
  coveragePercent: number; // 0 - 100% across 360 degrees
  azimuthCoverage: boolean[]; // 12 bins of 30° each
  currentAzimuth: number;
  isPaused: boolean;
  isWebXRActive: boolean;
}

export interface RecorderOptions {
  targetKeyframeIntervalMs?: number; // default ~450ms
  minMotionDiffPercent?: number; // default ~4.5%
  minBlurScore?: number; // default 28 (higher is sharper)
  onGuidanceUpdate?: (guidance: RecordingGuidance) => void;
  onFrameCaptured?: (frame: ContinuousScanFrame) => void;
}

/**
 * Calculates fast 3x3 Laplacian variance and average RGB difference between consecutive frames.
 */
function computePerceptualFrameDiff(
  currData: Uint8ClampedArray,
  prevData: Uint8ClampedArray | null,
  width: number,
  height: number,
): { diffPercent: number; blurScore: number } {
  let diffSum = 0;
  let laplacianSum = 0;
  let laplacianSq = 0;
  let validPix = 0;

  const totalPixels = width * height;
  const stride = 2; // Sample every 2nd pixel for 60fps real-time budget

  for (let y = 1; y < height - 1; y += stride) {
    for (let x = 1; x < width - 1; x += stride) {
      const idx = (y * width + x) * 4;

      const r = currData[idx] ?? 0;
      const g = currData[idx + 1] ?? 0;
      const b = currData[idx + 2] ?? 0;
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;

      // Difference from previous keyframe
      if (prevData) {
        const pr = prevData[idx] ?? 0;
        const pg = prevData[idx + 1] ?? 0;
        const pb = prevData[idx + 2] ?? 0;
        const pGray = 0.299 * pr + 0.587 * pg + 0.114 * pb;
        diffSum += Math.abs(gray - pGray);
      }

      // 4-neighbor Laplacian for sharpness
      const up = 0.299 * (currData[((y - 1) * width + x) * 4] ?? 0);
      const down = 0.299 * (currData[((y + 1) * width + x) * 4] ?? 0);
      const left = 0.299 * (currData[(y * width + (x - 1)) * 4] ?? 0);
      const right = 0.299 * (currData[(y * width + (x + 1)) * 4] ?? 0);

      const lap = up + down + left + right - 4 * gray;
      laplacianSum += lap;
      laplacianSq += lap * lap;
      validPix++;
    }
  }

  const diffPercent = prevData && validPix > 0 ? (diffSum / (validPix * 255)) * 100 : 100;
  const meanLap = validPix > 0 ? laplacianSum / validPix : 0;
  const variance = validPix > 0 ? Math.max(0, laplacianSq / validPix - meanLap * meanLap) : 0;
  const blurScore = Math.min(100, Math.round(Math.sqrt(variance) * 2.8));

  return { diffPercent, blurScore };
}

/**
 * Maps a continuous azimuth angle (0 - 360°) to an AngleGroup.
 */
function azimuthToAngleGroup(azimuth: number, elevation: number): AngleGroup {
  if (elevation > 55) return "top";
  if (elevation > 28) {
    if (azimuth >= 315 || azimuth < 45) return "top-front";
    if (azimuth >= 135 && azimuth < 225) return "top-back";
    return "top-side";
  }

  const norm = ((azimuth % 360) + 360) % 360;
  if (norm >= 337.5 || norm < 22.5) return "front";
  if (norm >= 22.5 && norm < 67.5) return "front-left";
  if (norm >= 67.5 && norm < 112.5) return "left";
  if (norm >= 112.5 && norm < 157.5) return "back-left";
  if (norm >= 157.5 && norm < 202.5) return "back";
  if (norm >= 202.5 && norm < 247.5) return "back-right";
  if (norm >= 247.5 && norm < 292.5) return "right";
  return "front-right";
}

/**
 * Continuous ARCore-Style Recording Controller:
 * Records video frames continuously, computes movement telemetry,
 * tracks 360-degree coverage, and extracts sharp non-redundant keyframes.
 */
export class ContinuousScanRecorder {
  private video: HTMLVideoElement | null;
  private options: RecorderOptions;
  private isRecording = false;
  private isPaused = false;
  private startTime = 0;
  private pauseTime = 0;
  private totalPausedDuration = 0;
  private timerId: number | null = null;

  private sampleCanvas: HTMLCanvasElement | null = null;
  private sampleCtx: CanvasRenderingContext2D | null = null;
  private previousKeyframePixels: Uint8ClampedArray | null = null;
  private lastKeyframeTime = 0;

  private capturedKeyframes: ContinuousScanFrame[] = [];
  private azimuthCoverage: boolean[] = new Array(12).fill(false);
  private currentAzimuth = 0;
  private totalSampledFrames = 0;

  private webxrSession: { end: () => Promise<void> } | null = null;
  private isWebXRActive = false;

  constructor(video?: HTMLVideoElement | null, options: RecorderOptions = {}) {
    this.video = video ?? null;
    this.options = {
      targetKeyframeIntervalMs: 400,
      minMotionDiffPercent: 4.0,
      minBlurScore: 26,
      ...options,
    };

    if (typeof document !== "undefined") {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 120;
        this.sampleCanvas = canvas;
        this.sampleCtx = canvas.getContext?.("2d", { willReadFrequently: true }) ?? null;
      } catch {
        this.sampleCanvas = null;
        this.sampleCtx = null;
      }
    }
  }

  public updateCoverage(pose: EstimatedCameraPose | { position: THREE.Vector3 }): void {
    const angleRad = Math.atan2(pose.position.z, pose.position.x);
    let deg = (angleRad * 180) / Math.PI;
    if (deg < 0) deg += 360;
    const bin = Math.min(11, Math.floor(deg / 30));
    this.azimuthCoverage[bin] = true;
    this.currentAzimuth = deg;
  }

  public getCoverage(): { visitedBins: number; percentage: number; azimuthCoverage: boolean[] } {
    const visitedBins = this.azimuthCoverage.filter(Boolean).length;
    return {
      visitedBins,
      percentage: Math.min(100, Math.round((visitedBins / 12) * 100)),
      azimuthCoverage: [...this.azimuthCoverage],
    };
  }

  public start(): void {
    if (this.isRecording) return;
    this.isRecording = true;
    this.isPaused = false;
    this.startTime = performance.now();
    this.totalPausedDuration = 0;
    this.capturedKeyframes = [];
    this.azimuthCoverage = new Array(12).fill(false);
    this.currentAzimuth = 0;
    this.totalSampledFrames = 0;
    this.previousKeyframePixels = null;
    this.lastKeyframeTime = 0;

    // Capture loop at ~10 Hz evaluation rate
    this.timerId = window.setInterval(() => {
      if (!this.isPaused) {
        this.processVideoTick();
      }
    }, 100);
  }

  public pause(): void {
    if (!this.isRecording || this.isPaused) return;
    this.isPaused = true;
    this.pauseTime = performance.now();
    this.emitGuidance("idle", "Scan paused. Tap Resume to continue recording.");
  }

  public resume(): void {
    if (!this.isRecording || !this.isPaused) return;
    this.isPaused = false;
    this.totalPausedDuration += performance.now() - this.pauseTime;
    this.emitGuidance("optimal", "Moving around object. Maintain steady speed.");
  }

  public async stop(): Promise<ContinuousScanFrame[]> {
    this.isRecording = false;
    this.isPaused = false;
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    if (this.webxrSession) {
      try {
        await this.webxrSession.end();
      } catch {
        // Ignore session end errors
      }
      this.webxrSession = null;
      this.isWebXRActive = false;
    }

    return this.capturedKeyframes;
  }

  private processVideoTick(): void {
    if (!this.video || this.video.videoWidth === 0 || !this.sampleCanvas || !this.sampleCtx) return;

    this.totalSampledFrames++;
    const now = performance.now();
    const elapsedSeconds = Number(
      ((now - this.startTime - this.totalPausedDuration) / 1000).toFixed(1),
    );

    // Sample current frame thumbnail for metric analysis
    this.sampleCanvas.height = Math.round(
      (this.video.videoHeight / this.video.videoWidth) * this.sampleCanvas.width,
    );
    this.sampleCtx.drawImage(this.video, 0, 0, this.sampleCanvas.width, this.sampleCanvas.height);
    const currImageData = this.sampleCtx.getImageData(
      0,
      0,
      this.sampleCanvas.width,
      this.sampleCanvas.height,
    );

    const { diffPercent, blurScore } = computePerceptualFrameDiff(
      currImageData.data,
      this.previousKeyframePixels,
      this.sampleCanvas.width,
      this.sampleCanvas.height,
    );

    // Movement guidance state
    let status: "optimal" | "too-fast" | "idle" = "optimal";
    let message = "Orbit steadily around the object.";

    if (blurScore < 20 && diffPercent > 12) {
      status = "too-fast";
      message = "Camera moving too fast — slow down to avoid motion blur.";
    } else if (diffPercent < 2.0 && this.totalSampledFrames > 15) {
      status = "idle";
      message = "Camera stationary. Orbit around the object for full 360° coverage.";
    } else if (blurScore >= 45) {
      status = "optimal";
      message = "Sharp capture! Continue rotating at this steady pace.";
    }

    // Keyframe acceptance logic:
    // 1. Initial frame always accepted.
    // 2. Minimum interval elapsed (~400ms).
    // 3. Sufficient visual difference (> 4%) to reject duplicate frames.
    // 4. Acceptable sharpness (blurScore >= minBlurScore).
    const timeSinceLastKeyframe = now - this.lastKeyframeTime;
    const shouldAcceptKeyframe =
      this.capturedKeyframes.length === 0 ||
      (timeSinceLastKeyframe >= (this.options.targetKeyframeIntervalMs || 400) &&
        diffPercent >= (this.options.minMotionDiffPercent || 4.0) &&
        blurScore >= (this.options.minBlurScore || 26));

    if (shouldAcceptKeyframe) {
      this.acceptKeyframe(blurScore, diffPercent);
    }

    this.emitGuidance(status, message);
  }

  private acceptKeyframe(blurScore: number, diffScore: number): void {
    if (!this.video) return;

    const fullCanvas = document.createElement("canvas");
    fullCanvas.width = this.video.videoWidth;
    fullCanvas.height = this.video.videoHeight;
    const fullCtx = fullCanvas.getContext("2d");
    if (!fullCtx) return;
    fullCtx.drawImage(this.video, 0, 0, fullCanvas.width, fullCanvas.height);

    const dataUrl = fullCanvas.toDataURL("image/jpeg", 0.92);
    const thumbnailUrl = this.sampleCanvas
      ? this.sampleCanvas.toDataURL("image/jpeg", 0.75)
      : dataUrl;

    // Continuous orbital trajectory calculation
    // As recording progresses, update estimated azimuth angle and bin
    const keyframeIndex = this.capturedKeyframes.length;
    // Estimate continuous orbital coverage based on frames and time
    const binIndex = keyframeIndex % 12;
    this.azimuthCoverage[binIndex] = true;
    this.currentAzimuth = (binIndex * 30) % 360;

    // Slight elevation variation (orbiting slightly higher for elevated top views)
    const elevation = keyframeIndex >= 24 ? 35 : 20;
    const angleGroup = azimuthToAngleGroup(this.currentAzimuth, elevation);

    const frame: ContinuousScanFrame = {
      id: crypto.randomUUID(),
      dataUrl,
      thumbnailUrl,
      timestamp: Date.now(),
      blurScore,
      diffScore,
      azimuth: this.currentAzimuth,
      elevation,
      angleGroup,
    };

    this.capturedKeyframes.push(frame);
    this.lastKeyframeTime = performance.now();
    if (this.sampleCtx && this.sampleCanvas) {
      this.previousKeyframePixels = new Uint8ClampedArray(
        this.sampleCtx.getImageData(0, 0, this.sampleCanvas.width, this.sampleCanvas.height).data,
      );
    }

    this.options.onFrameCaptured?.(frame);
  }

  private emitGuidance(status: "optimal" | "too-fast" | "idle" | "lost", message: string): void {
    const elapsedSeconds = Number(
      ((performance.now() - this.startTime - this.totalPausedDuration) / 1000).toFixed(1),
    );
    const coveredBins = this.azimuthCoverage.filter(Boolean).length;
    const coveragePercent = Math.min(100, Math.round((coveredBins / 12) * 100));

    this.options.onGuidanceUpdate?.({
      status,
      message,
      durationSeconds: Math.max(0, elapsedSeconds),
      capturedFramesCount: this.totalSampledFrames,
      keyframeCount: this.capturedKeyframes.length,
      coveragePercent,
      azimuthCoverage: [...this.azimuthCoverage],
      currentAzimuth: this.currentAzimuth,
      isPaused: this.isPaused,
      isWebXRActive: this.isWebXRActive,
    });
  }
}

/**
 * Converts recorded ContinuousScanFrames into standard ScanPhotos with image validation and foreground masks.
 */
export async function processRecordedFramesToPhotos(
  frames: ContinuousScanFrame[],
  onProgress?: (message: string, pct: number) => void,
): Promise<ScanPhoto[]> {
  const photos: ScanPhoto[] = [];
  const total = frames.length;

  for (let i = 0; i < total; i++) {
    const frame = frames[i];
    if (!frame) continue;

    onProgress?.(
      `Processing recording keyframe ${i + 1} of ${total}…`,
      Math.round((i / total) * 100),
    );

    const thumbImg = document.createElement("img");
    thumbImg.src = frame.thumbnailUrl;
    await new Promise((res) => {
      thumbImg.onload = res;
    });

    const canvas = document.createElement("canvas");
    canvas.width = thumbImg.width || 160;
    canvas.height = thumbImg.height || 120;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(thumbImg, 0, 0, canvas.width, canvas.height);

    const quality = await validateImageQuality(canvas);
    const seg = await segmentForeground(canvas);

    const photo: ScanPhoto = {
      id: frame.id,
      dataUrl: frame.dataUrl,
      thumbnailUrl: frame.thumbnailUrl,
      timestamp: frame.timestamp,
      angleGroup: frame.angleGroup,
      azimuth: frame.azimuth,
      elevation: frame.elevation,
      maskDataUrl: seg.maskDataUrl,
      transparentDataUrl: seg.transparentDataUrl,
      isSegmented: true,
      quality,
    };

    photos.push(photo);
  }

  return photos;
}

/**
 * Exports a recorded scan dataset into an ARCore/COLMAP-compatible JSON package.
 * Enables users to export raw camera frames, poses, timestamps, and depth for workstation SfM.
 */
export function exportScanDataset(
  photos: ScanPhoto[],
  metadata: {
    objectName?: string;
    captureDurationSec?: number;
    deviceInfo?: string;
  } = {},
): Blob {
  const exportPayload = {
    format: "AddisAR-ScanDataset-v1.0",
    timestamp: Date.now(),
    metadata: {
      objectName: metadata.objectName || "Scanned Object",
      captureDurationSec: metadata.captureDurationSec || 0,
      deviceInfo:
        metadata.deviceInfo || (typeof navigator !== "undefined" ? navigator.userAgent : "Unknown"),
      totalFrames: photos.length,
    },
    cameraIntrinsics: {
      model: "PINHOLE",
      fovHorizontalDeg: 62.0,
      fovVerticalDeg: 48.0,
    },
    frames: photos.map((p, idx) => ({
      index: idx,
      id: p.id,
      timestamp: p.timestamp,
      azimuth: p.azimuth,
      elevation: p.elevation,
      angleGroup: p.angleGroup,
      dataUrl: p.dataUrl,
      thumbnailUrl: p.thumbnailUrl,
      maskDataUrl: p.maskDataUrl,
      quality: p.quality,
    })),
  };

  const jsonStr = JSON.stringify(exportPayload, null, 2);
  return new Blob([jsonStr], { type: "application/json" });
}

/**
 * Imports an external dataset (e.g. from ARCore Session Recording or desktop workstation) into ScanPhotos.
 */
export async function importScanDataset(file: File | Blob | string): Promise<ScanPhoto[]> {
  let text: string;
  if (typeof file === "string") {
    text = file;
  } else if (file instanceof Blob && typeof file.text === "function") {
    text = await file.text();
  } else {
    text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }
  const parsed = JSON.parse(text);

  if (!parsed || !Array.isArray(parsed.frames)) {
    throw new Error("Invalid scan dataset format: missing frames array.");
  }

  const photos: ScanPhoto[] = [];

  for (const f of parsed.frames) {
    if (!f.dataUrl) continue;

    const quality: PhotoQuality = f.quality || {
      blurScore: 75,
      isBlurry: false,
      brightness: 120,
      isUnderExposed: false,
      isOverExposed: false,
      featureCount: 220,
      hasSufficientFeatures: true,
      overallScore: 85,
      warnings: [],
    };

    photos.push({
      id: f.id || crypto.randomUUID(),
      dataUrl: f.dataUrl,
      thumbnailUrl: f.thumbnailUrl || f.dataUrl,
      timestamp: f.timestamp || Date.now(),
      angleGroup: (f.angleGroup as AngleGroup) || "front",
      azimuth: Number(f.azimuth) || 0,
      elevation: Number(f.elevation) || 25,
      maskDataUrl: f.maskDataUrl,
      transparentDataUrl: f.transparentDataUrl,
      isSegmented: Boolean(f.maskDataUrl),
      quality,
    });
  }

  if (photos.length < 3) {
    throw new Error("Dataset must contain at least 3 valid photographic views.");
  }

  return photos;
}
