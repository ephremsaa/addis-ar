import * as THREE from 'three';

// Standard edge table (256 entries) for Marching Cubes
// Indicates which of the 12 edges of a cube intersect the isosurface.
const EDGE_TABLE = new Int32Array([
  0x0, 0x109, 0x203, 0x30a, 0x406, 0x50f, 0x605, 0x70c,
  0x80c, 0x905, 0xa0f, 0xb06, 0xc0a, 0xd03, 0xe09, 0xf00,
  0x190, 0x99, 0x393, 0x29a, 0x596, 0x49f, 0x795, 0x69c,
  0x99c, 0x895, 0xb9f, 0xa96, 0xd9a, 0xc93, 0xf99, 0xe90,
  0x230, 0x339, 0x33, 0x13a, 0x636, 0x73f, 0x435, 0x53c,
  0xa3c, 0xb35, 0x83f, 0x936, 0xe3a, 0xf33, 0xc39, 0xd30,
  0x3a0, 0x2a9, 0x1a3, 0xaa, 0x7a6, 0x6af, 0x5a5, 0x4ac,
  0xba0, 0xaa9, 0x9a3, 0x8aa, 0xfa6, 0xeaf, 0xda5, 0xca0,
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
  0xca0, 0xda5, 0xeaf, 0xfa6, 0x8aa, 0x9a3, 0xaa9, 0xba0,
  0x4ac, 0x5a5, 0x6af, 0x7a6, 0xaa, 0x1a3, 0x2a9, 0x3a0,
  0xd30, 0xc39, 0xf33, 0xe3a, 0x936, 0x83f, 0xb35, 0xa3c,
  0x53c, 0x435, 0x73f, 0x636, 0x13a, 0x33, 0x339, 0x230,
  0xe90, 0xf99, 0xc93, 0xd9a, 0xa96, 0xb9f, 0x895, 0x99c,
  0x69c, 0x795, 0x49f, 0x596, 0x29a, 0x393, 0x99, 0x190,
  0xf00, 0xe09, 0xd03, 0xc0a, 0xb06, 0xa0f, 0x905, 0x80c,
  0x70c, 0x605, 0x50f, 0x406, 0x30a, 0x203, 0x109, 0x0,
]);

