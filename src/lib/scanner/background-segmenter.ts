/**
 * Open-source, client-side foreground segmentation and mask extraction.
 * Uses color distribution modeling, border sampling, and spatial saliency
 * with edge-preserving bilateral smoothing.
 */

export interface SegmentationResult {
  maskDataUrl: string; // Black & white mask (white = foreground, black = background)
  transparentDataUrl: string; // RGBA PNG with alpha channel
  foregroundRatio: number; // Percentage of image detected as foreground (0 - 1)
}

/**
 * Automatically extracts the foreground object and removes the background.
 */
export async function segmentForeground(
  imageSource: HTMLImageElement | HTMLCanvasElement | string
): Promise<SegmentationResult> {
  const img = await resolveImageElement(imageSource);
  const maxDim = 640; // High enough for clean silhouette, optimized for mobile memory
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create 2D canvas context');

  ctx.drawImage(img, 0, 0, width, height);
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  // 1. Sample border background pixels (top, bottom, left, right outer bands)
  const borderMarginX = Math.max(2, Math.floor(width * 0.06));
  const borderMarginY = Math.max(2, Math.floor(height * 0.06));

  const bgR: number[] = [];
  const bgG: number[] = [];
  const bgB: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (
        x < borderMarginX ||
        x >= width - borderMarginX ||
        y < borderMarginY ||
        y >= height - borderMarginY
      ) {
        // Step to keep sample size manageable
        if ((x + y) % 4 === 0) {
          const idx = (y * width + x) * 4;
          bgR.push(data[idx]);
          bgG.push(data[idx + 1]);
          bgB.push(data[idx + 2]);
        }
      }
    }
  }

  // Calculate background color statistics (mean and variance)
  const nBg = bgR.length || 1;
  const meanR = bgR.reduce((a, b) => a + b, 0) / nBg;
  const meanG = bgG.reduce((a, b) => a + b, 0) / nBg;
  const meanB = bgB.reduce((a, b) => a + b, 0) / nBg;

  let varR = 0;
  let varG = 0;
  let varB = 0;
  for (let i = 0; i < nBg; i++) {
    varR += (bgR[i] - meanR) ** 2;
    varG += (bgG[i] - meanG) ** 2;
    varB += (bgB[i] - meanB) ** 2;
  }
  const stdR = Math.max(16, Math.sqrt(varR / nBg));
  const stdG = Math.max(16, Math.sqrt(varG / nBg));
  const stdB = Math.max(16, Math.sqrt(varB / nBg));

  // Compute local gradient magnitude (Sobel-inspired) to capture high-frequency texture (zipper, stitching)
  const grad = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idxL = (y * width + (x - 1)) * 4;
      const idxR = (y * width + (x + 1)) * 4;
      const idxT = ((y - 1) * width + x) * 4;
      const idxB = ((y + 1) * width + x) * 4;

      const lumL = 0.299 * data[idxL] + 0.587 * data[idxL + 1] + 0.114 * data[idxL + 2];
      const lumR = 0.299 * data[idxR] + 0.587 * data[idxR + 1] + 0.114 * data[idxR + 2];
      const lumT = 0.299 * data[idxT] + 0.587 * data[idxT + 1] + 0.114 * data[idxT + 2];
      const lumB = 0.299 * data[idxB] + 0.587 * data[idxB + 1] + 0.114 * data[idxB + 2];

      const dx = lumR - lumL;
      const dy = lumB - lumT;
      grad[y * width + x] = Math.hypot(dx, dy);
    }
  }

  // 2. Compute probability mask for each pixel with dark object protection
  const mask = new Uint8Array(width * height);
  const centerX = width / 2;
  const centerY = height / 2;
  const maxDist = Math.hypot(centerX, centerY);

  let foregroundCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      // Normalized color difference from background model
      const diffR = (r - meanR) / stdR;
      const diffG = (g - meanG) / stdG;
      const diffB = (b - meanB) / stdB;
      const colorDist = Math.sqrt(diffR * diffR + diffG * diffG + diffB * diffB);

      // Distance from center
      const distFromCenter = Math.hypot(x - centerX, y - centerY);
      const centerFactor = 1.0 - Math.min(1.0, (distFromCenter / maxDist) * 1.05);

      // Texture gradient boost (crucial for textured black cases with zippers)
      const textureBoost = Math.min(1.8, grad[y * width + x] / 24.0);

      // Saliency score: combination of color distinctiveness, texture presence, and spatial centrality
      const saliency = colorDist * 0.7 + textureBoost * 0.9 + centerFactor * 1.4;

      // Dark object protection: central dark pixels with texture/edges are recognized as foreground
      const isDarkCentral = (r + g + b) / 3 < 70 && centerFactor > 0.45 && textureBoost > 0.3;
      const isForeground = (saliency > 1.25 && colorDist > 0.85) || isDarkCentral;

      if (isForeground) {
        mask[y * width + x] = 255;
        foregroundCount++;
      } else {
        mask[y * width + x] = 0;
      }
    }
  }

  // 3. Morphological closing & border smoothing to preserve silhouette details
  const smoothedMask = smoothMask(mask, width, height);

  // 4. Create transparent image and black-and-white mask
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext('2d')!;
  const maskImgData = maskCtx.createImageData(width, height);

  const transCanvas = document.createElement('canvas');
  transCanvas.width = width;
  transCanvas.height = height;
  const transCtx = transCanvas.getContext('2d')!;
  const transImgData = transCtx.createImageData(width, height);

  for (let i = 0; i < width * height; i++) {
    const alpha = smoothedMask[i];
    const pIdx = i * 4;

    // Mask output: Black & White
    maskImgData.data[pIdx] = alpha;
    maskImgData.data[pIdx + 1] = alpha;
    maskImgData.data[pIdx + 2] = alpha;
    maskImgData.data[pIdx + 3] = 255;

    // Transparent output: Original RGB + smoothed Alpha
    transImgData.data[pIdx] = data[pIdx];
    transImgData.data[pIdx + 1] = data[pIdx + 1];
    transImgData.data[pIdx + 2] = data[pIdx + 2];
    transImgData.data[pIdx + 3] = alpha;
  }

  maskCtx.putImageData(maskImgData, 0, 0);
  transCtx.putImageData(transImgData, 0, 0);

  return {
    maskDataUrl: maskCanvas.toDataURL('image/png'),
    transparentDataUrl: transCanvas.toDataURL('image/png'),
    foregroundRatio: foregroundCount / (width * height),
  };
}

