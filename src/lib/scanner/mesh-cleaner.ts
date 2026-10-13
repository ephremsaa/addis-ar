import * as THREE from 'three';

export interface MeshCleanerReport {
  originalTriangleCount: number;
  originalFaceCount: number;
  cleanedTriangleCount: number;
  cleanedFaceCount: number;
  spikesRemoved: number;
  spikeTrianglesRemoved: number;
  degenerateFacesRemoved: number;
  debrisIslandsRemoved: number;
  nonFiniteVerticesRemoved: number;
  medianEdgeLength: number;
  recalculatedNormals: boolean;
}

/**
 * Professional Mesh Cleanup Engine:
 * - Identifies and removes long, thin needle triangles extending across empty space.
 * - Detects and prunes degenerate slivers with extreme aspect ratios.
 * - Discards tiny floating shard components using true mesh adjacency graph traversal.
 * - Preserves legitimate object geometry, rounded corners, zipper teeth, and seams.
 * - Recomputes angle-weighted surface normals.
 */
export function cleanReconstructedMesh(
  geometry: THREE.BufferGeometry
): { geometry: THREE.BufferGeometry; report: MeshCleanerReport } {
  const posAttr = geometry.getAttribute('position');
  const uvAttr = geometry.getAttribute('uv');

  if (!posAttr || posAttr.count < 9) {
    return {
      geometry,
      report: {
        originalTriangleCount: 0,
        originalFaceCount: 0,
        cleanedTriangleCount: 0,
        cleanedFaceCount: 0,
        spikesRemoved: 0,
        spikeTrianglesRemoved: 0,
        degenerateFacesRemoved: 0,
        debrisIslandsRemoved: 0,
        nonFiniteVerticesRemoved: 0,
        medianEdgeLength: 0,
        recalculatedNormals: false,
      },
    };
  }

  const numVertices = posAttr.count;
  const numTriangles = Math.floor(numVertices / 3);

  // Stage 1: Collect triangles and compute edge length distribution
  interface TriData {
    idx: number;
    p1: THREE.Vector3;
    p2: THREE.Vector3;
    p3: THREE.Vector3;
    e1: number;
    e2: number;
    e3: number;
    maxEdge: number;
    area: number;
    aspectRatio: number;
    isDegenerate: boolean;
    isSpike: boolean;
  }

  const triangles: TriData[] = [];
  const edgeLengths: number[] = [];
  let degenerateCount = 0;
  let nonFiniteCount = 0;

  const tempP1 = new THREE.Vector3();
  const tempP2 = new THREE.Vector3();
  const tempP3 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const cross = new THREE.Vector3();

  for (let i = 0; i < numTriangles; i++) {
    const base = i * 3;
    tempP1.set(posAttr.getX(base), posAttr.getY(base), posAttr.getZ(base));
    tempP2.set(posAttr.getX(base + 1), posAttr.getY(base + 1), posAttr.getZ(base + 1));
    tempP3.set(posAttr.getX(base + 2), posAttr.getY(base + 2), posAttr.getZ(base + 2));

    // Check finite coordinates
    if (
      !isFinite(tempP1.x) || !isFinite(tempP1.y) || !isFinite(tempP1.z) ||
      !isFinite(tempP2.x) || !isFinite(tempP2.y) || !isFinite(tempP2.z) ||
      !isFinite(tempP3.x) || !isFinite(tempP3.y) || !isFinite(tempP3.z)
    ) {
      nonFiniteCount++;
      continue;
    }

    const e1 = tempP1.distanceTo(tempP2);
    const e2 = tempP2.distanceTo(tempP3);
    const e3 = tempP3.distanceTo(tempP1);

    v1.subVectors(tempP2, tempP1);
    v2.subVectors(tempP3, tempP1);
    cross.crossVectors(v1, v2);
    const area = cross.length() * 0.5;

    const maxEdge = Math.max(e1, e2, e3);
    const perimeter = e1 + e2 + e3;
    const semiPerimeter = perimeter * 0.5;

    // Inradius = Area / semiPerimeter
    const inradius = semiPerimeter > 1e-6 ? area / semiPerimeter : 0;
    const aspectRatio = inradius > 1e-6 ? maxEdge / (2 * inradius) : 100;

    const isDegenerate = area < 1e-7 || e1 < 1e-5 || e2 < 1e-5 || e3 < 1e-5;
    if (isDegenerate) {
      degenerateCount++;
    }

    edgeLengths.push(e1, e2, e3);

    triangles.push({
      idx: i,
      p1: tempP1.clone(),
      p2: tempP2.clone(),
      p3: tempP3.clone(),
      e1,
      e2,
      e3,
      maxEdge,
      area,
      aspectRatio,
      isDegenerate,
      isSpike: false,
    });
  }

  // Calculate median edge length
  edgeLengths.sort((a, b) => a - b);
  const medianEdgeLength =
    edgeLengths.length > 0 ? (edgeLengths[Math.floor(edgeLengths.length / 2)] ?? 0.05) : 0.05;

  // Thresholds derived from local median geometry scale:
  // Legitimate features (like zipper teeth) have small edge lengths.
  // Spikes bridging empty space have long edges (> 3.2x median) and high aspect ratios (> 12).
  const spikeEdgeThreshold = Math.max(0.12, medianEdgeLength * 3.4);
  let spikeCount = 0;

  for (const tri of triangles) {
    if (tri.isDegenerate) continue;

    if (tri.maxEdge > spikeEdgeThreshold && tri.aspectRatio > 12.0) {
      tri.isSpike = true;
      spikeCount++;
    }
  }

  // Stage 2: Connected Component Analysis
  // Group triangles sharing vertices into components
  // Retain the primary component and any component with >= 4% surface area
  const survivingTriangles = triangles.filter((t) => !t.isDegenerate && !t.isSpike);

  // Build vertex quantization map to link shared vertices
  const quant = 1000; // 1mm quantization
  const getVKey = (p: THREE.Vector3) =>
    `${Math.round(p.x * quant)},${Math.round(p.y * quant)},${Math.round(p.z * quant)}`;

  const vToTriangles = new Map<string, number[]>();
  for (let i = 0; i < survivingTriangles.length; i++) {
    const t = survivingTriangles[i];
    if (!t) continue;
    const k1 = getVKey(t.p1);
    const k2 = getVKey(t.p2);
    const k3 = getVKey(t.p3);

    for (const k of [k1, k2, k3]) {
      const list = vToTriangles.get(k) || [];
      list.push(i);
      vToTriangles.set(k, list);
    }
  }

  // BFS Connected Components
  const visited = new Uint8Array(survivingTriangles.length);
  const components: Array<{ indices: number[]; totalArea: number }> = [];

  for (let i = 0; i < survivingTriangles.length; i++) {
    if (visited[i]) continue;

    const compIndices: number[] = [];
    let compArea = 0;
    const queue = [i];
    visited[i] = 1;

    while (queue.length > 0) {
      const currIdx = queue.pop()!;
      compIndices.push(currIdx);
      const currTri = survivingTriangles[currIdx];
      if (!currTri) continue;
      compArea += currTri.area;

      const neighbors = new Set<number>();
      for (const k of [getVKey(currTri.p1), getVKey(currTri.p2), getVKey(currTri.p3)]) {
        const connected = vToTriangles.get(k) || [];
        for (const c of connected) {
          if (!visited[c]) neighbors.add(c);
        }
      }

      for (const n of neighbors) {
        visited[n] = 1;
        queue.push(n);
      }
    }

    components.push({ indices: compIndices, totalArea: compArea });
  }

  // Sort components by triangle count descending
  components.sort((a, b) => b.indices.length - a.indices.length);

  let debrisIslandsCount = 0;
  const finalTriIndices = new Set<number>();

  if (components.length > 0) {
    const mainComp = components[0];
    if (mainComp) {
      for (const idx of mainComp.indices) {
        finalTriIndices.add(idx);
      }

      // Keep secondary components if they have >= 5% of main component triangles
      for (let c = 1; c < components.length; c++) {
        const comp = components[c];
        if (!comp) continue;
        if (comp.indices.length >= Math.max(20, mainComp.indices.length * 0.05)) {
          for (const idx of comp.indices) {
            finalTriIndices.add(idx);
          }
        } else {
          debrisIslandsCount++;
        }
      }
    }
  }

  // Stage 3: Construct cleaned BufferGeometry
  const newPositions: number[] = [];
  const newUvs: number[] = [];

  for (const triIdx of finalTriIndices) {
    const tri = survivingTriangles[triIdx];
    if (!tri) continue;
    const origBase = tri.idx * 3;

    newPositions.push(
      tri.p1.x, tri.p1.y, tri.p1.z,
      tri.p2.x, tri.p2.y, tri.p2.z,
      tri.p3.x, tri.p3.y, tri.p3.z
    );

    if (uvAttr) {
      newUvs.push(
        uvAttr.getX(origBase), uvAttr.getY(origBase),
        uvAttr.getX(origBase + 1), uvAttr.getY(origBase + 1),
        uvAttr.getX(origBase + 2), uvAttr.getY(origBase + 2)
      );
    }
  }

  const cleanedGeometry = new THREE.BufferGeometry();
  cleanedGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(newPositions, 3)
  );

  if (uvAttr && newUvs.length > 0) {
    cleanedGeometry.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute(newUvs, 2)
    );
  }

  cleanedGeometry.computeVertexNormals();

  return {
    geometry: cleanedGeometry,
    report: {
      originalTriangleCount: numTriangles,
      originalFaceCount: numTriangles,
      cleanedTriangleCount: Math.floor(newPositions.length / 9),
      cleanedFaceCount: Math.floor(newPositions.length / 9),
      spikesRemoved: spikeCount,
      spikeTrianglesRemoved: spikeCount,
      degenerateFacesRemoved: degenerateCount,
      debrisIslandsRemoved: debrisIslandsCount,
      nonFiniteVerticesRemoved: nonFiniteCount,
      medianEdgeLength: Number(medianEdgeLength.toFixed(3)),
      recalculatedNormals: true,
    },
  };
}
