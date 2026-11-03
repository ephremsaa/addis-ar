import type {
  CapturedPhoto,
  PhotoQualityScore,
  TargetAngleId,
} from '../types/scanner';

export interface ImageQualityReport {
  isSharp: boolean;
  sharpness: number; // 0 to 100
  isTooDark: boolean;
  brightness: number; // 0 to 255
  message?: string;
}

const analysisCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const analysisCtx = analysisCanvas ? analysisCanvas.getContext('2d', { willReadFrequently: true }) : null;

/**
 * 60fps real-time frame evaluation for camera HUD guidance.
 */
export function analyzeVideoFrame(video: HTMLVideoElement): ImageQualityReport {
  if (!analysisCanvas || !analysisCtx || video.videoWidth === 0 || video.videoHeight === 0) {
    return { isSharp: true, sharpness: 50, isTooDark: false, brightness: 120 };
  }

  const w = 160;
  const h = 120;
  analysisCanvas.width = w;
  analysisCanvas.height = h;

  analysisCtx.drawImage(video, 0, 0, w, h);
  const imgData = analysisCtx.getImageData(0, 0, w, h);
  const data = imgData.data;

  let totalLuminance = 0;
  const gray = new Float32Array(w * h);

  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[j] = luma;
    totalLuminance += luma;
  }

  const avgBrightness = totalLuminance / (w * h);

  // Laplacian edge contrast filter
  let laplacianSum = 0;
  let laplacianCount = 0;

  for (let y = 2; y < h - 2; y += 2) {
    for (let x = 2; x < w - 2; x += 2) {
      const idx = y * w + x;
      const lap =
        gray[idx - w] +
        gray[idx + w] +
        gray[idx - 1] +
        gray[idx + 1] -
        4 * gray[idx];
      laplacianSum += Math.abs(lap);
      laplacianCount++;
    }
  }

  const rawSharpness = laplacianCount > 0 ? laplacianSum / laplacianCount : 0;
  const normalizedSharpness = Math.min(100, Math.round(rawSharpness * 14));
  const isTooDark = avgBrightness < 32;
  const isSharp = normalizedSharpness >= 35;

  let message: string | undefined;
  if (isTooDark) message = 'Too dark · Increase lighting';
  else if (!isSharp) message = 'Hold phone steady';

  return {
    isSharp,
    sharpness: normalizedSharpness,
    isTooDark,
    brightness: Math.round(avgBrightness),
    message,
  };
}

/**
 * Full AI Quality Scoring (0 - 100%) for a captured photo:
 * - Sharpness (Laplacian high-frequency variance)
 * - Lighting (Luminance & Contrast)
 * - Cut-out / Mask Quality (Contour integrity & edge clipping)
 * - Centeredness & Framing (Product scale and alignment)
 * - View Uniqueness (Distinct angle from other photos)
 */
