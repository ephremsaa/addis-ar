/**
 * Addis AR · Marching Cubes Polygonizer
 * =====================================
 * Converts a 3D Scalar / Occupancy field into an organic triangular surface mesh.
 * Used for Visual Hull & Neural Surface Extraction to rebuild the real product geometry.
 */

import * as THREE from 'three';

// Edge table (256 entries) mapping cube configuration to intersecting edges
const EDGE_TABLE = new Int32Array([
  0x0, 0x109, 0x203, 0x30a, 0x406, 0x50f, 0x605, 0x70c,
  0x80c, 0x905, 0xa0f, 0xb06, 0xc0a, 0xd03, 0xe09, 0xf00,
  0x190, 0x99, 0x393, 0x29a, 0x596, 0x49f, 0x795, 0x69c,
  0x99c, 0x895, 0xb9f, 0xa96, 0xd9a, 0xc93, 0xf99, 0xe90,
  0x230, 0x339, 0x33, 0x13a, 0x636, 0x73f, 0x435, 0x53c,
  0xa3c, 0xb35, 0x83f, 0x936, 0xe3a, 0xf33, 0xc39, 0xd30,
  0x3a0, 0x2a9, 0x1a3, 0xaa, 0x7a6, 0x6af, 0x5a5, 0x4ac,
  0xba0, 0xaa5, 0x9af, 0x8a6, 0xfaa, 0xea3, 0xda9, 0xca0,
  0x460, 0x569, 0x663, 0x76a, 0x66, 0x16f, 0x265, 0x36c,
  0xc6c, 0xd65, 0xe6f, 0xf66, 0x86a, 0x963, 0xa69, 0xb60,
  0x5f0, 0x4f9, 0x7f3, 0x6fa, 0x1f6, 0xff, 0x3f5, 0x2fc,
  0xdfc, 0xcf5, 0xfff, 0xef6, 0x9fa, 0x8f3, 0xbf9, 0xaf0,
  0x650, 0x759, 0x453, 0x55a, 0x256, 0x35f, 0x55, 0x15c,
  0xe5c, 0xf55, 0xc5f, 0xd56, 0xa5a, 0xb53, 0x859, 0x950,
  0x7c0, 0x6c9, 0x5c3, 0x4ca, 0x3c6, 0x2cf, 0x1c5, 0xcc,
  0xfcc, 0xec5, 0xdcf, 0xcc6, 0xbca, 0xac3, 0x9c9, 0x8c0,
  0x8c0, 0x9c9, 0xac3, 0xbca, 0xcc6, 0xdcf, 0xec5, 0xfcc,
  0xcc, 0x1c5, 0x2cf, 0x3c6, 0x4ca, 0x5c3, 0x6c9, 0x7c0,
  0x950, 0x859, 0xb53, 0xa5a, 0xd56, 0xc5f, 0xf55, 0xe5c,
  0x15c, 0x55, 0x35f, 0x256, 0x55a, 0x453, 0x759, 0x650,
  0xaf0, 0xbf9, 0x8f3, 0x9fa, 0xef6, 0xfff, 0xcf5, 0xdfc,
  0x2fc, 0x3f5, 0xff, 0x1f6, 0x6fa, 0x7f3, 0x4f9, 0x5f0,
  0xb60, 0xa69, 0x963, 0x86a, 0xf66, 0xe6f, 0xd65, 0xc6c,
  0x36c, 0x265, 0x16f, 0x66, 0x76a, 0x663, 0x569, 0x460,
  0xca0, 0xda9, 0xea3, 0xfaa, 0x8a6, 0x9af, 0xaa5, 0xba0,
  0x4ac, 0x5a5, 0x6af, 0x7a6, 0xaa, 0x1a3, 0x2a9, 0x3a0,
  0xd30, 0xc39, 0xf33, 0xe3a, 0x936, 0x83f, 0xb35, 0xa3c,
  0x53c, 0x435, 0x73f, 0x636, 0x13a, 0x33, 0x339, 0x230,
  0xe90, 0xf99, 0xc93, 0xd9a, 0xa96, 0xb9f, 0x895, 0x99c,
  0x69c, 0x795, 0x49f, 0x596, 0x29a, 0x393, 0x99, 0x190,
  0xf00, 0xe09, 0xd03, 0xc0a, 0xb06, 0xa0f, 0x905, 0x80c,
  0x70c, 0x605, 0x50f, 0x406, 0x30a, 0x203, 0x109, 0x0
]);

// Triangle table (256 * 16 entries)
// Packaged for efficient execution
import { TRI_TABLE } from './marching-cubes-table';

