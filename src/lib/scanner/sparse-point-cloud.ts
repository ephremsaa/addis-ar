import * as THREE from 'three';
import type { EstimatedCameraPose, FeatureMatch } from './pose-estimator';

export interface SparsePoint {
  position: THREE.Vector3;
  color: [number, number, number]; // 0-1 range
  reprojectionError: number; // in pixels
  cameraIndices: [number, number];
  trackLength: number;
}

export interface SparsePointCloud {
  points: SparsePoint[];
  pointCount: number;
  meanReprojectionError: number;
  bounds: {
    min: THREE.Vector3;
    max: THREE.Vector3;
    center: THREE.Vector3;
    radius: number;
  };
  positionsBuffer: Float32Array; // [x, y, z, ...]
  colorsBuffer: Float32Array;    // [r, g, b, ...]
}

/**
 * Triangulates 3D points from optical rays of verified camera correspondences.
 * Computes the 3D midpoint of the shortest segment connecting two camera optical rays.
 */
export function triangulatePoint(
  cam1: EstimatedCameraPose,
  cam2: EstimatedCameraPose,
  match: FeatureMatch,
  imgWidth: number,
  imgHeight: number
): { point: THREE.Vector3; reprojectionError: number } | null {
  // Convert 2D pixel coordinates to normalized camera coordinates [-1, 1]
  const ndc1 = new THREE.Vector3(
    (match.kp1.x / imgWidth) * 2 - 1,
    -((match.kp1.y / imgHeight) * 2 - 1),
    0.5
  );
  const ndc2 = new THREE.Vector3(
    (match.kp2.x / imgWidth) * 2 - 1,
    -((match.kp2.y / imgHeight) * 2 - 1),
    0.5
  );

  // Unproject to get ray directions in world space
  const invViewProj1 = new THREE.Matrix4().copy(cam1.viewProjMatrix).invert();
  const invViewProj2 = new THREE.Matrix4().copy(cam2.viewProjMatrix).invert();

  const worldPt1 = ndc1.clone().applyMatrix4(invViewProj1);
  const worldPt2 = ndc2.clone().applyMatrix4(invViewProj2);

  const rayDir1 = new THREE.Vector3().subVectors(worldPt1, cam1.position).normalize();
  const rayDir2 = new THREE.Vector3().subVectors(worldPt2, cam2.position).normalize();

  // Ray-Ray intersection (midpoint of shortest connecting segment)
  const p1 = cam1.position;
  const p2 = cam2.position;
  const d1 = rayDir1;
  const d2 = rayDir2;

  const w0 = new THREE.Vector3().subVectors(p1, p2);
  const a = d1.dot(d1);
  const b = d1.dot(d2);
  const c = d2.dot(d2);
  const d = d1.dot(w0);
  const e = d2.dot(w0);

  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-5) {
    // Parallel rays
    return null;
  }

  const s = (b * e - c * d) / denom;
  const t = (a * e - b * d) / denom;

  // Rays must point forward from both camera centers
  if (s <= 0.1 || t <= 0.1 || s > 6.0 || t > 6.0) {
    return null;
  }

  const ptOnRay1 = new THREE.Vector3().copy(p1).addScaledVector(d1, s);
  const ptOnRay2 = new THREE.Vector3().copy(p2).addScaledVector(d2, t);

  // Segment length is ray discrepancy
  const rayDistance = ptOnRay1.distanceTo(ptOnRay2);
  if (rayDistance > 0.45) {
    // Excessive triangulation baseline error
    return null;
  }

  const midPoint = new THREE.Vector3().addVectors(ptOnRay1, ptOnRay2).multiplyScalar(0.5);

  // Reproject back into both cameras to compute actual reprojection error in pixels
  const proj1 = midPoint.clone().applyMatrix4(cam1.viewProjMatrix);
  const proj2 = midPoint.clone().applyMatrix4(cam2.viewProjMatrix);

  if (proj1.z < -1 || proj1.z > 1 || proj2.z < -1 || proj2.z > 1) {
    return null;
  }

  const reprojectedPx1 = {
    x: ((proj1.x + 1) / 2) * imgWidth,
    y: ((1 - proj1.y) / 2) * imgHeight,
  };
  const reprojectedPx2 = {
    x: ((proj2.x + 1) / 2) * imgWidth,
    y: ((1 - proj2.y) / 2) * imgHeight,
  };

  const err1 = Math.hypot(reprojectedPx1.x - match.kp1.x, reprojectedPx1.y - match.kp1.y);
  const err2 = Math.hypot(reprojectedPx2.x - match.kp2.x, reprojectedPx2.y - match.kp2.y);
  const meanErr = (err1 + err2) / 2;

  if (meanErr > 5.0) {
    // Reject excessive reprojection error
    return null;
  }

  return {
    point: midPoint,
    reprojectionError: meanErr,
  };
}

