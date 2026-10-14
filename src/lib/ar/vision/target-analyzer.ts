export interface ROI {
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  width: number; // normalized 0..1
  height: number; // normalized 0..1
}

export type TargetQuality = "excellent" | "good" | "fair" | "unsuitable";

export interface TrackabilityReport {
  score: number; // 0..100
  quality: TargetQuality;
  featureCount: number;
  contrast: number; // 0..100
  message: string;
  keypoints: { x: number; y: number }[]; // normalized coords
  snapshotUrl?: string | undefined;
}

export interface TargetTrackResult {
  detected: boolean;
  confidence: number; // 0..1
  center: { x: number; y: number }; // normalized 0..1
  bounds: { x: number; y: number; width: number; height: number }; // normalized
  scaleEstimate: number; // relative to initial scan
  dx: number;
  dy: number;
}

export class TargetAnalyzer {
  private static canvas: HTMLCanvasElement | null = null;
  private static ctx: CanvasRenderingContext2D | null = null;

  private static getContext(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    if (!this.canvas) {
      this.canvas = document.createElement("canvas");
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    }
    return { canvas: this.canvas, ctx: this.ctx! };
  }

  /**
   * Analyzes an ROI in the video feed to determine if it can serve as a stable AR target.
   */
  public static analyzeRegion(
    video: HTMLVideoElement,
    roi: ROI = { x: 0.3, y: 0.3, width: 0.4, height: 0.4 },
  ): TrackabilityReport {
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;
    const { canvas, ctx } = this.getContext();

    // Sample resolution
    const sampleW = Math.max(80, Math.floor(vw * roi.width));
    const sampleH = Math.max(80, Math.floor(vh * roi.height));
    canvas.width = sampleW;
    canvas.height = sampleH;

    const sx = Math.floor(vw * roi.x);
    const sy = Math.floor(vh * roi.y);
    const sw = Math.floor(vw * roi.width);
    const sh = Math.floor(vh * roi.height);

    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sampleW, sampleH);
    const imgData = ctx.getImageData(0, 0, sampleW, sampleH);
    const data = imgData.data;

