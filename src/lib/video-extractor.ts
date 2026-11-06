/**
 * Addis AR · Video Frame Extractor & Motion Blur Filter
 * ====================================================
 * Extracts 60-100 sharp, uniformly distributed angle frames from a 20-40s orbit video.
 * Uses discrete Laplacian variance to reject motion-blurred frames and bins frames
 * by gyroscope azimuth & elevation for optimal photogrammetric triangulation.
 */

import type { CameraPose } from '../types/scanner';

export interface SensorSample {
  timestamp: number; // ms from video start
  azimuth: number; // 0..360°
  elevation: number; // 0..90°
  roll: number;
  pose?: CameraPose;
}

export interface ExtractedFrame {
  id: string;
  blob: Blob;
  dataUrl: string;
  thumbnailUrl: string;
  azimuth: number;
  elevation: number;
  sharpness: number;
  brightness: number;
  timestamp: number;
  pose?: CameraPose;
}

/**
 * Computes variance of Laplacian for blur detection.
 */
export function computeLaplacianVariance(
  ctx: CanvasRenderingContext2D,
  _width?: number,
  _height?: number
): { variance: number; brightness: number } {
  // Downsample to 160x120 for fast calculation
  const sw = 160;
  const sh = 120;
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = sw;
  tempCanvas.height = sh;
  const tCtx = tempCanvas.getContext('2d')!;
  tCtx.drawImage(ctx.canvas, 0, 0, sw, sh);

  const imgData = tCtx.getImageData(0, 0, sw, sh);
  const data = imgData.data;
  const gray = new Float32Array(sw * sh);
  let totalLuma = 0;

  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[j] = luma;
    totalLuma += luma;
  }

  const avgBrightness = totalLuma / (sw * sh);

  // Discrete Laplacian: [0, 1, 0; 1, -4, 1; 0, 1, 0]
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const idx = y * sw + x;
      const lap =
        gray[idx - sw] +
        gray[idx + sw] +
        gray[idx - 1] +
        gray[idx + 1] -
        4 * gray[idx];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  const mean = count > 0 ? sum / count : 0;
  const variance = count > 0 ? sumSq / count - mean * mean : 0;

  return { variance: Math.round(variance * 10) / 10, brightness: Math.round(avgBrightness) };
}

/**
 * Extracts 60 to 100 uniformly distributed, sharp frames from recorded video.
 */
