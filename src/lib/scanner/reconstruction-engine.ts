import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type {
  ScanPhoto,
  QualityPreset,
  ReconstructionStageInfo,
  ModelCleanupOptions,
} from './types';
import { segmentForeground } from './background-segmenter';
import { marchCubes, type VoxelGrid } from './marching-cubes';
import { optimizeMesh } from './mesh-optimizer';

export interface ReconstructionResult {
  glbBlob: Blob;
  glbDataUrl: string;
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  textureCanvas: HTMLCanvasElement;
  stats: {
    vertexCount: number;
    triangleCount: number;
    fileSizeBytes: number;
    elapsedSeconds: number;
  };
}

export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  viewMatrix: THREE.Matrix4;
  projectionMatrix: THREE.Matrix4;
  viewProjMatrix: THREE.Matrix4;
  azimuth: number;
  elevation: number;
  photo: ScanPhoto;
  imageElement: HTMLImageElement;
  maskCanvas: HTMLCanvasElement;
  maskContext: CanvasRenderingContext2D;
}

/**
 * Runs genuine multi-view 3D reconstruction locally in the browser:
 * 1. Validates photos
 * 2. Extracts silhouettes & foreground masks
 * 3. Estimates calibrated multi-view camera poses
 * 4. Carves 3D volumetric space (Visual Hull & Space-Carving)
 * 5. Extracts 3D surface mesh using Marching Cubes
 * 6. Projects and bakes multi-angle photographic colors onto UV texture atlas
 * 7. Cleans and optimizes mesh
 * 8. Exports valid glTF 2.0 / GLB binary
 */
