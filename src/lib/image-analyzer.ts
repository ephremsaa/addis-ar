export interface ImageQualityReport {
  isSharp: boolean;
  sharpness: number; // 0 to 100+
  isTooDark: boolean;
  brightness: number; // 0 to 255
  message?: string;
}

const analysisCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const analysisCtx = analysisCanvas ? analysisCanvas.getContext('2d', { willReadFrequently: true }) : null;

/**
 * Analyzes video stream image quality for sharpness and lighting.
 */
export function analyzeVideoFrame(video: HTMLVideoElement): ImageQualityReport {
  if (!analysisCanvas || !analysisCtx || video.videoWidth === 0 || video.videoHeight === 0) {
    return { isSharp: true, sharpness: 50, isTooDark: false, brightness: 120 };
  }

  // Downsample to 160x120 for 60fps real-time analysis
  const w = 160;
  const h = 120;
  analysisCanvas.width = w;
  analysisCanvas.height = h;

  analysisCtx.drawImage(video, 0, 0, w, h);
  const imgData = analysisCtx.getImageData(0, 0, w, h);
  const data = imgData.data;

  let totalLuminance = 0;
  const gray = new Float32Array(w * h);

  // Convert to grayscale & compute average luminance
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[j] = luma;
    totalLuminance += luma;
  }

  const avgBrightness = totalLuminance / (w * h);

  // Discrete Laplacian edge contrast filter for sharpness
  let laplacianSum = 0;
  let laplacianCount = 0;

  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const idx = y * w + x;
      // 3x3 Laplacian kernel [0, 1, 0, 1, -4, 1, 0, 1, 0]
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

  const sharpness = laplacianCount > 0 ? (laplacianSum / laplacianCount) : 0;
  const isTooDark = avgBrightness < 45;
  const isSharp = sharpness > 8.0; // Sharp threshold

  let message: string | undefined;
  if (isTooDark) message = 'Too dark';
  else if (!isSharp) message = 'Hold steady (blurry)';

  return {
    isSharp,
    sharpness: Math.round(sharpness),
    isTooDark,
    brightness: Math.round(avgBrightness),
    message,
  };
}

/**
 * Grabs a high-resolution snapshot from the video element and returns a JPEG Blob and data URL.
 */
export async function captureFrame(
  video: HTMLVideoElement,
  quality = 0.92
): Promise<{ blob: Blob; dataUrl: string; thumbnailUrl: string }> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1920;
  canvas.height = video.videoHeight || 1080;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D rendering context');

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);

  // Generate lightweight thumbnail for bottom strip
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = 100;
  thumbCanvas.height = 100;
  const thumbCtx = thumbCanvas.getContext('2d');
  if (thumbCtx) {
    // Center crop to square
    const minDim = Math.min(canvas.width, canvas.height);
    const sx = (canvas.width - minDim) / 2;
    const sy = (canvas.height - minDim) / 2;
    thumbCtx.drawImage(canvas, sx, sy, minDim, minDim, 0, 0, 100, 100);
  }
  const thumbnailUrl = thumbCanvas.toDataURL('image/jpeg', 0.8);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to create Blob'))),
      'image/jpeg',
      quality
    );
  });

  return { blob, dataUrl, thumbnailUrl };
}