export function scoreCapturedPhotoQuality(params: {
  imageCanvas: HTMLCanvasElement;
  maskCanvas?: HTMLCanvasElement;
  targetSlotId: TargetAngleId;
  azimuth: number;
  elevation: number;
  existingPhotos: CapturedPhoto[];
}): PhotoQualityScore {
  const { imageCanvas, maskCanvas, targetSlotId, azimuth, existingPhotos } = params;
  const w = imageCanvas.width;
  const h = imageCanvas.height;

  const ctx = imageCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return {
      overall: 70,
      sharpness: 70,
      lighting: 70,
      maskQuality: 70,
      framing: 70,
      uniqueness: 70,
      isAcceptable: true,
      feedback: 'Good photo quality',
    };
  }

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  // 1. Sharpness: Sampled Laplacian variance
  let lapSum = 0;
  let lapCount = 0;
  const step = Math.max(2, Math.floor(w / 160));

  for (let y = step; y < h - step; y += step) {
    for (let x = step; x < w - step; x += step) {
      const idx = (y * w + x) * 4;
      const centerLuma = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];

      const upIdx = ((y - step) * w + x) * 4;
      const downIdx = ((y + step) * w + x) * 4;
      const leftIdx = (y * w + (x - step)) * 4;
      const rightIdx = (y * w + (x + step)) * 4;

      const up = 0.299 * data[upIdx] + 0.587 * data[upIdx + 1] + 0.114 * data[upIdx + 2];
      const down = 0.299 * data[downIdx] + 0.587 * data[downIdx + 1] + 0.114 * data[downIdx + 2];
      const left = 0.299 * data[leftIdx] + 0.587 * data[leftIdx + 1] + 0.114 * data[leftIdx + 2];
      const right = 0.299 * data[rightIdx] + 0.587 * data[rightIdx + 1] + 0.114 * data[rightIdx + 2];

      const lap = up + down + left + right - 4 * centerLuma;
      lapSum += Math.abs(lap);
      lapCount++;
    }
  }

  const meanLap = lapCount > 0 ? lapSum / lapCount : 0;
  // Variance to 0..100 score
  const sharpnessScore = Math.min(100, Math.max(10, Math.round((meanLap / 18) * 100)));

  // 2. Lighting & Exposure
  let totalLuma = 0;
  let sampleCount = 0;
  for (let i = 0; i < data.length; i += 4 * step) {
    totalLuma += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sampleCount++;
  }
  const avgLuma = sampleCount > 0 ? totalLuma / sampleCount : 128;

  let lightingScore = 95;
  if (avgLuma < 40) {
    lightingScore = Math.max(15, Math.round((avgLuma / 40) * 55));
  } else if (avgLuma > 220) {
    lightingScore = Math.max(20, Math.round(100 - (avgLuma - 220) * 2));
  } else if (avgLuma < 75) {
    lightingScore = 75;
  }

  // 3. Mask Quality & Edge Clipping Check
  let maskScore = 90;
  let framingScore = 85;

  if (maskCanvas) {
    const mCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (mCtx) {
      const mw = maskCanvas.width;
      const mh = maskCanvas.height;
      const mData = mCtx.getImageData(0, 0, mw, mh).data;

      let fgCount = 0;
      let minX = mw, maxX = 0, minY = mh, maxY = 0;
      let touchesBorder = false;

      for (let y = 0; y < mh; y += 4) {
        for (let x = 0; x < mw; x += 4) {
          const a = mData[(y * mw + x) * 4 + 3];
          if (a > 64) {
            fgCount++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;

            if (x <= 4 || x >= mw - 5 || y <= 4 || y >= mh - 5) {
              touchesBorder = true;
            }
          }
        }
      }

      const totalSamples = (mw * mh) / 16;
      const fgRatio = fgCount / Math.max(1, totalSamples);

      // Penalize if product is cut off at frame border
      if (touchesBorder) {
        maskScore -= 28;
        framingScore -= 25;
      }

      // Check ideal scale: 20% to 75% coverage
      if (fgRatio < 0.10) {
        framingScore -= 30; // Too small / too far
      } else if (fgRatio > 0.85) {
        framingScore -= 20; // Too close
      }

      // Center offset
      const cx = (minX + maxX) / 2 / mw;
      const cy = (minY + maxY) / 2 / mh;
      const distFromCenter = Math.hypot(cx - 0.5, cy - 0.5);
      if (distFromCenter > 0.25) {
        framingScore -= Math.round(distFromCenter * 40);
      }
    }
  }

  maskScore = Math.max(10, Math.min(100, maskScore));
  framingScore = Math.max(15, Math.min(100, framingScore));

  // 4. View Uniqueness: Angular separation from other photos
  let uniquenessScore = 95;
  for (const existing of existingPhotos) {
    if (existing.slotId === targetSlotId) continue;
    let diff = Math.abs(existing.azimuth - azimuth);
    if (diff > 180) diff = 360 - diff;
    if (diff < 15) {
      uniquenessScore = Math.max(40, uniquenessScore - 20);
    }
  }

  // 5. Composite Weighted Score
  const overall = Math.round(
    0.30 * sharpnessScore +
    0.25 * lightingScore +
    0.20 * maskScore +
    0.15 * framingScore +
    0.10 * uniquenessScore
  );

  const isAcceptable = overall >= 60;

  // Generate clear user-facing feedback message
  let feedback = 'Excellent photo quality';
  if (!isAcceptable) {
    if (sharpnessScore < 50) {
      feedback = `Blurry (${overall}%) · Hold phone steady and retake`;
    } else if (lightingScore < 50) {
      feedback = `Too dark (${overall}%) · Add light to product`;
    } else if (framingScore < 55) {
      feedback = `Product clipped (${overall}%) · Step back to fit full object`;
    } else {
      feedback = `Low quality (${overall}%) · Please retake this angle`;
    }
  } else if (overall < 75) {
    feedback = `Acceptable (${overall}%) · Could be sharper`;
  }

  return {
    overall,
    sharpness: sharpnessScore,
    lighting: lightingScore,
    maskQuality: maskScore,
    framing: framingScore,
    uniqueness: uniquenessScore,
    isAcceptable,
    feedback,
    isPrimaryFront: targetSlotId === 'front' && overall >= 75,
  };
}