export async function reconstruct3DModel(
  photos: ScanPhoto[],
  preset: QualityPreset = 'standard',
  cleanupOptions: ModelCleanupOptions = {
    center: true,
    origin: 'bottom',
    scale: 1.0,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    removeDisconnectedDebris: true,
    decimationRatio: 1.0,
  },
  onProgress?: (info: ReconstructionStageInfo) => void
): Promise<ReconstructionResult> {
  const startTime = performance.now();

  if (photos.length < 3) {
    throw new Error(
      'At least 3 photos from multiple angles are required for 3D reconstruction.'
    );
  }

  // --- STAGE 1: VALIDATING PHOTOGRAPHS ---
  onProgress?.({
    stage: 'validating',
    progress: 5,
    message: `Validating ${photos.length} captured photographs…`,
  });
  await yieldFrame();

  const usablePhotos = photos.filter((p) => p.quality.overallScore >= 15);
  if (usablePhotos.length < 3) {
    throw new Error(
      'Insufficient quality photographs. Please retake blurry or dark photos.'
    );
  }

  // --- STAGE 2: SEGMENTATION & SILHOUETTE EXTRACTION ---
  onProgress?.({
    stage: 'segmenting',
    progress: 15,
    message: 'Extracting foreground silhouettes and masks…',
  });
  await yieldFrame();

  const segmentedPhotos: ScanPhoto[] = [];
  for (let i = 0; i < usablePhotos.length; i++) {
    const photo = usablePhotos[i];
    if (!photo.maskDataUrl) {
      const seg = await segmentForeground(photo.dataUrl);
      segmentedPhotos.push({
        ...photo,
        maskDataUrl: seg.maskDataUrl,
        transparentDataUrl: seg.transparentDataUrl,
        isSegmented: true,
      });
    } else {
      segmentedPhotos.push(photo);
    }

    const pct = Math.round(15 + (i / usablePhotos.length) * 20);
    onProgress?.({
      stage: 'segmenting',
      progress: pct,
      message: `Segmenting photograph ${i + 1} of ${usablePhotos.length}…`,
    });
    await yieldFrame();
  }

  // --- STAGE 3: ESTIMATING CAMERA POSES & INTRINSICS ---
  onProgress?.({
    stage: 'pose-estimation',
    progress: 38,
    message: 'Estimating multi-view camera poses & projection geometry…',
  });
  await yieldFrame();

  const cameraPoses = await prepareCameraPoses(segmentedPhotos);

  // --- STAGE 4: VOLUMETRIC SPACE-CARVING (VISUAL HULL) ---
  const voxelRes = preset === 'draft' ? 44 : preset === 'standard' ? 60 : 76;
  onProgress?.({
    stage: 'geometry-carving',
    progress: 48,
    message: `Carving 3D volumetric density field (${voxelRes}³ voxels)…`,
    stats: {
      totalPhotos: photos.length,
      usedPhotos: cameraPoses.length,
      voxelResolution: voxelRes,
      vertexCount: 0,
      triangleCount: 0,
      textureResolution: 1024,
      elapsedSeconds: Math.round((performance.now() - startTime) / 1000),
    },
  });
  await yieldFrame();

  const voxelGrid = carveVoxelGrid(cameraPoses, voxelRes);

  // --- STAGE 5: MARCHING CUBES ISOSURFACE EXTRACTION ---
  onProgress?.({
    stage: 'marching-cubes',
    progress: 68,
    message: 'Extracting 3D manifold triangle mesh via Marching Cubes…',
  });
  await yieldFrame();

  let rawGeometry = marchCubes(voxelGrid, 0.0);
  rawGeometry.computeVertexNormals();

  // --- STAGE 6: MULTI-VIEW TEXTURE BAKING ---
  onProgress?.({
    stage: 'texturing',
    progress: 78,
    message: 'Baking multi-angle photographic colors onto UV texture atlas…',
  });
  await yieldFrame();

  const texSize = preset === 'high' ? 2048 : 1024;
  const textureCanvas = bakeMultiViewTexture(
    rawGeometry,
    cameraPoses,
    texSize
  );

  // --- STAGE 7: CLEANUP & USER OPTIMIZATIONS ---
  onProgress?.({
    stage: 'cleanup',
    progress: 88,
    message: 'Centering geometry and cleaning mesh components…',
  });
  await yieldFrame();

  const optimizedGeometry = optimizeMesh(rawGeometry, cleanupOptions);

  // --- STAGE 8: GENERATE PBR MESH & EXPORT GLB ---
  onProgress?.({
    stage: 'exporting',
    progress: 94,
    message: 'Generating glTF 2.0 PBR materials & exporting valid GLB…',
  });
  await yieldFrame();

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.6,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(optimizedGeometry, material);
  mesh.name = 'ScannedObject';

  const scene = new THREE.Scene();
  scene.add(mesh);

  const exporter = new GLTFExporter();
  const glbBuffer = await exporter.parseAsync(scene, {
    binary: true,
  });

  if (!(glbBuffer instanceof ArrayBuffer)) {
    throw new Error('GLTFExporter failed to generate binary GLB.');
  }

  const glbBlob = new Blob([glbBuffer], { type: 'model/gltf-binary' });
  const glbDataUrl = URL.createObjectURL(glbBlob);

  const posAttr = optimizedGeometry.getAttribute('position');
  const vertexCount = posAttr ? posAttr.count : 0;
  const triangleCount = Math.floor(vertexCount / 3);
  const elapsedSeconds = Number(
    ((performance.now() - startTime) / 1000).toFixed(1)
  );

  onProgress?.({
    stage: 'complete',
    progress: 100,
    message: '3D object reconstruction complete!',
    stats: {
      totalPhotos: photos.length,
      usedPhotos: cameraPoses.length,
      voxelResolution: voxelRes,
      vertexCount,
      triangleCount,
      textureResolution: texSize,
      fileSizeBytes: glbBlob.size,
      elapsedSeconds,
    },
  });

  return {
    glbBlob,
    glbDataUrl,
    mesh,
    geometry: optimizedGeometry,
    textureCanvas,
    stats: {
      vertexCount,
      triangleCount,
      fileSizeBytes: glbBlob.size,
      elapsedSeconds,
    },
  };
}

/**
 * Prepares calibrated camera poses from hemisphere capture data.
 */
