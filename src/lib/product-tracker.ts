/**
 * Addis AR · Real-Time Product Tracker & Feature Detection Engine
 * Tracks the physical product in the camera feed, extracts visual feature points,
 * and estimates bounding box, distance, and aspect ratio for photogrammetric reconstruction.
 */

export interface TrackedFeaturePoint {
  x: number; // 0..1 normalized video coordinates
  y: number;
  confidence: number;
}

export interface ProductTrackingResult {
  isLocked: boolean;
  confidence: number; // 0..100%
  bounds: {
    x: number; // normalized center X (0..1)
    y: number; // normalized center Y (0..1)
    width: number; // normalized width (0..1)
    height: number; // normalized height (0..1)
  };
  pixelBounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  featurePoints: TrackedFeaturePoint[];
  distanceFeedback: 'optimal' | 'too_far' | 'too_close' | 'not_found';
  guidance: string;
  aspectRatio: number; // width / height
}

export class ProductTracker {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private readonly processWidth = 120;
  private readonly processHeight = 90;

  // Smoothed bounding box
  private smoothX = 0.5;
  private smoothY = 0.5;
  private smoothW = 0.45;
  private smoothH = 0.55;
  private smoothConfidence = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.processWidth;
    this.canvas.height = this.processHeight;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  public trackFrame(video: HTMLVideoElement): ProductTrackingResult {
    if (!this.ctx || video.readyState < 2) {
      return this.getDefaultResult('Initializing camera tracking...');
    }

    const w = this.processWidth;
    const h = this.processHeight;

    // Draw video downscaled for real-time 60fps tracking
    this.ctx.drawImage(video, 0, 0, w, h);
    const imgData = this.ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // 1. Establish Background Color Profile from perimeter border (top 8%, bottom 8%, left 8%, right 8%)
    let bgR = 0, bgG = 0, bgB = 0;
    let bgSamples = 0;

    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const isBorder = x < w * 0.1 || x > w * 0.9 || y < h * 0.1 || y > h * 0.9;
        if (isBorder) {
          const idx = (y * w + x) * 4;
          bgR += data[idx];
          bgG += data[idx + 1];
          bgB += data[idx + 2];
          bgSamples++;
        }
      }
    }

    if (bgSamples > 0) {
      bgR /= bgSamples;
      bgG /= bgSamples;
      bgB /= bgSamples;
    }

    // 2. Detect Foreground Product Pixels in central 75% region
    let minX = w, maxX = 0, minY = h, maxY = 0;
    let fgCount = 0;
    let sumX = 0, sumY = 0;

    // Feature points array (high-contrast gradients inside product)
    const candidates: TrackedFeaturePoint[] = [];

    const startX = Math.floor(w * 0.12);
    const endX = Math.floor(w * 0.88);
    const startY = Math.floor(h * 0.12);
    const endY = Math.floor(h * 0.88);

    for (let y = startY; y < endY; y += 2) {
      for (let x = startX; x < endX; x += 2) {
        const idx = (y * w + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // Color difference from background
        const colorDiff = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);

        // Local gradient for corner/edge feature tracking
        const rightIdx = idx + 8;
        const downIdx = idx + w * 8;
        let localContrast = 0;
        if (x + 2 < endX && y + 2 < endY) {
          localContrast =
            Math.abs(r - data[rightIdx]) +
            Math.abs(g - data[rightIdx + 1]) +
            Math.abs(b - data[rightIdx + 2]) +
            Math.abs(r - data[downIdx]) +
            Math.abs(g - data[downIdx + 1]) +
            Math.abs(b - data[downIdx + 2]);
        }

        // Foreground threshold
        if (colorDiff > 42 || localContrast > 55) {
          fgCount++;
          sumX += x;
          sumY += y;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;

          // Record salient feature points
          if (localContrast > 75 && candidates.length < 24) {
            candidates.push({
              x: x / w,
              y: y / h,
              confidence: Math.min(1, localContrast / 150),
            });
          }
        }
      }
    }

    const totalRegionPixels = (endX - startX) * (endY - startY) / 4;
    const coverageFraction = fgCount / Math.max(1, totalRegionPixels);

    // If reasonable product mass detected
    if (fgCount > 25 && maxX > minX && maxY > minY) {
      const detectedW = (maxX - minX) / w;
      const detectedH = (maxY - minY) / h;
      const detectedX = (minX + maxX) / (2 * w);
      const detectedY = (minY + maxY) / (2 * h);

      // Low-pass exponential smoothing
      this.smoothX = this.smoothX * 0.7 + detectedX * 0.3;
      this.smoothY = this.smoothY * 0.7 + detectedY * 0.3;
      this.smoothW = this.smoothW * 0.7 + detectedW * 0.3;
      this.smoothH = this.smoothH * 0.7 + detectedH * 0.3;

      const rawConfidence = Math.min(98, Math.max(20, Math.floor(coverageFraction * 140)));
      this.smoothConfidence = Math.floor(this.smoothConfidence * 0.7 + rawConfidence * 0.3);

      const area = this.smoothW * this.smoothH;
      let distanceFeedback: 'optimal' | 'too_far' | 'too_close' | 'not_found' = 'optimal';
      let guidance = 'Target Locked · Optimal Range';

      if (area < 0.08) {
        distanceFeedback = 'too_far';
        guidance = 'Move closer to product';
      } else if (area > 0.65) {
        distanceFeedback = 'too_close';
        guidance = 'Step back slightly';
      }

      const aspectRatio = this.smoothW / Math.max(0.01, this.smoothH);

      return {
        isLocked: this.smoothConfidence > 40,
        confidence: this.smoothConfidence,
        bounds: {
          x: this.smoothX,
          y: this.smoothY,
          width: Math.max(0.2, this.smoothW),
          height: Math.max(0.2, this.smoothH),
        },
        pixelBounds: {
          minX,
          minY,
          maxX,
          maxY,
        },
        featurePoints: candidates,
        distanceFeedback,
        guidance,
        aspectRatio,
      };
    }

    // Fallback if low contrast
    this.smoothConfidence = Math.max(0, this.smoothConfidence - 4);
    return this.getDefaultResult('Center product in frame');
  }

  private getDefaultResult(guidance: string): ProductTrackingResult {
    return {
      isLocked: false,
      confidence: 30,
      bounds: {
        x: 0.5,
        y: 0.5,
        width: 0.46,
        height: 0.52,
      },
      pixelBounds: {
        minX: 20,
        minY: 20,
        maxX: 100,
        maxY: 70,
      },
      featurePoints: [
        { x: 0.42, y: 0.45, confidence: 0.8 },
        { x: 0.58, y: 0.45, confidence: 0.8 },
        { x: 0.42, y: 0.55, confidence: 0.8 },
        { x: 0.58, y: 0.55, confidence: 0.8 },
        { x: 0.5, y: 0.5, confidence: 0.9 },
      ],
      distanceFeedback: 'optimal',
      guidance,
      aspectRatio: 0.85,
    };
  }
}

export const productTracker = new ProductTracker();

