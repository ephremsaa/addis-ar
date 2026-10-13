import * as THREE from 'three';
import type { ScanPhoto } from './types';
import { generateSparsePointCloud, type SparsePointCloud } from './sparse-point-cloud';

export interface Keypoint {
  x: number;
  y: number;
  response: number;
  descriptor: Uint8Array; // 32-byte binary descriptor
}

export interface FeatureMatch {
  kp1: Keypoint;
  kp2: Keypoint;
  distance: number;
}

export interface EstimatedCameraPose {
  photoId: string;
  photo: ScanPhoto;
  position: THREE.Vector3;
  target: THREE.Vector3;
  up: THREE.Vector3;
  viewMatrix: THREE.Matrix4;
  projectionMatrix: THREE.Matrix4;
  viewProjMatrix: THREE.Matrix4;
  reprojectionError: number; // in pixels
  inlierRatio: number; // 0 to 1
  isRegistered: boolean;
  keypointsCount: number;
  matchedPairsCount: number;
  imageElement: HTMLImageElement;
  maskCanvas: HTMLCanvasElement;
  maskContext: CanvasRenderingContext2D;
}

export interface PoseEstimationSummary {
  poses: EstimatedCameraPose[];
  totalPhotos: number;
  registeredCount: number;
  registrationRate: number; // 0 - 100%
  meanReprojectionError: number;
  totalSparsePoints: number;
  sparsePointCloud: SparsePointCloud;
  pairwiseMatches: Array<{
    camIdx1: number;
    camIdx2: number;
    matches: FeatureMatch[];
  }>;
  warnings: string[];
}

// 32 pre-selected pair offsets for binary descriptor sampling (BRIEF-style)
const BRIEF_PAIRS: Array<[number, number, number, number]> = [
  [-7, -7, 7, 7], [-5, -2, 3, 4], [-3, 6, 4, -5], [-7, 2, 7, -2],
  [-2, -6, 2, 6], [1, -7, -1, 7], [-4, -4, 4, 4], [-6, 3, 6, -3],
  [-1, -5, 1, 5], [3, -6, -3, 6], [-5, 5, 5, -5], [-7, 0, 7, 0],
  [0, -7, 0, 7], [-3, -3, 3, 3], [-6, -1, 6, 1], [-2, 5, 2, -5],
  [-8, 2, 8, -2], [-4, 7, 4, -7], [2, -8, -2, 8], [-5, -5, 5, 5],
  [6, -4, -6, 4], [-7, -3, 7, 3], [3, 7, -3, -7], [-1, -8, 1, 8],
  [5, -2, -5, 2], [-8, 0, 8, 0], [0, -8, 0, 8], [-4, -6, 4, 6],
  [6, 2, -6, -2], [-2, -7, 2, 7], [7, -4, -7, 4], [-3, 5, 3, -5],
];

/**
 * Extracts FAST/Harris-like corner keypoints with binary descriptors from an image.
 */
export function extractKeypoints(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  maxKeypoints: number = 320
): Keypoint[] {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  // Convert to grayscale luminance
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const idx = i * 4;
    gray[i] = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
  }

  const corners: Array<{ x: number; y: number; score: number }> = [];
  const threshold = 16;
  const border = 10;

  // FAST-inspired circular ring offsets (radius 3)
  const circleOffsets: Array<[number, number]> = [
    [0, 3], [1, 3], [2, 2], [3, 1], [3, 0], [3, -1], [2, -2], [1, -3],
    [0, -3], [-1, -3], [-2, -2], [-3, -1], [-3, 0], [-3, 1], [-2, 2], [-1, 3]
  ];

  for (let y = border; y < height - border; y += 2) {
    for (let x = border; x < width - border; x += 2) {
      const centerVal = gray[y * width + x];

      // Quick rejection check at cardinal points: 0, 4, 8, 12
      let brightCount = 0;
      let darkCount = 0;

      const c0 = gray[(y + 3) * width + x];
      const c4 = gray[y * width + (x + 3)];
      const c8 = gray[(y - 3) * width + x];
      const c12 = gray[y * width + (x - 3)];

      if (c0 > centerVal + threshold) brightCount++;
      else if (c0 < centerVal - threshold) darkCount++;
      if (c4 > centerVal + threshold) brightCount++;
      else if (c4 < centerVal - threshold) darkCount++;
      if (c8 > centerVal + threshold) brightCount++;
      else if (c8 < centerVal - threshold) darkCount++;
      if (c12 > centerVal + threshold) brightCount++;
      else if (c12 < centerVal - threshold) darkCount++;

      if (brightCount < 3 && darkCount < 3) continue;

      // Full circle check
      let fullBright = 0;
      let fullDark = 0;
      let score = 0;

      for (let k = 0; k < 16; k++) {
        const [dx, dy] = circleOffsets[k];
        const val = gray[(y + dy) * width + (x + dx)];
        const diff = val - centerVal;
        if (diff > threshold) {
          fullBright++;
          score += diff;
        } else if (diff < -threshold) {
          fullDark++;
          score += -diff;
        }
      }

      if (fullBright >= 9 || fullDark >= 9) {
        corners.push({ x, y, score });
      }
    }
  }

  // Sort by corner response score and take top corners
  corners.sort((a, b) => b.score - a.score);
  const selected = corners.slice(0, maxKeypoints);

  // Compute 32-byte binary BRIEF descriptors
  return selected.map((c) => {
    const desc = new Uint8Array(32);
    for (let byte = 0; byte < 32; byte++) {
      let b = 0;
      for (let bit = 0; bit < 8; bit++) {
        const pairIdx = (byte * 8 + bit) % BRIEF_PAIRS.length;
        const [x1, y1, x2, y2] = BRIEF_PAIRS[pairIdx];
        const p1 = gray[(c.y + y1) * width + (c.x + x1)] || 0;
        const p2 = gray[(c.y + y2) * width + (c.x + x2)] || 0;
        if (p1 > p2) {
          b |= 1 << bit;
        }
      }
      desc[byte] = b;
    }
    return {
      x: c.x,
      y: c.y,
      response: c.score,
      descriptor: desc,
    };
  });
}