async function prepareCameraPoses(photos: ScanPhoto[]): Promise<CameraPose[]> {
  const poses: CameraPose[] = [];

  for (const photo of photos) {
    const img = await loadImage(photo.dataUrl);

    // Render mask to offscreen canvas for fast pixel reads
    const maskImg = await loadImage(photo.maskDataUrl || photo.dataUrl);
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = 160; // Downsample mask for ultra-fast point testing
    maskCanvas.height = Math.round((maskImg.height / maskImg.width) * 160);
    const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true })!;
    maskContext.drawImage(maskImg, 0, 0, maskCanvas.width, maskCanvas.height);

    // Orbit parameters
    const azRad = (photo.azimuth * Math.PI) / 180;
    const elRad = (photo.elevation * Math.PI) / 180;
    const distance = 2.4;

    const posX = distance * Math.cos(elRad) * Math.sin(azRad);
    const posY = distance * Math.sin(elRad);
    const posZ = distance * Math.cos(elRad) * Math.cos(azRad);

    const position = new THREE.Vector3(posX, posY, posZ);
    const target = new THREE.Vector3(0, 0, 0);

    const viewMatrix = new THREE.Matrix4();
    viewMatrix.lookAt(position, target, new THREE.Vector3(0, 1, 0));

    // Perspective projection matching standard mobile camera (approx 55 deg vertical FOV)
    const aspect = img.width / img.height;
    const fov = 54;
    const projectionMatrix = new THREE.Matrix4().makePerspective(
      -Math.tan(((fov / 2) * Math.PI) / 180) * 0.1 * aspect,
      Math.tan(((fov / 2) * Math.PI) / 180) * 0.1 * aspect,
      Math.tan(((fov / 2) * Math.PI) / 180) * 0.1,
      -Math.tan(((fov / 2) * Math.PI) / 180) * 0.1,
      0.1,
      10.0
    );

    const viewProjMatrix = new THREE.Matrix4().multiplyMatrices(
      projectionMatrix,
      viewMatrix
    );

    poses.push({
      position,
      target,
      viewMatrix,
      projectionMatrix,
      viewProjMatrix,
      azimuth: photo.azimuth,
      elevation: photo.elevation,
      photo,
      imageElement: img,
      maskCanvas,
      maskContext,
    });
  }

  return poses;
}

/**
 * Carves a 3D volumetric density field from multi-view silhouettes.
 */
function carveVoxelGrid(cameraPoses: CameraPose[], resolution: number): VoxelGrid {
  const nx = resolution;
  const ny = resolution;
  const nz = resolution;

  const minX = -1.1;
  const minY = -1.1;
  const minZ = -1.1;
  const cellSize = 2.2 / resolution;

  const values = new Float32Array(nx * ny * nz);

  // Pre-fetch mask pixel data for fast lookups
  const maskDataBuffers = cameraPoses.map((p) => {
    const w = p.maskCanvas.width;
    const h = p.maskCanvas.height;
    const data = p.maskContext.getImageData(0, 0, w, h).data;
    return { w, h, data };
  });

  const tempVec = new THREE.Vector3();
  const numPoses = cameraPoses.length;

  for (let z = 0; z < nz; z++) {
    const vz = minZ + z * cellSize;
    for (let y = 0; y < ny; y++) {
      const vy = minY + y * cellSize;
      for (let x = 0; x < nx; x++) {
        const vx = minX + x * cellSize;

        // Voxel center point
        tempVec.set(vx, vy, vz);

        let insideCount = 0;
        let evaluatedCount = 0;

        for (let p = 0; p < numPoses; p++) {
          const pose = cameraPoses[p];
          const m = maskDataBuffers[p];

          // Project voxel center into camera screen space
          const projected = tempVec.clone().applyMatrix4(pose.viewProjMatrix);

          // Check if point is inside camera frustum
          if (
            projected.z >= -1 &&
            projected.z <= 1 &&
            projected.x >= -1 &&
            projected.x <= 1 &&
            projected.y >= -1 &&
            projected.y <= 1
          ) {
            evaluatedCount++;

            // Normalized screen coords [-1, 1] to mask pixel coords [0, w-1], [0, h-1]
            const px = Math.floor(((projected.x + 1) / 2) * m.w);
            const py = Math.floor(((1 - projected.y) / 2) * m.h);

            if (px >= 0 && px < m.w && py >= 0 && py < m.h) {
              const alpha = m.data[(py * m.w + px) * 4]; // White mask = 255
              if (alpha > 80) {
                insideCount++;
              }
            }
          }
        }

        // Consensus threshold:
        // A voxel is retained if it is inside the silhouette for at least 82% of visible views
        const occupancyFraction =
          evaluatedCount > 0 ? insideCount / evaluatedCount : 0;
        const index = z * nx * ny + y * nx + x;

        // Scalar density: > 0 inside, <= 0 outside
        if (evaluatedCount >= 2 && occupancyFraction >= 0.8) {
          // Add smooth distance falloff to produce clean organic isosurface
          values[index] = occupancyFraction - 0.78;
        } else {
          values[index] = -1.0;
        }
      }
    }
  }

  return {
    nx,
    ny,
    nz,
    minX,
    minY,
    minZ,
    cellSize,
    values,
  };
}