export interface VoxelGrid {
  values: Float32Array; // Flattened 3D grid [x + y * nx + z * nx * ny]
  nx: number;
  ny: number;
  nz: number;
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * Runs Marching Cubes on a 3D Voxel Occupancy Field.
 * Returns a clean Three.js BufferGeometry with extracted surface vertices and normals.
 */
export function polygonizeVoxelGrid(
  grid: VoxelGrid,
  isolevel: number = 0.5
): THREE.BufferGeometry {
  const { values, nx, ny, nz, min, max } = grid;
  const dx = (max[0] - min[0]) / (nx - 1);
  const dy = (max[1] - min[1]) / (ny - 1);
  const dz = (max[2] - min[2]) / (nz - 1);

  const vertices: number[] = [];
  const edgeVertices = new Float32Array(12 * 3);

  // Helper to index grid
  const idx = (x: number, y: number, z: number) => x + y * nx + z * nx * ny;

  // Vertex position helper
  const getPos = (x: number, y: number, z: number): [number, number, number] => [
    min[0] + x * dx,
    min[1] + y * dy,
    min[2] + z * dz,
  ];

  for (let z = 0; z < nz - 1; z++) {
    for (let y = 0; y < ny - 1; y++) {
      for (let x = 0; x < nx - 1; x++) {
        // 8 corner values
        const v0 = values[idx(x, y, z)];
        const v1 = values[idx(x + 1, y, z)];
        const v2 = values[idx(x + 1, y, z + 1)];
        const v3 = values[idx(x, y, z + 1)];
        const v4 = values[idx(x, y + 1, z)];
        const v5 = values[idx(x + 1, y + 1, z)];
        const v6 = values[idx(x + 1, y + 1, z + 1)];
        const v7 = values[idx(x, y + 1, z + 1)];

        // Cube index
        let cubeindex = 0;
        if (v0 < isolevel) cubeindex |= 1;
        if (v1 < isolevel) cubeindex |= 2;
        if (v2 < isolevel) cubeindex |= 4;
        if (v3 < isolevel) cubeindex |= 8;
        if (v4 < isolevel) cubeindex |= 16;
        if (v5 < isolevel) cubeindex |= 32;
        if (v6 < isolevel) cubeindex |= 64;
        if (v7 < isolevel) cubeindex |= 128;

        if (EDGE_TABLE[cubeindex] === 0) continue;

        const p0 = getPos(x, y, z);
        const p1 = getPos(x + 1, y, z);
        const p2 = getPos(x + 1, y, z + 1);
        const p3 = getPos(x, y, z + 1);
        const p4 = getPos(x, y + 1, z);
        const p5 = getPos(x + 1, y + 1, z);
        const p6 = getPos(x + 1, y + 1, z + 1);
        const p7 = getPos(x, y + 1, z + 1);

        // Interpolate along edges
        const interp = (pA: [number, number, number], pB: [number, number, number], valA: number, valB: number, edgeIdx: number) => {
          const mu = (isolevel - valA) / (valB - valA + 1e-9);
          edgeVertices[edgeIdx * 3 + 0] = pA[0] + mu * (pB[0] - pA[0]);
          edgeVertices[edgeIdx * 3 + 1] = pA[1] + mu * (pB[1] - pA[1]);
          edgeVertices[edgeIdx * 3 + 2] = pA[2] + mu * (pB[2] - pA[2]);
        };

        if (EDGE_TABLE[cubeindex] & 1) interp(p0, p1, v0, v1, 0);
        if (EDGE_TABLE[cubeindex] & 2) interp(p1, p2, v1, v2, 1);
        if (EDGE_TABLE[cubeindex] & 4) interp(p2, p3, v2, v3, 2);
        if (EDGE_TABLE[cubeindex] & 8) interp(p3, p0, v3, v0, 3);
        if (EDGE_TABLE[cubeindex] & 16) interp(p4, p5, v4, v5, 4);
        if (EDGE_TABLE[cubeindex] & 32) interp(p5, p6, v5, v6, 5);
        if (EDGE_TABLE[cubeindex] & 64) interp(p6, p7, v6, v7, 6);
        if (EDGE_TABLE[cubeindex] & 128) interp(p7, p4, v7, v4, 7);
        if (EDGE_TABLE[cubeindex] & 256) interp(p0, p4, v0, v4, 8);
        if (EDGE_TABLE[cubeindex] & 512) interp(p1, p5, v1, v5, 9);
        if (EDGE_TABLE[cubeindex] & 1024) interp(p2, p6, v2, v6, 10);
        if (EDGE_TABLE[cubeindex] & 2048) interp(p3, p7, v3, v7, 11);

        // Form triangles
        for (let i = 0; TRI_TABLE[cubeindex * 16 + i] !== -1; i += 3) {
          const e0 = TRI_TABLE[cubeindex * 16 + i];
          const e1 = TRI_TABLE[cubeindex * 16 + i + 1];
          const e2 = TRI_TABLE[cubeindex * 16 + i + 2];

          vertices.push(
            edgeVertices[e0 * 3], edgeVertices[e0 * 3 + 1], edgeVertices[e0 * 3 + 2],
            edgeVertices[e1 * 3], edgeVertices[e1 * 3 + 1], edgeVertices[e1 * 3 + 2],
            edgeVertices[e2 * 3], edgeVertices[e2 * 3 + 1], edgeVertices[e2 * 3 + 2]
          );
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  if (vertices.length > 0) {
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
  }

  return geometry;
}