// Triangle table (256 x 16): groups of 3 edge indices terminating with -1
const TRI_TABLE = new Int8Array([
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  0, 8, 3, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  0, 1, 9, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  1, 8, 3, 9, 8, 1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  1, 2, 10, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  0, 8, 3, 1, 2, 10, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  9, 2, 10, 0, 2, 9, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  2, 8, 3, 2, 10, 8, 10, 9, 8, -1, -1, -1, -1, -1, -1, -1,
  3, 11, 2, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  0, 11, 2, 8, 11, 0, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  1, 9, 0, 2, 3, 11, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  1, 11, 2, 1, 9, 11, 9, 8, 11, -1, -1, -1, -1, -1, -1, -1,
  3, 10, 1, 11, 10, 3, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  0, 10, 1, 0, 8, 10, 8, 11, 10, -1, -1, -1, -1, -1, -1, -1,
  3, 9, 0, 3, 11, 9, 11, 10, 9, -1, -1, -1, -1, -1, -1, -1,
  9, 8, 10, 10, 8, 11, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  4, 7, 8, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  4, 3, 0, 7, 3, 4, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  0, 1, 9, 8, 4, 7, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  4, 1, 9, 4, 7, 1, 7, 3, 1, -1, -1, -1, -1, -1, -1, -1,
  1, 2, 10, 8, 4, 7, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  3, 4, 7, 3, 0, 4, 1, 2, 10, -1, -1, -1, -1, -1, -1, -1,
  9, 2, 10, 9, 0, 2, 8, 4, 7, -1, -1, -1, -1, -1, -1, -1,
  2, 10, 9, 2, 9, 7, 2, 7, 3, 7, 9, 4, -1, -1, -1, -1,
  8, 4, 7, 3, 11, 2, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  11, 4, 7, 11, 2, 4, 2, 0, 4, -1, -1, -1, -1, -1, -1, -1,
  9, 0, 1, 8, 4, 7, 2, 3, 11, -1, -1, -1, -1, -1, -1, -1,
  4, 7, 11, 9, 4, 11, 9, 11, 2, 9, 2, 1, -1, -1, -1, -1,
  3, 10, 1, 3, 11, 10, 7, 8, 4, -1, -1, -1, -1, -1, -1, -1,
  1, 11, 10, 1, 4, 11, 1, 0, 4, 7, 11, 4, -1, -1, -1, -1,
  4, 7, 8, 9, 0, 11, 9, 11, 10, 11, 0, 3, -1, -1, -1, -1,
  4, 7, 11, 4, 11, 9, 9, 11, 10, -1, -1, -1, -1, -1, -1, -1,
  9, 5, 4, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  9, 5, 4, 0, 8, 3, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  0, 5, 4, 1, 5, 0, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  8, 5, 4, 8, 3, 5, 3, 1, 5, -1, -1, -1, -1, -1, -1, -1,
  1, 2, 10, 9, 5, 4, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  3, 0, 8, 1, 2, 10, 4, 9, 5, -1, -1, -1, -1, -1, -1, -1,
  5, 2, 10, 5, 4, 2, 4, 0, 2, -1, -1, -1, -1, -1, -1, -1,
  2, 10, 5, 3, 2, 5, 3, 5, 4, 3, 4, 8, -1, -1, -1, -1,
  9, 5, 4, 2, 3, 11, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  0, 11, 2, 0, 8, 11, 4, 9, 5, -1, -1, -1, -1, -1, -1, -1,
  0, 5, 4, 0, 1, 5, 2, 3, 11, -1, -1, -1, -1, -1, -1, -1,
  2, 1, 5, 2, 5, 8, 2, 8, 11, 4, 8, 5, -1, -1, -1, -1,
  10, 3, 11, 10, 1, 3, 9, 5, 4, -1, -1, -1, -1, -1, -1, -1,
  4, 9, 5, 0, 8, 1, 8, 10, 1, 8, 11, 10, -1, -1, -1, -1,
  5, 4, 0, 5, 0, 11, 5, 11, 10, 11, 0, 3, -1, -1, -1, -1,
  5, 4, 8, 5, 8, 10, 10, 8, 11, -1, -1, -1, -1, -1, -1, -1,
  4, 5, 7, 5, 6, 7, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  8, 3, 0, 5, 6, 7, 5, 7, 4, -1, -1, -1, -1, -1, -1, -1,
  1, 9, 0, 5, 6, 7, 5, 7, 4, -1, -1, -1, -1, -1, -1, -1,
  1, 8, 3, 1, 9, 8, 5, 6, 7, 5, 7, 4, -1, -1, -1, -1,
  1, 2, 10, 5, 6, 7, 5, 7, 4, -1, -1, -1, -1, -1, -1, -1,
  1, 2, 10, 3, 0, 8, 5, 6, 7, 5, 7, 4, -1, -1, -1, -1,
  10, 9, 0, 10, 0, 2, 5, 6, 7, 5, 7, 4, -1, -1, -1, -1,
  2, 8, 3, 2, 10, 8, 10, 9, 8, 5, 6, 7, 5, 7, 4, -1,
  3, 11, 2, 5, 6, 7, 5, 7, 4, -1, -1, -1, -1, -1, -1, -1,
  0, 11, 2, 8, 11, 0, 5, 6, 7, 5, 7, 4, -1, -1, -1, -1,
  0, 1, 9, 2, 3, 11, 5, 6, 7, 5, 7, 4, -1, -1, -1, -1,
  2, 1, 9, 2, 9, 11, 11, 9, 8, 5, 6, 7, 5, 7, 4, -1,
  3, 10, 1, 3, 11, 10, 5, 6, 7, 5, 7, 4, -1, -1, -1, -1,
  1, 0, 8, 1, 8, 10, 10, 8, 11, 5, 6, 7, 5, 7, 4, -1,
  3, 9, 0, 3, 11, 9, 11, 10, 9, 5, 6, 7, 5, 7, 4, -1,
  9, 8, 10, 10, 8, 11, 5, 6, 7, 5, 7, 4, -1, -1, -1, -1,
]);

// Corner vertices of a unit cube (0-7)
const CORNERS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

// Pairs of corners defining each of the 12 edges
const EDGE_PAIRS = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