    // 1. Grayscale & Luminance variance (contrast)
    let sumLum = 0;
    let sumSqLum = 0;
    const totalPixels = sampleW * sampleH;
    const gray = new Uint8Array(totalPixels);

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      // Perceived luminance
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const l = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
      gray[p] = l;
      sumLum += l;
      sumSqLum += l * l;
    }

    const meanLum = sumLum / totalPixels;
    const variance = Math.max(0, sumSqLum / totalPixels - meanLum * meanLum);
    const stdDev = Math.sqrt(variance);
    const contrastScore = Math.min(100, Math.round((stdDev / 64) * 100));

    // 2. Edge & Gradient density (Sobel filter)
    let strongEdges = 0;
    const edgeThreshold = 35;
    for (let y = 1; y < sampleH - 1; y += 2) {
      for (let x = 1; x < sampleW - 1; x += 2) {
        const idx = y * sampleW + x;
        // Simple Sobel gradient
        const g0 = gray[idx - sampleW - 1] ?? 0;
        const g1 = gray[idx - sampleW] ?? 0;
        const g2 = gray[idx - sampleW + 1] ?? 0;
        const g3 = gray[idx - 1] ?? 0;
        const g5 = gray[idx + 1] ?? 0;
        const g6 = gray[idx + sampleW - 1] ?? 0;
        const g7 = gray[idx + sampleW] ?? 0;
        const g8 = gray[idx + sampleW + 1] ?? 0;

        const gx = -g0 + g2 - 2 * g3 + 2 * g5 - g6 + g8;
        const gy = -g0 - 2 * g1 - g2 + g6 + 2 * g7 + g8;
        const mag = Math.abs(gx) + Math.abs(gy);
        if (mag > edgeThreshold * 4) {
          strongEdges++;
        }
      }
    }
    const edgeDensity = (strongEdges / ((sampleW * sampleH) / 4)) * 100;

    // 3. FAST-like corner detector
    const keypoints: { x: number; y: number }[] = [];
    const cornerThreshold = 25;
    const step = 4;
    for (let y = 3; y < sampleH - 3; y += step) {
      for (let x = 3; x < sampleW - 3; x += step) {
        const centerVal = gray[y * sampleW + x] ?? 0;
        // Test 4 cardinal points first for speed
        const top = gray[(y - 3) * sampleW + x] ?? 0;
        const bottom = gray[(y + 3) * sampleW + x] ?? 0;
        const left = gray[y * sampleW + (x - 3)] ?? 0;
        const right = gray[y * sampleW + (x + 3)] ?? 0;

        let brightCount = 0;
        let darkCount = 0;
        if (top > centerVal + cornerThreshold) brightCount++;
        else if (top < centerVal - cornerThreshold) darkCount++;
        if (bottom > centerVal + cornerThreshold) brightCount++;
        else if (bottom < centerVal - cornerThreshold) darkCount++;
        if (left > centerVal + cornerThreshold) brightCount++;
        else if (left < centerVal - cornerThreshold) darkCount++;
        if (right > centerVal + cornerThreshold) brightCount++;
        else if (right < centerVal - cornerThreshold) darkCount++;

        if (brightCount >= 3 || darkCount >= 3) {
          // Normalize back to ROI and frame coordinates
          const normX = roi.x + (x / sampleW) * roi.width;
          const normY = roi.y + (y / sampleH) * roi.height;
          keypoints.push({ x: Number(normX.toFixed(3)), y: Number(normY.toFixed(3)) });
          if (keypoints.length >= 40) break;
        }
      }
      if (keypoints.length >= 40) break;
    }

    // 4. Overall Trackability Score (0..100)
    // Combines contrast (30%), edge density (35%), and corner count (35%)
    const cornerScore = Math.min(100, (keypoints.length / 25) * 100);
    const rawScore =
      contrastScore * 0.3 + Math.min(100, edgeDensity * 3) * 0.35 + cornerScore * 0.35;
    const finalScore = Math.min(100, Math.max(0, Math.round(rawScore)));

    let quality: TargetQuality = "unsuitable";
    let message =
      "Too low contrast or textureless. Point at an object with distinct patterns or graphics.";

    if (finalScore >= 68) {
      quality = "excellent";
      message = "High contrast with rich visual features. Optimal for stable AR target tracking.";
    } else if (finalScore >= 45) {
      quality = "good";
      message = "Sufficient distinct features detected. Keep target steadily in view.";
    } else if (finalScore >= 25) {
      quality = "fair";
      message = "Moderate texture detected. Tracking may drift under fast motion.";
    }

    // Generate snapshot data URL
    let snapshotUrl: string | undefined;
    try {
      snapshotUrl = canvas.toDataURL("image/jpeg", 0.85);
    } catch {
      // ignore in test or restricted canvas
    }

    return {
      score: finalScore,
      quality,
      featureCount: keypoints.length,
      contrast: contrastScore,
      message,
      keypoints,
      snapshotUrl,
    };
  }

  /**
   * Tracks a locked target template across subsequent video frames using correlation matching.
   */
  public static trackTemplate(
    video: HTMLVideoElement,
    templateData: Uint8Array,
    tempW: number,
    tempH: number,
    lastCenter: { x: number; y: number },
    searchRadius = 0.2,
  ): TargetTrackResult {
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;
    const { canvas, ctx } = this.getContext();

    // Search window around last center
    const winNormW = Math.min(0.8, searchRadius * 2);
    const winNormH = Math.min(0.8, searchRadius * 2);
    const winNormX = Math.max(0, Math.min(1 - winNormW, lastCenter.x - winNormW / 2));
    const winNormY = Math.max(0, Math.min(1 - winNormH, lastCenter.y - winNormH / 2));

    const winW = Math.floor(vw * winNormW);
    const winH = Math.floor(vh * winNormH);
    if (winW <= 0 || winH <= 0) {
      return {
        detected: false,
        confidence: 0,
        center: lastCenter,
        bounds: { x: winNormX, y: winNormY, width: winNormW, height: winNormH },
        scaleEstimate: 1,
        dx: 0,
        dy: 0,
      };
    }

    canvas.width = winW;
    canvas.height = winH;
    ctx.drawImage(
      video,
      Math.floor(vw * winNormX),
      Math.floor(vh * winNormY),
      winW,
      winH,
      0,
      0,
      winW,
      winH,
    );

    const imgData = ctx.getImageData(0, 0, winW, winH);
    const data = imgData.data;
    const searchGray = new Uint8Array(winW * winH);

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      searchGray[p] = Math.round(
        (data[i] ?? 0) * 0.299 + (data[i + 1] ?? 0) * 0.587 + (data[i + 2] ?? 0) * 0.114,
      );
    }

    // Block matching with subsampling
    const step = 4;
    let bestSad = Number.POSITIVE_INFINITY;
    let bestX = 0;
    let bestY = 0;

    for (let sy = 0; sy <= winH - tempH; sy += step) {
      for (let sx = 0; sx <= winW - tempW; sx += step) {
        let sad = 0;
        // Sample points across template
        for (let ty = 0; ty < tempH; ty += 4) {
          const sOffset = (sy + ty) * winW + sx;
          const tOffset = ty * tempW;
          for (let tx = 0; tx < tempW; tx += 4) {
            sad += Math.abs((searchGray[sOffset + tx] ?? 0) - (templateData[tOffset + tx] ?? 0));
          }
        }
        if (sad < bestSad) {
          bestSad = sad;
          bestX = sx;
          bestY = sy;
        }
      }
    }

    const sampledPixelCount = (tempW / 4) * (tempH / 4) || 1;
    const avgDiff = bestSad / sampledPixelCount;
    // Map avgDiff (0..255) to confidence (1..0)
    const confidence = Math.max(0, Math.min(1, 1 - avgDiff / 75));
    const detected = confidence > 0.35;

    const newCenterX = winNormX + ((bestX + tempW / 2) / winW) * winNormW;
    const newCenterY = winNormY + ((bestY + tempH / 2) / winH) * winNormH;

    return {
      detected,
      confidence,
      center: { x: Number(newCenterX.toFixed(3)), y: Number(newCenterY.toFixed(3)) },
      bounds: {
        x: Number((newCenterX - tempW / vw / 2).toFixed(3)),
        y: Number((newCenterY - tempH / vh / 2).toFixed(3)),
        width: Number((tempW / vw).toFixed(3)),
        height: Number((tempH / vh).toFixed(3)),
      },
      scaleEstimate: 1.0,
      dx: newCenterX - lastCenter.x,
      dy: newCenterY - lastCenter.y,
    };
  }

  /**
   * Creates a downsampled template snapshot from the ROI for tracking.
   */
  public static extractTemplate(
    video: HTMLVideoElement,
    roi: ROI,
    tw = 40,
    th = 40,
  ): { data: Uint8Array; width: number; height: number; snapshotUrl: string } {
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;
    const { canvas, ctx } = this.getContext();

    canvas.width = tw;
    canvas.height = th;
    ctx.drawImage(
      video,
      Math.floor(vw * roi.x),
      Math.floor(vh * roi.y),
      Math.floor(vw * roi.width),
      Math.floor(vh * roi.height),
      0,
      0,
      tw,
      th,
    );

    const imgData = ctx.getImageData(0, 0, tw, th);
    const d = imgData.data;
    const gray = new Uint8Array(tw * th);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      gray[p] = Math.round((d[i] ?? 0) * 0.299 + (d[i + 1] ?? 0) * 0.587 + (d[i + 2] ?? 0) * 0.114);
    }

    return {
      data: gray,
      width: tw,
      height: th,
      snapshotUrl: canvas.toDataURL("image/jpeg", 0.8),
    };
  }
}