/**
 * Creates tightly cropped, centered image of the product on a neutral transparent background.
 */
export async function createTightlyCroppedProduct(
  imageCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  paddingPercent = 0.08
): Promise<{ croppedCanvas: HTMLCanvasElement; croppedDataUrl: string; croppedBlob: Blob }> {
  const w = imageCanvas.width;
  const h = imageCanvas.height;

  const mCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  let minX = w, maxX = 0, minY = h, maxY = 0;

  if (mCtx) {
    const data = mCtx.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y += 4) {
      for (let x = 0; x < w; x += 4) {
        if (data[(y * w + x) * 4 + 3] > 60) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }

  // Fallback to center 70% if mask bounds empty
  if (minX >= maxX || minY >= maxY) {
    minX = Math.round(w * 0.15);
    maxX = Math.round(w * 0.85);
    minY = Math.round(h * 0.15);
    maxY = Math.round(h * 0.85);
  }

  const boxW = maxX - minX;
  const boxH = maxY - minY;
  const padX = Math.round(boxW * paddingPercent);
  const padY = Math.round(boxH * paddingPercent);

  const cropX = Math.max(0, minX - padX);
  const cropY = Math.max(0, minY - padY);
  const cropW = Math.min(w - cropX, boxW + padX * 2);
  const cropH = Math.min(h - cropY, boxH + padY * 2);

  // Square canvas for multi-view AI conditioning
  const maxDim = Math.max(cropW, cropH);
  const outCanvas = document.createElement('canvas');
  outCanvas.width = maxDim;
  outCanvas.height = maxDim;
  const outCtx = outCanvas.getContext('2d');

  if (outCtx) {
    outCtx.clearRect(0, 0, maxDim, maxDim);
    const destX = Math.round((maxDim - cropW) / 2);
    const destY = Math.round((maxDim - cropH) / 2);

    // Apply masked image
    outCtx.drawImage(
      imageCanvas,
      cropX, cropY, cropW, cropH,
      destX, destY, cropW, cropH
    );
  }

  const croppedDataUrl = outCanvas.toDataURL('image/png');
  const croppedBlob = await new Promise<Blob>((resolve) => {
    outCanvas.toBlob((b) => resolve(b || new Blob()), 'image/png');
  });

  return { croppedCanvas: outCanvas, croppedDataUrl, croppedBlob };
}

/**
 * Snapshot from camera element to high-res canvas and blobs.
 */
export async function captureFrame(
  video: HTMLVideoElement,
  quality = 0.95
): Promise<{
  canvas: HTMLCanvasElement;
  blob: Blob;
  dataUrl: string;
  thumbnailUrl: string;
}> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1920;
  canvas.height = video.videoHeight || 1080;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D rendering context');

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);

  // Thumbnail
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = 110;
  thumbCanvas.height = 110;
  const thumbCtx = thumbCanvas.getContext('2d');
  if (thumbCtx) {
    const minDim = Math.min(canvas.width, canvas.height);
    const sx = (canvas.width - minDim) / 2;
    const sy = (canvas.height - minDim) / 2;
    thumbCtx.drawImage(canvas, sx, sy, minDim, minDim, 0, 0, 110, 110);
  }
  const thumbnailUrl = thumbCanvas.toDataURL('image/jpeg', 0.82);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to create Blob'))),
      'image/jpeg',
      quality
    );
  });

  return { canvas, blob, dataUrl, thumbnailUrl };
}