/**
 * Simple 3x3 median and morphological filter to reduce salt-and-pepper noise.
 */
function smoothMask(
  input: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const output = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (input[(y + dy) * width + (x + dx)] > 128) {
            count++;
          }
        }
      }
      // Majority voting
      output[y * width + x] = count >= 5 ? 255 : 0;
    }
  }

  return output;
}

/**
 * Applies user touch-up brush edits (Restore or Erase) to a mask.
 */
export async function applyBrushEdit(
  originalDataUrl: string,
  currentMaskDataUrl: string,
  editPoints: Array<{ x: number; y: number }>,
  mode: 'restore' | 'erase',
  brushRadius: number = 18
): Promise<{ maskDataUrl: string; transparentDataUrl: string }> {
  const origImg = await resolveImageElement(originalDataUrl);
  const maskImg = await resolveImageElement(currentMaskDataUrl);

  const width = maskImg.width;
  const height = maskImg.height;

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext('2d')!;
  maskCtx.drawImage(maskImg, 0, 0);

  // Paint brush strokes
  maskCtx.fillStyle = mode === 'restore' ? '#ffffff' : '#000000';
  maskCtx.strokeStyle = mode === 'restore' ? '#ffffff' : '#000000';
  maskCtx.lineWidth = brushRadius * 2;
  maskCtx.lineCap = 'round';
  maskCtx.lineJoin = 'round';

  if (editPoints.length === 1) {
    maskCtx.beginPath();
    maskCtx.arc(editPoints[0].x, editPoints[0].y, brushRadius, 0, Math.PI * 2);
    maskCtx.fill();
  } else if (editPoints.length > 1) {
    maskCtx.beginPath();
    maskCtx.moveTo(editPoints[0].x, editPoints[0].y);
    for (let i = 1; i < editPoints.length; i++) {
      maskCtx.lineTo(editPoints[i].x, editPoints[i].y);
    }
    maskCtx.stroke();
  }

  // Combine original with updated mask to recreate transparent PNG
  const updatedMaskData = maskCtx.getImageData(0, 0, width, height).data;

  const origCanvas = document.createElement('canvas');
  origCanvas.width = width;
  origCanvas.height = height;
  const origCtx = origCanvas.getContext('2d')!;
  origCtx.drawImage(origImg, 0, 0, width, height);
  const origImgData = origCtx.getImageData(0, 0, width, height);

  for (let i = 0; i < width * height; i++) {
    const alpha = updatedMaskData[i * 4]; // R channel of mask
    origImgData.data[i * 4 + 3] = alpha;
  }
  origCtx.putImageData(origImgData, 0, 0);

  return {
    maskDataUrl: maskCanvas.toDataURL('image/png'),
    transparentDataUrl: origCanvas.toDataURL('image/png'),
  };
}

function resolveImageElement(
  source: HTMLImageElement | HTMLCanvasElement | string
): Promise<HTMLImageElement | HTMLCanvasElement> {
  if (typeof source !== 'string') {
    return Promise.resolve(source);
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for segmentation'));
    img.src = source;
  });
}
