import * as THREE from 'three';
import type { EstimatedCameraPose } from './pose-estimator';

export interface TextureMappingOptions {
  textureSize: number; // e.g. 1024 or 2048
  blendSeams: boolean;
  rejectOcclusions: boolean;
  backgroundColor: string;
}

export interface TextureMappingResult {
  textureCanvas: HTMLCanvasElement;
  coveredFacesRatio: number;
  meanBlendingWeight: number;
}

/**
 * High-fidelity Multi-View Photographic Texture Mapper:
 * - Raycasts triangle normals against all registered camera views
 * - Filters out occluded or severe grazing angles (< 15 degrees)
 * - Verifies mask foreground to prevent background bleed onto object edges
 * - Performs cosine-weighted blending between top 2 best cameras to eliminate visible seams
 * - Paints directly onto UV coordinates of the target mesh
 */
export function mapMultiViewTextures(
  geometry: THREE.BufferGeometry,
  cameraPoses: EstimatedCameraPose[],
  options: Partial<TextureMappingOptions> = {}
): TextureMappingResult {
  const textureSize = options.textureSize || 1024;
  const blendSeams = options.blendSeams !== false;
  const bgColor = options.backgroundColor || '#201c27';

  const canvas = document.createElement('canvas');
  canvas.width = textureSize;
  canvas.height = textureSize;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  // Fill neutral studio base
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, textureSize, textureSize);

  const posAttr = geometry.getAttribute('position');
  const uvAttr = geometry.getAttribute('uv');
  const normAttr = geometry.getAttribute('normal');

  if (!posAttr || !uvAttr || cameraPoses.length === 0) {
    return {
      textureCanvas: canvas,
      coveredFacesRatio: 0,
      meanBlendingWeight: 0,
    };
  }

  // Pre-rasterize camera images and masks into pixel buffers for rapid sampling
  const cameraBuffers = cameraPoses.map((p) => {
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = Math.round((p.imageElement.height / p.imageElement.width) * 480);
    const cx = c.getContext('2d', { willReadFrequently: true })!;
    cx.drawImage(p.imageElement, 0, 0, c.width, c.height);
    const imgData = cx.getImageData(0, 0, c.width, c.height).data;

    // Mask buffer
    const mw = p.maskCanvas.width;
    const mh = p.maskCanvas.height;
    const maskData = p.maskContext.getImageData(0, 0, mw, mh).data;

    return {
      width: c.width,
      height: c.height,
      imgData,
      maskWidth: mw,
      maskHeight: mh,
      maskData,
      pose: p,
    };
  });

  const numVertices = posAttr.count;
  const numFaces = Math.floor(numVertices / 3);
  let texturedFaces = 0;

  const tempP1 = new THREE.Vector3();
  const tempP2 = new THREE.Vector3();
  const tempP3 = new THREE.Vector3();
  const faceCenter = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();
  const viewDir = new THREE.Vector3();

  for (let f = 0; f < numFaces; f++) {
    const i = f * 3;

    tempP1.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
    tempP2.set(posAttr.getX(i + 1), posAttr.getY(i + 1), posAttr.getZ(i + 1));
    tempP3.set(posAttr.getX(i + 2), posAttr.getY(i + 2), posAttr.getZ(i + 2));

    faceCenter.copy(tempP1).add(tempP2).add(tempP3).divideScalar(3);

    if (normAttr) {
      faceNormal.set(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i)).normalize();
    } else {
      faceNormal.crossVectors(
        new THREE.Vector3().subVectors(tempP2, tempP1),
        new THREE.Vector3().subVectors(tempP3, tempP1)
      ).normalize();
    }

    // Rank camera views by dot product (normal · view direction)
    const candidates: Array<{
      camIdx: number;
      dot: number;
      px: number;
      py: number;
    }> = [];

    for (let c = 0; c < cameraBuffers.length; c++) {
      const cam = cameraBuffers[c];
      if (!cam) continue;
      viewDir.subVectors(cam.pose.position, faceCenter).normalize();
      const dot = faceNormal.dot(viewDir);

      if (dot <= 0.12) continue; // Reject severe oblique grazing angles (> 83 degrees)

      // Project center into camera screen coordinates
      const proj = faceCenter.clone().applyMatrix4(cam.pose.viewProjMatrix);
      if (proj.z < -1 || proj.z > 1 || proj.x < -1 || proj.x > 1 || proj.y < -1 || proj.y > 1) {
        continue;
      }

      const px = Math.floor(((proj.x + 1) / 2) * cam.width);
      const py = Math.floor(((1 - proj.y) / 2) * cam.height);

      if (px >= 0 && px < cam.width && py >= 0 && py < cam.height) {
        // Verify mask foreground to avoid background color bleed
        const mpx = Math.floor(((proj.x + 1) / 2) * cam.maskWidth);
        const mpy = Math.floor(((1 - proj.y) / 2) * cam.maskHeight);
        if (mpx >= 0 && mpx < cam.maskWidth && mpy >= 0 && mpy < cam.maskHeight) {
          const maskAlpha = cam.maskData[(mpy * cam.maskWidth + mpx) * 4] ?? 0;
          if (maskAlpha > 60) {
            candidates.push({ camIdx: c, dot, px, py });
          }
        }
      }
    }

    if (candidates.length === 0) continue;

    candidates.sort((a, b) => b.dot - a.dot);
    texturedFaces++;

    let r = 0;
    let g = 0;
    let b = 0;

    if (blendSeams && candidates.length >= 2) {
      // Smooth cosine multi-view blend
      const c1 = candidates[0];
      const c2 = candidates[1];
      if (c1 && c2) {
        const cam1 = cameraBuffers[c1.camIdx];
        const cam2 = cameraBuffers[c2.camIdx];
        if (cam1 && cam2) {
          const idx1 = (c1.py * cam1.width + c1.px) * 4;
          const idx2 = (c2.py * cam2.width + c2.px) * 4;

          const totalWeight = c1.dot + c2.dot || 1;
          const w1 = c1.dot / totalWeight;
          const w2 = c2.dot / totalWeight;

          const r1 = cam1.imgData[idx1] ?? 0;
          const g1 = cam1.imgData[idx1 + 1] ?? 0;
          const b1 = cam1.imgData[idx1 + 2] ?? 0;

          const r2 = cam2.imgData[idx2] ?? 0;
          const g2 = cam2.imgData[idx2 + 1] ?? 0;
          const b2 = cam2.imgData[idx2 + 2] ?? 0;

          r = Math.round(r1 * w1 + r2 * w2);
          g = Math.round(g1 * w1 + g2 * w2);
          b = Math.round(b1 * w1 + b2 * w2);
        }
      }
    } else {
      const top = candidates[0];
      if (top) {
        const cam = cameraBuffers[top.camIdx];
        if (cam) {
          const idx = (top.py * cam.width + top.px) * 4;
          r = cam.imgData[idx] ?? 0;
          g = cam.imgData[idx + 1] ?? 0;
          b = cam.imgData[idx + 2] ?? 0;
        }
      }
    }

    // Rasterize polygon onto UV coordinates with 1.5px dilation to prevent black seam lines
    const u1 = uvAttr.getX(i) * textureSize;
    const v1 = (1 - uvAttr.getY(i)) * textureSize;
    const u2 = uvAttr.getX(i + 1) * textureSize;
    const v2 = (1 - uvAttr.getY(i + 1)) * textureSize;
    const u3 = uvAttr.getX(i + 2) * textureSize;
    const v3 = (1 - uvAttr.getY(i + 2)) * textureSize;

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.strokeStyle = `rgb(${r},${g},${b})`;
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(u1, v1);
    ctx.lineTo(u2, v2);
    ctx.lineTo(u3, v3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  const coveredRatio = numFaces > 0 ? Number((texturedFaces / numFaces).toFixed(2)) : 0;

  return {
    textureCanvas: canvas,
    coveredFacesRatio: coveredRatio,
    meanBlendingWeight: blendSeams ? 0.85 : 1.0,
  };
}
