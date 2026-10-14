import * as THREE from "three";
import type { EstimatedCameraPose } from "./pose-estimator";

export interface DepthObservation {
  width: number;
  height: number;
  /** Depth values in meters, row-major */
  depthBuffer: Float32Array;
  /** Optional confidence values [0.0 - 1.0], row-major */
  confidenceBuffer?: Float32Array | undefined;
  minValidDepth: number; // e.g. 0.15m
  maxValidDepth: number; // e.g. 1.20m
  timestamp: number;
}

export interface FusedDepthPointCloud {
  positions: Float32Array; // [x, y, z, ...]
  colors: Float32Array; // [r, g, b, ...]
  pointCount: number;
  bounds: {
    min: THREE.Vector3;
    max: THREE.Vector3;
    center: THREE.Vector3;
  };
}

/**
 * Checks whether WebXR Depth Sensing API is available in the current runtime.
 */
export function isWebXRDepthSupported(): boolean {
  if (typeof window === "undefined" || !navigator.xr) return false;
  const win = window as unknown as Record<string, unknown>;
  return (
    typeof win["XRDepthInformation"] !== "undefined" ||
    typeof win["XRCPUDepthInformation"] !== "undefined"
  );
}

/**
 * Validates and calibrates a raw depth buffer from WebXR Depth Sensing or imported ARCore depth map.
 * Rejects non-finite values, zeros, and out-of-range measurements.
 */
export function validateAndCalibrateDepth(
  rawDepth: Float32Array | Uint16Array,
  width: number,
  height: number,
  scaleToMeters: number = 0.001, // ARCore 16-bit depth is in millimeters
  minDepthMeters: number = 0.15,
  maxDepthMeters: number = 1.2,
  confidenceMap?: Uint8Array | Float32Array,
): DepthObservation | null {
  const totalPixels = width * height;
  if (totalPixels === 0 || rawDepth.length < totalPixels) return null;

  const depthBuffer = new Float32Array(totalPixels);
  const confidenceBuffer = confidenceMap ? new Float32Array(totalPixels) : undefined;
  let validCount = 0;

  for (let i = 0; i < totalPixels; i++) {
    const rawVal = rawDepth[i] ?? 0;
    const depthMeters =
      typeof rawDepth === "object" && rawDepth instanceof Uint16Array
        ? rawVal * scaleToMeters
        : rawVal;

    // Check confidence if provided (ARCore confidence is 0-255 or 0-1)
    let conf = 1.0;
    if (confidenceMap && confidenceBuffer) {
      const rawConf = confidenceMap[i] ?? 0;
      conf = rawConf > 1 ? rawConf / 255 : rawConf;
      confidenceBuffer[i] = conf;
    }

    if (
      isFinite(depthMeters) &&
      depthMeters >= minDepthMeters &&
      depthMeters <= maxDepthMeters &&
      conf >= 0.35
    ) {
      depthBuffer[i] = depthMeters;
      validCount++;
    } else {
      depthBuffer[i] = 0; // 0 denotes invalid depth
    }
  }

  // Require at least 5% valid pixels to consider the depth frame useful
  if (validCount < totalPixels * 0.05) {
    return null;
  }

  return {
    width,
    height,
    depthBuffer,
    confidenceBuffer,
    minValidDepth: minDepthMeters,
    maxValidDepth: maxDepthMeters,
    timestamp: Date.now(),
  };
}

export interface DepthCameraPose {
  position: THREE.Vector3;
  viewProjMatrix?: THREE.Matrix4;
  viewMatrix?: THREE.Matrix4;
  matrix?: THREE.Matrix4;
}

/**
 * Fuses calibrated depth observations with 6-DoF camera poses into a metric 3D point cloud.
 * Back-projects pixel coordinates into camera space and transforms to world coordinates.
 */
export function fuseDepthObservations(
  observations: Array<{
    depth: DepthObservation;
    pose: EstimatedCameraPose | DepthCameraPose;
    colorData?: Uint8ClampedArray;
  }>,
  maxPoints: number = 24000,
): FusedDepthPointCloud {
  const worldPoints: Array<{ pos: THREE.Vector3; color: [number, number, number] }> = [];
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

  for (const { depth, pose, colorData } of observations) {
    const { width, height, depthBuffer } = depth;
    const invViewProj = pose.viewProjMatrix
      ? new THREE.Matrix4().copy(pose.viewProjMatrix).invert()
      : "viewMatrix" in pose && pose.viewMatrix
        ? new THREE.Matrix4().copy(pose.viewMatrix).invert()
        : "matrix" in pose && pose.matrix
          ? new THREE.Matrix4().copy(pose.matrix).invert()
          : new THREE.Matrix4().identity();

    // Stride to maintain interactive performance while sampling dense surfaces
    const stride = Math.max(
      2,
      Math.floor(Math.sqrt((width * height * observations.length) / maxPoints)),
    );

    for (let y = 0; y < height; y += stride) {
      for (let x = 0; x < width; x += stride) {
        const idx = y * width + x;
        const d = depthBuffer[idx];
        if (!d || d <= 0) continue;

        // Normalized Device Coordinates [-1, 1]
        const ndcX = (x / width) * 2 - 1;
        const ndcY = -((y / height) * 2 - 1);
        const nearPt = new THREE.Vector3(ndcX, ndcY, -1).applyMatrix4(invViewProj);
        const farPt = new THREE.Vector3(ndcX, ndcY, 1).applyMatrix4(invViewProj);

        const rayDir = new THREE.Vector3().subVectors(farPt, nearPt).normalize();
        const worldPos = new THREE.Vector3().copy(pose.position).addScaledVector(rayDir, d);

        // Fetch RGB color if available
        let r = 0.5,
          g = 0.5,
          b = 0.5;
        if (colorData) {
          const cIdx = (y * width + x) * 4;
          r = (colorData[cIdx] ?? 128) / 255;
          g = (colorData[cIdx + 1] ?? 128) / 255;
          b = (colorData[cIdx + 2] ?? 128) / 255;
        }

        min.min(worldPos);
        max.max(worldPos);

        worldPoints.push({
          pos: worldPos,
          color: [r, g, b],
        });

        if (worldPoints.length >= maxPoints) break;
      }
      if (worldPoints.length >= maxPoints) break;
    }
  }

  const pointCount = worldPoints.length;
  const positions = new Float32Array(pointCount * 3);
  const colors = new Float32Array(pointCount * 3);

  for (let i = 0; i < pointCount; i++) {
    const pt = worldPoints[i];
    if (!pt) continue;
    positions[i * 3] = pt.pos.x;
    positions[i * 3 + 1] = pt.pos.y;
    positions[i * 3 + 2] = pt.pos.z;

    colors[i * 3] = pt.color[0];
    colors[i * 3 + 1] = pt.color[1];
    colors[i * 3 + 2] = pt.color[2];
  }

  const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);

  return {
    positions,
    colors,
    pointCount,
    bounds: { min, max, center },
  };
}