/**
 * Builds a verified, outlier-filtered sparse point cloud from calibrated camera poses.
 */
export function generateSparsePointCloud(
  cameraPoses: EstimatedCameraPose[],
  featureMatches: Array<{
    camIdx1: number;
    camIdx2: number;
    matches: FeatureMatch[];
  }>,
  imgWidth: number = 320,
  imgHeight: number = 240
): SparsePointCloud {
  const rawPoints: SparsePoint[] = [];

  for (const pair of featureMatches) {
    const cam1 = cameraPoses[pair.camIdx1];
    const cam2 = cameraPoses[pair.camIdx2];
    if (!cam1 || !cam2 || !cam1.isRegistered || !cam2.isRegistered) continue;

    for (const match of pair.matches) {
      const result = triangulatePoint(cam1, cam2, match, imgWidth, imgHeight);
      if (!result) continue;

      // Sample color from camera 1
      const px = Math.min(imgWidth - 1, Math.max(0, Math.floor(match.kp1.x)));
      const py = Math.min(imgHeight - 1, Math.max(0, Math.floor(match.kp1.y)));
      const ctx = cam1.maskContext; // Uses image canvas
      
      // Default color
      let color: [number, number, number] = [0.2, 0.2, 0.25];
      try {
        const p = ctx.getImageData(px % ctx.canvas.width, py % ctx.canvas.height, 1, 1).data;
        color = [p[0] / 255, p[1] / 255, p[2] / 255];
      } catch {
        // Fallback color
      }

      rawPoints.push({
        position: result.point,
        color,
        reprojectionError: result.reprojectionError,
        cameraIndices: [pair.camIdx1, pair.camIdx2],
        trackLength: 2,
      });
    }
  }

  // Statistical Outlier Removal (SOR):
  // Filter points whose distance from the cluster center is beyond 2.5 standard deviations
  const validPoints = filterStatisticalOutliers(rawPoints);

  // Compute bounding box and center
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

  const numPts = validPoints.length;
  const positionsBuffer = new Float32Array(numPts * 3);
  const colorsBuffer = new Float32Array(numPts * 3);
  let totalError = 0;

  for (let i = 0; i < numPts; i++) {
    const pt = validPoints[i];
    positionsBuffer[i * 3] = pt.position.x;
    positionsBuffer[i * 3 + 1] = pt.position.y;
    positionsBuffer[i * 3 + 2] = pt.position.z;

    colorsBuffer[i * 3] = pt.color[0];
    colorsBuffer[i * 3 + 1] = pt.color[1];
    colorsBuffer[i * 3 + 2] = pt.color[2];

    min.min(pt.position);
    max.max(pt.position);
    totalError += pt.reprojectionError;
  }

  const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
  const radius = min.distanceTo(max) * 0.5 || 1.0;
  const meanReprojectionError = numPts > 0 ? Number((totalError / numPts).toFixed(2)) : 0;

  return {
    points: validPoints,
    pointCount: numPts,
    meanReprojectionError,
    bounds: {
      min,
      max,
      center,
      radius,
    },
    positionsBuffer,
    colorsBuffer,
  };
}

/**
 * Statistical distance filtering to discard flying noise particles.
 */
function filterStatisticalOutliers(points: SparsePoint[]): SparsePoint[] {
  if (points.length < 20) return points;

  // Compute centroid
  const centroid = new THREE.Vector3();
  for (const pt of points) {
    centroid.add(pt.position);
  }
  centroid.divideScalar(points.length);

  // Compute distances to centroid
  const distances: number[] = [];
  let sumDist = 0;
  for (const pt of points) {
    const d = pt.position.distanceTo(centroid);
    distances.push(d);
    sumDist += d;
  }

  const meanDist = sumDist / points.length;
  let variance = 0;
  for (const d of distances) {
    variance += (d - meanDist) ** 2;
  }
  const stdDist = Math.sqrt(variance / points.length);

  // Keep points within 2.3 standard deviations and within 2.2m of origin
  const threshold = meanDist + stdDist * 2.3;
  return points.filter((pt, i) => distances[i] <= threshold && distances[i] <= 2.2);
}