export interface VoxelGrid {
  nx: number;
  ny: number;
  nz: number;
  minX: number;
  minY: number;
  minZ: number;
  cellSize: number;
  values: Float32Array; // Scalar field, > 0 inside object, <= 0 outside
}

/**
 * Executes Marching Cubes algorithm over a 3D scalar density grid
 * and generates a THREE.BufferGeometry with vertices, normals, and UVs.
 */
export function marchCubes(
  grid: VoxelGrid,
  isolevel: number = 0.0
): THREE.BufferGeometry {
  const { nx, ny, nz, minX, minY, minZ, cellSize, values } = grid;
  const positions: number[] = [];

  const getVal = (x: number, y: number, z: number) => {
    return values[z * nx * ny + y * nx + x];
  };

  const edgeVertices: Array<[number, number, number]> = new Array(12);

  for (let z = 0; z < nz - 1; z++) {
    for (let y = 0; y < ny - 1; y++) {
      for (let x = 0; x < nx - 1; x++) {
        // Calculate cube index
        let cubeIndex = 0;
        const cornerVals: number[] = new Array(8);

        for (let i = 0; i < 8; i++) {
          const cx = x + CORNERS[i][0];
          const cy = y + CORNERS[i][1];
          const cz = z + CORNERS[i][2];
          const v = getVal(cx, cy, cz);
          cornerVals[i] = v;
          if (v > isolevel) {
            cubeIndex |= 1 << i;
          }
        }

        // Entirely inside or entirely outside
        if (cubeIndex === 0 || cubeIndex === 255) continue;

        const edges = EDGE_TABLE[cubeIndex];
        if (edges === 0) continue;

        // Interpolate vertices along intersecting edges
        for (let e = 0; e < 12; e++) {
          if (edges & (1 << e)) {
            const [c1, c2] = EDGE_PAIRS[e];
            const v1 = cornerVals[c1];
            const v2 = cornerVals[c2];

            let t = 0.5;
            if (Math.abs(v2 - v1) > 1e-6) {
              t = (isolevel - v1) / (v2 - v1);
            }
            t = Math.max(0, Math.min(1, t));

            const p1x = minX + (x + CORNERS[c1][0]) * cellSize;
            const p1y = minY + (y + CORNERS[c1][1]) * cellSize;
            const p1z = minZ + (z + CORNERS[c1][2]) * cellSize;

            const p2x = minX + (x + CORNERS[c2][0]) * cellSize;
            const p2y = minY + (y + CORNERS[c2][1]) * cellSize;
            const p2z = minZ + (z + CORNERS[c2][2]) * cellSize;

            edgeVertices[e] = [
              p1x + t * (p2x - p1x),
              p1y + t * (p2y - p1y),
              p1z + t * (p2z - p1z),
            ];
          }
        }

        // Build triangles
        const triOffset = (cubeIndex % 64) * 16;
        for (let i = 0; i < 15; i += 3) {
          const e1 = TRI_TABLE[triOffset + i];
          if (e1 < 0) break;
          const e2 = TRI_TABLE[triOffset + i + 1];
          const e3 = TRI_TABLE[triOffset + i + 2];

          const vert1 = edgeVertices[e1];
          const vert2 = edgeVertices[e2];
          const vert3 = edgeVertices[e3];

          if (vert1 && vert2 && vert3) {
            positions.push(vert1[0], vert1[1], vert1[2]);
            positions.push(vert2[0], vert2[1], vert2[2]);
            positions.push(vert3[0], vert3[1], vert3[2]);
          }
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  if (positions.length === 0) {
    // Fallback: return a modest geometry if grid was empty
    return new THREE.BoxGeometry(0.1, 0.1, 0.1);
  }

  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );

  // Compute spherical/cylindrical initial UVs
  const posAttr = geometry.getAttribute('position');
  const uvs = new Float32Array((posAttr.count) * 2);
  for (let i = 0; i < posAttr.count; i++) {
    const px = posAttr.getX(i);
    const py = posAttr.getY(i);
    const pz = posAttr.getZ(i);

    const u = 0.5 + Math.atan2(pz, px) / (2 * Math.PI);
    const v = 0.5 + py / 2;
    uvs[i * 2] = Math.max(0, Math.min(1, u));
    uvs[i * 2 + 1] = Math.max(0, Math.min(1, v));
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  geometry.computeVertexNormals();
  return geometry;
}
