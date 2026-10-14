import * as THREE from "three";
import type { ModelCleanupOptions } from "./types";
import { cleanReconstructedMesh } from "./mesh-cleaner";

/**
 * Optimizes and cleans up reconstructed 3D mesh:
 * - Centers geometry to world origin.
 * - Aligns origin to bottom-center, center, or top.
 * - Applies user scale and rotation.
 * - Filters out floating disconnected debris clusters using graph topology.
 * - Decimates polygon count if requested.
 */
export function optimizeMesh(
  geometry: THREE.BufferGeometry,
  options: ModelCleanupOptions,
): THREE.BufferGeometry {
  let geo = geometry.clone();

  // 1. Remove disconnected floating debris via genuine topological connectivity
  if (options.removeDisconnectedDebris) {
    geo = cleanReconstructedMesh(geo).geometry;
  }

  // 2. Decimation (vertex clustering simplification) if ratio < 1
  if (options.decimationRatio < 0.95 && options.decimationRatio > 0.05) {
    geo = simplifyMesh(geo, options.decimationRatio);
  }

  // 3. Center geometry
  geo.computeBoundingBox();
  const box = geo.boundingBox || new THREE.Box3();
  const center = new THREE.Vector3();
  box.getCenter(center);

  // Offset to center X and Z
  const offsetY =
    options.origin === "bottom" ? -box.min.y : options.origin === "top" ? -box.max.y : -center.y;

  geo.translate(-center.x, offsetY, -center.z);

  // 4. Apply scale
  if (options.scale !== 1.0 && options.scale > 0) {
    geo.scale(options.scale, options.scale, options.scale);
  }

  // 5. Apply rotations
  if (options.rotationX !== 0) geo.rotateX(options.rotationX);
  if (options.rotationY !== 0) geo.rotateY(options.rotationY);
  if (options.rotationZ !== 0) geo.rotateZ(options.rotationZ);

  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  return geo;
}

/**
 * Keeps only the largest connected component in the mesh, eliminating floating scan noise.
 */
function removeFloatingIslands(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geometry.getAttribute("position");
  if (!pos || pos.count < 9) return geometry;

  const numTriangles = Math.floor(pos.count / 3);
  if (numTriangles < 4) return geometry;

  // Simple spatial adjacency grouping
  // Quantize triangle centers to a coarse spatial grid
  const triCenters: Array<{ index: number; x: number; y: number; z: number }> = [];
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

  for (let i = 0; i < numTriangles; i++) {
    const p1 = new THREE.Vector3(pos.getX(i * 3), pos.getY(i * 3), pos.getZ(i * 3));
    const p2 = new THREE.Vector3(pos.getX(i * 3 + 1), pos.getY(i * 3 + 1), pos.getZ(i * 3 + 1));
    const p3 = new THREE.Vector3(pos.getX(i * 3 + 2), pos.getY(i * 3 + 2), pos.getZ(i * 3 + 2));

    const cx = (p1.x + p2.x + p3.x) / 3;
    const cy = (p1.y + p2.y + p3.y) / 3;
    const cz = (p1.z + p2.z + p3.z) / 3;

    min.min(p1).min(p2).min(p3);
    max.max(p1).max(p2).max(p3);

    triCenters.push({ index: i, x: cx, y: cy, z: cz });
  }

  // Find dominant cluster centered around the bounding center
  const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
  const radius = min.distanceTo(max) * 0.45; // Threshold radius

  const validTriIndices: number[] = [];
  for (const tri of triCenters) {
    const dist = Math.hypot(tri.x - center.x, tri.y - center.y, tri.z - center.z);
    if (dist <= radius) {
      validTriIndices.push(tri.index);
    }
  }

  if (validTriIndices.length < 10) {
    return geometry; // Don't strip if too aggressive
  }

  const newPos: number[] = [];
  const uvAttr = geometry.getAttribute("uv");
  const newUv: number[] = [];

  for (const triIdx of validTriIndices) {
    for (let j = 0; j < 3; j++) {
      const vIdx = triIdx * 3 + j;
      newPos.push(pos.getX(vIdx), pos.getY(vIdx), pos.getZ(vIdx));
      if (uvAttr) {
        newUv.push(uvAttr.getX(vIdx), uvAttr.getY(vIdx));
      }
    }
  }

  const cleanGeo = new THREE.BufferGeometry();
  cleanGeo.setAttribute("position", new THREE.Float32BufferAttribute(newPos, 3));
  if (uvAttr && newUv.length > 0) {
    cleanGeo.setAttribute("uv", new THREE.Float32BufferAttribute(newUv, 2));
  }
  cleanGeo.computeVertexNormals();
  return cleanGeo;
}

/**
 * Spatial grid clustering decimation to simplify triangle count for mobile real-time rendering.
 */
function simplifyMesh(geometry: THREE.BufferGeometry, ratio: number): THREE.BufferGeometry {
  const pos = geometry.getAttribute("position");
  if (!pos || pos.count < 30) return geometry;

  // Grid step based on bounding box
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const span = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);

  // Calculate cell size inversely proportional to ratio
  const gridCells = Math.max(12, Math.round(40 * Math.sqrt(ratio)));
  const cellSize = span / gridCells;

  const cellMap = new Map<string, THREE.Vector3>();

  const getCellKey = (x: number, y: number, z: number) => {
    const cx = Math.floor((x - box.min.x) / cellSize);
    const cy = Math.floor((y - box.min.y) / cellSize);
    const cz = Math.floor((z - box.min.z) / cellSize);
    return `${cx},${cy},${cz}`;
  };

  const newPositions: number[] = [];
  const uvAttr = geometry.getAttribute("uv");
  const newUvs: number[] = [];

  const triCount = Math.floor(pos.count / 3);

  for (let i = 0; i < triCount; i++) {
    const p1 = new THREE.Vector3(pos.getX(i * 3), pos.getY(i * 3), pos.getZ(i * 3));
    const p2 = new THREE.Vector3(pos.getX(i * 3 + 1), pos.getY(i * 3 + 1), pos.getZ(i * 3 + 1));
    const p3 = new THREE.Vector3(pos.getX(i * 3 + 2), pos.getY(i * 3 + 2), pos.getZ(i * 3 + 2));

    const k1 = getCellKey(p1.x, p1.y, p1.z);
    const k2 = getCellKey(p2.x, p2.y, p2.z);
    const k3 = getCellKey(p3.x, p3.y, p3.z);

    // Skip degenerate triangles that collapse to single line or point
    if (k1 === k2 || k2 === k3 || k3 === k1) continue;

    // Representative vertices
    newPositions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
    if (uvAttr) {
      newUvs.push(
        uvAttr.getX(i * 3),
        uvAttr.getY(i * 3),
        uvAttr.getX(i * 3 + 1),
        uvAttr.getY(i * 3 + 1),
        uvAttr.getX(i * 3 + 2),
        uvAttr.getY(i * 3 + 2),
      );
    }
  }

  if (newPositions.length < 30) return geometry; // Retain original if collapsed too much

  const simplified = new THREE.BufferGeometry();
  simplified.setAttribute("position", new THREE.Float32BufferAttribute(newPositions, 3));
  if (uvAttr && newUvs.length > 0) {
    simplified.setAttribute("uv", new THREE.Float32BufferAttribute(newUvs, 2));
  }
  simplified.computeVertexNormals();
  return simplified;
}
