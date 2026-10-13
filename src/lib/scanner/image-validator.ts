import type { PhotoQuality } from './types';

/**
 * Validates a captured image for photogrammetry suitability:
 * - Detects motion/focus blur via Laplacian variance.
 * - Detects under-exposure / over-exposure from luminance histograms.
 * - Estimates visual feature richness (gradient corner density).
 */
export async function validateImageQuality(
  imgOrCanvas: HTMLImageElement | HTMLCanvasElement
): Promise<PhotoQuality> {
  const width = 320; // Downscale to fixed dimension for fast, deterministic evaluation
  const height = Math.round((imgOrCanvas.height / imgOrCanvas.width) * width) || 240;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return createDefaultQuality();
  }

  ctx.drawImage(imgOrCanvas, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // 1. Convert to grayscale array
  const gray = new Float32Array(width * height);
  let luminanceSum = 0;
  const hist = new Uint32Array(256);

  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const l = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    gray[j] = l;
    luminanceSum += l;
    const hVal = hist[l] ?? 0;
    hist[l] = hVal + 1;
  }

  const avgLuminance = luminanceSum / (width * height);

  // Check exposure
  const darkFraction =
    (hist.slice(0, 35).reduce((a, b) => a + b, 0)) / (width * height);
  const brightFraction =
    (hist.slice(225).reduce((a, b) => a + b, 0)) / (width * height);

  const isUnderExposed = avgLuminance < 45 || darkFraction > 0.5;
  const isOverExposed = avgLuminance > 215 || brightFraction > 0.45;

  // 2. Compute Laplacian variance for blur estimation
  // Kernel: [0, 1, 0; 1, -4, 1; 0, 1, 0]
  let laplacianSum = 0;
  let laplacianSqSum = 0;
  let validPixels = 0;
  let featureCount = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const center = gray[idx] ?? 0;
      const top = gray[idx - width] ?? 0;
      const bottom = gray[idx + width] ?? 0;
      const left = gray[idx - 1] ?? 0;
      const right = gray[idx + 1] ?? 0;

      const lap = top + bottom + left + right - 4 * center;
      laplacianSum += lap;
      laplacianSqSum += lap * lap;
      validPixels++;

      // Feature detection: strong Laplacian magnitude indicates sharp edge / corner
      if (Math.abs(lap) > 28) {
        featureCount++;
      }
    }
  }

  const laplacianMean = validPixels > 0 ? laplacianSum / validPixels : 0;
  const laplacianVariance =
    validPixels > 0
      ? laplacianSqSum / validPixels - laplacianMean * laplacianMean
      : 0;

  // Normalize blurScore (0 to 100)
  // Higher variance means sharper image. Under 60 is typically noticeably blurry.
  const blurScore = Math.min(100, Math.max(0, Math.round((laplacianVariance / 200) * 100)));
  const isBlurry = laplacianVariance < 45;

  const hasSufficientFeatures = featureCount > 350;

  // Build user warnings
  const warnings: string[] = [];
  if (isBlurry) {
    warnings.push('Image appears blurry. Hold phone steady or refocus.');
  }
  if (isUnderExposed) {
    warnings.push('Image is dark. Add more lighting to the object.');
  }
  if (isOverExposed) {
    warnings.push('Image is washed out. Avoid harsh direct glare.');
  }
  if (!hasSufficientFeatures) {
    warnings.push('Low surface detail. Ensure object has visible texture or markings.');
  }

  // Calculate overall score (0 - 100)
  let score = blurScore * 0.5 + Math.min(100, (featureCount / 1000) * 100) * 0.3;
  if (!isUnderExposed && !isOverExposed) score += 20;
  else score = Math.max(10, score - 25);

  const overallScore = Math.round(Math.min(100, Math.max(5, score)));

  return {
    blurScore,
    isBlurry,
    brightness: Math.round(avgLuminance),
    isUnderExposed,
    isOverExposed,
    featureCount,
    hasSufficientFeatures,
    overallScore,
    warnings,
  };
}

function createDefaultQuality(): PhotoQuality {
  return {
    blurScore: 80,
    isBlurry: false,
    brightness: 128,
    isUnderExposed: false,
    isOverExposed: false,
    featureCount: 500,
    hasSufficientFeatures: true,
    overallScore: 85,
    warnings: [],
  };
}