export async function extractFramesFromVideo(
  videoBlob: Blob,
  sensorSamples: SensorSample[],
  targetCount = 80,
  onProgress?: (progress: number, message: string) => void
): Promise<ExtractedFrame[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    const videoUrl = URL.createObjectURL(videoBlob);
    video.src = videoUrl;

    video.onloadedmetadata = async () => {
      try {
        const duration = video.duration || 20;
        const width = video.videoWidth || 1920;
        const height = video.videoHeight || 1080;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Could not create canvas context');

        // Sample at least 150 candidate time slices
        const candidateCount = Math.max(120, Math.min(220, Math.floor(duration * 8)));
        const step = duration / candidateCount;

        const candidateFrames: Array<{
          time: number;
          dataUrl: string;
          blob: Blob;
          thumbnailUrl: string;
          variance: number;
          brightness: number;
          azimuth: number;
          elevation: number;
          pose?: CameraPose;
        }> = [];

        if (onProgress) onProgress(10, `Scanning ${candidateCount} video timeframes for sharpness...`);

        // Helper to interpolate sensor azimuth & elevation for a given time in seconds
        const getInterpolatedSensor = (timeSec: number) => {
          const timeMs = timeSec * 1000;
          if (sensorSamples.length === 0) {
            // Fallback estimation
            const norm = (timeSec / duration) % 1.0;
            return { azimuth: norm * 360, elevation: 25, pose: undefined };
          }
          // Find closest sample
          let closest = sensorSamples[0];
          let minDiff = Math.abs(closest.timestamp - timeMs);
          for (let i = 1; i < sensorSamples.length; i++) {
            const diff = Math.abs(sensorSamples[i].timestamp - timeMs);
            if (diff < minDiff) {
              minDiff = diff;
              closest = sensorSamples[i];
            }
          }
          return {
            azimuth: closest.azimuth,
            elevation: closest.elevation,
            pose: closest.pose,
          };
        };

        // Seek frame by frame
        for (let i = 0; i < candidateCount; i++) {
          const seekTime = Math.min(duration - 0.05, i * step);
          await seekToTime(video, seekTime);

          ctx.drawImage(video, 0, 0, width, height);
          const { variance, brightness } = computeLaplacianVariance(ctx, width, height);

          // Discard dark or blurry frames
          if (variance > 12 && brightness > 30) {
            const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
            const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.92));

            // Small thumbnail for UI tray
            const thumbCanvas = document.createElement('canvas');
            thumbCanvas.width = 96;
            thumbCanvas.height = 96;
            const tCtx = thumbCanvas.getContext('2d')!;
            const minDim = Math.min(width, height);
            tCtx.drawImage(canvas, (width - minDim) / 2, (height - minDim) / 2, minDim, minDim, 0, 0, 96, 96);
            const thumbnailUrl = thumbCanvas.toDataURL('image/jpeg', 0.75);

            const sensor = getInterpolatedSensor(seekTime);

            candidateFrames.push({
              time: seekTime,
              dataUrl,
              blob,
              thumbnailUrl,
              variance,
              brightness,
              azimuth: sensor.azimuth,
              elevation: sensor.elevation,
              pose: sensor.pose,
            });
          }

          if (i % 15 === 0 && onProgress) {
            const prog = 10 + Math.floor((i / candidateCount) * 45);
            onProgress(prog, `Analyzed ${i + 1}/${candidateCount} frames (${candidateFrames.length} sharp candidates)...`);
          }
        }

        URL.revokeObjectURL(videoUrl);

        if (onProgress) onProgress(60, 'Balancing angular coverage for COLMAP...');

        // Bin candidate frames uniformly by azimuth (36 bins of 10°) and 3 height levels
        const bins: Record<string, typeof candidateFrames> = {};
        for (const frame of candidateFrames) {
          const azBin = Math.floor((((frame.azimuth % 360) + 360) % 360) / 10); // 0..35
          const elTier = frame.elevation < 30 ? 'low' : frame.elevation < 60 ? 'high' : 'top';
          const key = `${elTier}-${azBin}`;
          if (!bins[key]) bins[key] = [];
          bins[key].push(frame);
        }

        // Pick highest sharpness frame from each occupied bin
        const selected: ExtractedFrame[] = [];
        for (const key of Object.keys(bins)) {
          const list = bins[key];
          list.sort((a, b) => b.variance - a.variance); // Sharpest first
          const best = list[0];
          selected.push({
            id: `frame-${Date.now()}-${selected.length}`,
            blob: best.blob,
            dataUrl: best.dataUrl,
            thumbnailUrl: best.thumbnailUrl,
            azimuth: best.azimuth,
            elevation: best.elevation,
            sharpness: best.variance,
            brightness: best.brightness,
            timestamp: Math.round(best.time * 1000),
            pose: best.pose,
          });
        }

        // If we still need more to reach targetCount (e.g. 60-100), fill in next sharpest candidates
        if (selected.length < targetCount && candidateFrames.length > selected.length) {
          const remaining = candidateFrames.filter(
            (c) => !selected.some((s) => s.timestamp === Math.round(c.time * 1000))
          );
          remaining.sort((a, b) => b.variance - a.variance);
          for (const rem of remaining) {
            if (selected.length >= targetCount) break;
            selected.push({
              id: `frame-${Date.now()}-${selected.length}`,
              blob: rem.blob,
              dataUrl: rem.dataUrl,
              thumbnailUrl: rem.thumbnailUrl,
              azimuth: rem.azimuth,
              elevation: rem.elevation,
              sharpness: rem.variance,
              brightness: rem.brightness,
              timestamp: Math.round(rem.time * 1000),
              pose: rem.pose,
            });
          }
        }

        // Sort frames chronologically for smooth sequence matching
        selected.sort((a, b) => a.timestamp - b.timestamp);

        if (onProgress) onProgress(100, `Selected ${selected.length} high-quality sharp frames!`);
        resolve(selected);
      } catch (err) {
        reject(err);
      }
    };

    video.onerror = (_e) => reject(new Error('Failed to load recorded video for frame extraction.'));
  });
}

function seekToTime(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const handleSeeked = () => {
      video.removeEventListener('seeked', handleSeeked);
      resolve();
    };
    video.addEventListener('seeked', handleSeeked);
    video.currentTime = time;
  });
}