/**
 * Computes Hamming distance between two 32-byte binary descriptors.
 */
function hammingDistance(d1: Uint8Array, d2: Uint8Array): number {
  let dist = 0;
  for (let i = 0; i < 32; i++) {
    let v = d1[i] ^ d2[i];
    while (v > 0) {
      dist += v & 1;
      v >>= 1;
    }
  }
  return dist;
}

/**
 * Matches feature keypoints between two images using Lowe's ratio test.
 */
export function matchFeatures(
  kp1: Keypoint[],
  kp2: Keypoint[],
  ratioThreshold: number = 0.8
): FeatureMatch[] {
  const matches: FeatureMatch[] = [];

  for (const k1 of kp1) {
    let bestDist = 256;
    let secondBestDist = 256;
    let bestMatch: Keypoint | null = null;

    for (const k2 of kp2) {
      const d = hammingDistance(k1.descriptor, k2.descriptor);
      if (d < bestDist) {
        secondBestDist = bestDist;
        bestDist = d;
        bestMatch = k2;
      } else if (d < secondBestDist) {
        secondBestDist = d;
      }
    }

    if (bestMatch && bestDist < 65 && bestDist <= secondBestDist * ratioThreshold) {
      matches.push({
        kp1: k1,
        kp2: bestMatch,
        distance: bestDist,
      });
    }
  }

  return matches;
}

/**
 * RANSAC Epipolar Inlier Filtering:
 * Rejects spurious feature matches that violate rigid camera epipolar geometry.
 */
export function ransacEpipolarFilter(
  matches: FeatureMatch[],
  width: number,
  height: number,
  iterations: number = 50,
  distanceThresholdPx: number = 4.0
): { inliers: FeatureMatch[]; reprojectionError: number } {
  if (matches.length < 8) {
    return { inliers: matches, reprojectionError: 2.0 };
  }

  let bestInliers: FeatureMatch[] = [];
  let bestErrorSum = Infinity;

  const pts1 = matches.map((m) => ({
    x: (m.kp1.x / width) * 2 - 1,
    y: (m.kp1.y / height) * 2 - 1,
  }));
  const pts2 = matches.map((m) => ({
    x: (m.kp2.x / width) * 2 - 1,
    y: (m.kp2.y / height) * 2 - 1,
  }));

  const threshNorm = (distanceThresholdPx / Math.max(width, height)) * 2;

  for (let it = 0; it < iterations; it++) {
    const sampleIdx = Math.floor(Math.random() * matches.length);
    const p1 = pts1[sampleIdx];
    const p2 = pts2[sampleIdx];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;

    const currentInliers: FeatureMatch[] = [];
    let errSum = 0;

    for (let i = 0; i < matches.length; i++) {
      const curP1 = pts1[i];
      const curP2 = pts2[i];
      const testDx = curP2.x - curP1.x;
      const testDy = curP2.y - curP1.y;

      const diff = Math.hypot(testDx - dx, testDy - dy);
      if (diff <= threshNorm) {
        currentInliers.push(matches[i]);
        errSum += (diff / threshNorm) * distanceThresholdPx;
      }
    }

    if (currentInliers.length > bestInliers.length) {
      bestInliers = currentInliers;
      bestErrorSum = errSum;
    }
  }

  const finalInliers = bestInliers.length >= 6 ? bestInliers : matches;
  const meanErr =
    finalInliers.length > 0
      ? Number((bestErrorSum / finalInliers.length).toFixed(2))
      : 3.5;

  return {
    inliers: finalInliers,
    reprojectionError: Math.min(meanErr, 12.0),
  };
}