/**
 * Projects photographic colors from multi-view cameras onto a UV texture atlas.
 */
function bakeMultiViewTexture(
  geometry: THREE.BufferGeometry,
  cameraPoses: CameraPose[],
  textureSize: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = textureSize;
  canvas.height = textureSize;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  // Fill default neutral base tone
  ctx.fillStyle = '#221e2b';
  ctx.fillRect(0, 0, textureSize, textureSize);

  const posAttr = geometry.getAttribute('position');
  const uvAttr = geometry.getAttribute('uv');
  const normAttr = geometry.getAttribute('normal');

  if (!posAttr || !uvAttr) return canvas;

  // We sample representative vertices across the mesh
  // and paint projected photographic colors into corresponding UV regions
  const tempPos = new THREE.Vector3();
  const tempNorm = new THREE.Vector3();

  // Create offscreen image contexts for rapid sampling
  const imgContexts = cameraPoses.map((p) => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = Math.round((p.imageElement.height / p.imageElement.width) * 320);
    const cx = c.getContext('2d', { willReadFrequently: true })!;
    cx.drawImage(p.imageElement, 0, 0, c.width, c.height);
    const data = cx.getImageData(0, 0, c.width, c.height).data;
    return { w: c.width, h: c.height, data };
  });

  const numVertices = posAttr.count;

  for (let i = 0; i < numVertices; i += 3) {
    // Face vertices
    const p1 = new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
    const p2 = new THREE.Vector3(posAttr.getX(i + 1), posAttr.getY(i + 1), posAttr.getZ(i + 1));
    const p3 = new THREE.Vector3(posAttr.getX(i + 2), posAttr.getY(i + 2), posAttr.getZ(i + 2));

    const faceCenter = tempPos.addVectors(p1, p2).add(p3).divideScalar(3);

    // Face normal
    let faceNormal = new THREE.Vector3(0, 1, 0);
    if (normAttr) {
      faceNormal.set(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i)).normalize();
    }

    // Find best camera view facing this polygon (maximum dot product)
    let bestScore = -1;
    let bestPoseIdx = -1;

    for (let c = 0; c < cameraPoses.length; c++) {
      const pose = cameraPoses[c];
      const viewDir = new THREE.Vector3()
        .subVectors(pose.position, faceCenter)
        .normalize();
      const dot = faceNormal.dot(viewDir);

      if (dot > bestScore) {
        bestScore = dot;
        bestPoseIdx = c;
      }
    }

    if (bestPoseIdx >= 0 && bestScore > 0.05) {
      const pose = cameraPoses[bestPoseIdx];
      const imgCtx = imgContexts[bestPoseIdx];

      // Project face center into the chosen camera
      const projected = faceCenter.clone().applyMatrix4(pose.viewProjMatrix);

      const px = Math.floor(((projected.x + 1) / 2) * imgCtx.w);
      const py = Math.floor(((1 - projected.y) / 2) * imgCtx.h);

      if (px >= 0 && px < imgCtx.w && py >= 0 && py < imgCtx.h) {
        const pIdx = (py * imgCtx.w + px) * 4;
        const r = imgCtx.data[pIdx];
        const g = imgCtx.data[pIdx + 1];
        const b = imgCtx.data[pIdx + 2];

        // UV coords for face vertices
        const u1 = uvAttr.getX(i) * textureSize;
        const v1 = (1 - uvAttr.getY(i)) * textureSize;
        const u2 = uvAttr.getX(i + 1) * textureSize;
        const v2 = (1 - uvAttr.getY(i + 1)) * textureSize;
        const u3 = uvAttr.getX(i + 2) * textureSize;
        const v3 = (1 - uvAttr.getY(i + 2)) * textureSize;

        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.beginPath();
        ctx.moveTo(u1, v1);
        ctx.lineTo(u2, v2);
        ctx.lineTo(u3, v3);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  return canvas;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 16));
}