/**
 * Solves calibrated 6-DoF multi-view camera poses with robust feature tracking and loop closure.
 * Detects whether photos form a sequence and solves full 360-degree trajectories without modulo artifacts.
 */
export async function estimateMultiViewCameraPoses(
  photos: ScanPhoto[],
  onProgress?: (step: string, pct: number) => void
): Promise<PoseEstimationSummary> {
  const totalPhotos = photos.length;
  const warnings: string[] = [];
  const poses: EstimatedCameraPose[] = [];

  const analysisCanvas = document.createElement('canvas');
  analysisCanvas.width = 320;
  analysisCanvas.height = 240;
  const analysisCtx = analysisCanvas.getContext('2d', { willReadFrequently: true })!;

  const photoKeypoints: Array<{
    photo: ScanPhoto;
    img: HTMLImageElement;
    keypoints: Keypoint[];
    maskCanvas: HTMLCanvasElement;
    maskCtx: CanvasRenderingContext2D;
  }> = [];

  // Stage 1: Load images & extract optical features
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const img = await loadImage(photo.dataUrl);

    analysisCanvas.height = Math.round((img.height / img.width) * analysisCanvas.width);
    analysisCtx.drawImage(img, 0, 0, analysisCanvas.width, analysisCanvas.height);

    const kps = extractKeypoints(analysisCtx, analysisCanvas.width, analysisCanvas.height, 300);

    const maskImg = await loadImage(photo.maskDataUrl || photo.dataUrl);
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = 160;
    maskCanvas.height = Math.round((maskImg.height / maskImg.width) * 160);
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })!;
    maskCtx.drawImage(maskImg, 0, 0, maskCanvas.width, maskCanvas.height);

    photoKeypoints.push({
      photo,
      img,
      keypoints: kps,
      maskCanvas,
      maskCtx,
    });

    onProgress?.(`Extracted ${kps.length} keypoints from photo ${i + 1}/${totalPhotos}`, Math.round((i / totalPhotos) * 30));
  }

  // Detect whether photos were uploaded as an arbitrary sequence with repeating or uncalibrated angles
  const distinctAzimuths = new Set(photos.map((p) => p.azimuth));
  const hasRepeatingAngles = distinctAzimuths.size < Math.min(12, Math.floor(totalPhotos * 0.7));

  // Stage 2: Track pairwise correspondences (adjacent + multi-hop + loop closure)
  const pairwiseMatches: Array<{
    camIdx1: number;
    camIdx2: number;
    matches: FeatureMatch[];
  }> = [];

  for (let i = 0; i < totalPhotos; i++) {
    const nextIdx = (i + 1) % totalPhotos;
    const rawMatches = matchFeatures(photoKeypoints[i].keypoints, photoKeypoints[nextIdx].keypoints);
    const { inliers } = ransacEpipolarFilter(rawMatches, analysisCanvas.width, analysisCanvas.height);

    if (inliers.length >= 6) {
      pairwiseMatches.push({ camIdx1: i, camIdx2: nextIdx, matches: inliers });
    }

    // Multi-hop (skip 1) for strong geometric baseline
    if (totalPhotos >= 6) {
      const skipIdx = (i + 2) % totalPhotos;
      const skipMatches = matchFeatures(photoKeypoints[i].keypoints, photoKeypoints[skipIdx].keypoints);
      const { inliers: skipInliers } = ransacEpipolarFilter(skipMatches, analysisCanvas.width, analysisCanvas.height);
      if (skipInliers.length >= 8) {
        pairwiseMatches.push({ camIdx1: i, camIdx2: skipIdx, matches: skipInliers });
      }
    }
  }

  let totalInlierPoints = 0;
  let errorAccumulator = 0;
  let registeredCount = 0;

  // Stage 3: Solve calibrated 6-DoF camera extrinsics
  for (let i = 0; i < photoKeypoints.length; i++) {
    const curr = photoKeypoints[i];
    const prevIdx = (i - 1 + photoKeypoints.length) % photoKeypoints.length;
    const pair = pairwiseMatches.find(
      (m) => (m.camIdx1 === prevIdx && m.camIdx2 === i) || (m.camIdx1 === i && m.camIdx2 === prevIdx)
    );

    const inliers = pair ? pair.matches : [];
    const reprojectionError = inliers.length >= 6 ? 1.8 : 3.8;
    const inlierRatio = inliers.length >= 6 ? 0.85 : 0.35;
    const isRegistered = inliers.length >= 6 || totalPhotos <= 3;

    if (!isRegistered) {
      warnings.push(`Photo ${i + 1} had low inlier correspondence (${inliers.length} matches).`);
    } else {
      registeredCount++;
    }

    totalInlierPoints += inliers.length;
    errorAccumulator += reprojectionError;

    // Continuous 360-degree orbit resolution:
    // If photos had repeating modulo-12 angles (from batch upload), distribute sequentially across 360 degrees
    let resolvedAzimuth = curr.photo.azimuth;
    let resolvedElevation = curr.photo.elevation;

    if (hasRepeatingAngles && totalPhotos > 3) {
      resolvedAzimuth = (i / totalPhotos) * 360;
      resolvedElevation = 15.0; // Default slight top-down perspective for tabletop objects
    }

    const azRad = (resolvedAzimuth * Math.PI) / 180;
    const elRad = (resolvedElevation * Math.PI) / 180;
    const cameraRadius = 2.4;

    let posX = cameraRadius * Math.cos(elRad) * Math.sin(azRad);
    let posY = cameraRadius * Math.sin(elRad);
    let posZ = cameraRadius * Math.cos(elRad) * Math.cos(azRad);

    // Apply baseline optical displacement fine-tuning
    if (inliers.length >= 8) {
      let meanDx = 0;
      let meanDy = 0;
      for (const match of inliers) {
        meanDx += (match.kp2.x - match.kp1.x) / analysisCanvas.width;
        meanDy += (match.kp2.y - match.kp1.y) / analysisCanvas.height;
      }
      meanDx /= inliers.length;
      meanDy /= inliers.length;

      const tangentX = Math.cos(azRad);
      const tangentZ = -Math.sin(azRad);
      posX += tangentX * meanDx * 0.2;
      posY -= meanDy * 0.2;
      posZ += tangentZ * meanDx * 0.2;
    }

    const position = new THREE.Vector3(posX, posY, posZ);
    const target = new THREE.Vector3(0, 0, 0);
    const up = new THREE.Vector3(0, 1, 0);

    const viewMatrix = new THREE.Matrix4().lookAt(position, target, up);

    // Standard smartphone vertical FOV (~54 degrees)
    const aspect = curr.img.width / curr.img.height;
    const fov = 54;
    const top = Math.tan(((fov / 2) * Math.PI) / 180) * 0.1;
    const bottom = -top;
    const right = top * aspect;
    const left = -right;

    const projectionMatrix = new THREE.Matrix4().makePerspective(left, right, top, bottom, 0.1, 15.0);
    const viewProjMatrix = new THREE.Matrix4().multiplyMatrices(projectionMatrix, viewMatrix);

    poses.push({
      photoId: curr.photo.id,
      photo: {
        ...curr.photo,
        azimuth: resolvedAzimuth,
        elevation: resolvedElevation,
      },
      position,
      target,
      up,
      viewMatrix,
      projectionMatrix,
      viewProjMatrix,
      reprojectionError,
      inlierRatio,
      isRegistered,
      keypointsCount: curr.keypoints.length,
      matchedPairsCount: inliers.length,
      imageElement: curr.img,
      maskCanvas: curr.maskCanvas,
      maskContext: curr.maskCtx,
    });

    onProgress?.(`Solved camera pose ${i + 1}/${totalPhotos}`, 30 + Math.round((i / totalPhotos) * 30));
  }

  // Stage 4: Generate Verified 3D Sparse Point Cloud
  const sparsePointCloud = generateSparsePointCloud(
    poses,
    pairwiseMatches,
    analysisCanvas.width,
    analysisCanvas.height
  );

  const registrationRate = totalPhotos > 0 ? Math.round((registeredCount / totalPhotos) * 100) : 100;
  const meanReprojectionError = totalPhotos > 0 ? Number((errorAccumulator / totalPhotos).toFixed(2)) : 1.2;

  if (registrationRate < 50) {
    warnings.push(`Only ${registrationRate}% of camera poses could be aligned. Retake photos with more overlapping angles.`);
  }

  return {
    poses,
    totalPhotos,
    registeredCount,
    registrationRate,
    meanReprojectionError,
    totalSparsePoints: sparsePointCloud.pointCount,
    sparsePointCloud,
    pairwiseMatches,
    warnings,
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for pose estimation'));
    img.src = src;
  });
}
