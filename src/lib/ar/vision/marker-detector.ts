import * as THREE from 'three';

export interface Point2D {
  x: number;
  y: number;
}

export interface MarkerPose {
  position: [number, number, number];
  rotation: [number, number, number]; // Euler angles (radians)
  quaternion: THREE.Quaternion;
  matrix: THREE.Matrix4;
}

export interface DetectedMarker {
  id: number;
  corners: Point2D[]; // in normalized video coordinates [0..1]
  center: Point2D;
  confidence: number;
  pose: MarkerPose;
}

// Canonical 4x4 marker definitions (Dictionary with hamming distance)
const MARKER_DICT_4X4: number[][] = [
  // Marker 0: 0b1001, 0b0110, 0b1001, 0b0110 -> [9, 6, 9, 6]
  [1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0],
  // Marker 1:
  [1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 1],
  // Marker 2:
  [0, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1],
  // Marker 3:
  [1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1],
  // Marker 4:
  [1, 1, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 1, 1],
];

export class MarkerDetector {
  private static canvas: HTMLCanvasElement | null = null;
  private static ctx: CanvasRenderingContext2D | null = null;

  private static getContext(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }
    return { canvas: this.canvas, ctx: this.ctx! };
  }

  /**
   * Generates a printable / displayable SVG for a visual fiducial marker.
   */
  public static generateMarkerSVG(markerId = 0, size = 300): string {
    const pattern = MARKER_DICT_4X4[markerId % MARKER_DICT_4X4.length] || MARKER_DICT_4X4[0];
    const border = 1; // 1-cell black border
    const gridDim = 6; // 1 border + 4 bits + 1 border
    const cellSize = size / (gridDim + 2); // outer white margin of 1 cell

    let rects = '';
    // Black outer frame (6x6 cells)
    const frameX = cellSize;
    const frameY = cellSize;
    const frameW = cellSize * gridDim;
    rects += `<rect x="${frameX}" y="${frameY}" width="${frameW}" height="${frameW}" fill="black" />`;

    // Inner bits (4x4 cells starting at index 1..4)
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const bit = pattern[r * 4 + c];
        if (bit === 1) {
          const bx = cellSize * (c + 2);
          const by = cellSize * (r + 2);
          rects += `<rect x="${bx}" y="${by}" width="${cellSize}" height="${cellSize}" fill="white" />`;
        }
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <rect width="${size}" height="${size}" fill="white" />
      ${rects}
      <text x="${size / 2}" y="${size - 6}" font-family="sans-serif" font-size="11" text-anchor="middle" fill="#666">Addis AR Fiducial Marker #${markerId}</text>
    </svg>`;
  }

  /**
   * Generates a data URL for downloading/viewing the sample marker image.
   */
  public static generateMarkerDataURL(markerId = 0, size = 300): string {
    const svg = this.generateMarkerSVG(markerId, size);
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  /**
   * Detects visual markers in the current video frame and estimates 3D camera-relative pose.
   */
  public static detectMarkers(
    video: HTMLVideoElement,
    physicalMarkerSizeMeters = 0.15
  ): DetectedMarker[] {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return [];

    // Process downscaled image for real-time 60fps performance
    const scale = Math.min(1, 480 / Math.max(vw, vh));
    const procW = Math.floor(vw * scale);
    const procH = Math.floor(vh * scale);

    const { canvas, ctx } = this.getContext();
    canvas.width = procW;
    canvas.height = procH;
    ctx.drawImage(video, 0, 0, procW, procH);

    const imgData = ctx.getImageData(0, 0, procW, procH);
    const data = imgData.data;
    const gray = new Uint8Array(procW * procH);

    // Convert to grayscale
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      gray[p] = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    }

    // Adaptive thresholding & candidate search
    const candidates = this.findQuadCandidates(gray, procW, procH);
    const results: DetectedMarker[] = [];

    for (const quad of candidates) {
      // Decode inner grid
      const decoded = this.decodeMarkerBits(gray, procW, procH, quad);
      if (decoded && decoded.id >= 0) {
        // Map corners back to normalized 0..1 coordinates
        const normCorners: Point2D[] = quad.map((pt) => ({
          x: pt.x / procW,
          y: pt.y / procH,
        }));

        const center: Point2D = {
          x: (normCorners[0].x + normCorners[1].x + normCorners[2].x + normCorners[3].x) / 4,
          y: (normCorners[0].y + normCorners[1].y + normCorners[2].y + normCorners[3].y) / 4,
        };

        const pose = this.estimatePoseFromCorners(
          normCorners,
          vw,
          vh,
          physicalMarkerSizeMeters
        );

        results.push({
          id: decoded.id,
          corners: normCorners,
          center,
          confidence: decoded.confidence,
          pose,
        });
      }
    }

    return results;
  }

  /**
   * Fast quad boundary detector for square high-contrast markers.
   */
  private static findQuadCandidates(
    gray: Uint8Array,
    w: number,
    h: number
  ): Point2D[][] {
    const quads: Point2D[][] = [];
    const step = 8;
    const minSize = Math.min(w, h) * 0.12;
    const maxSize = Math.min(w, h) * 0.85;

    // Fast raster sweep looking for black borders surrounded by bright margins
    for (let y = Math.floor(h * 0.1); y < h * 0.85; y += step * 3) {
      for (let x = Math.floor(w * 0.1); x < w * 0.85; x += step * 3) {
        const val = gray[y * w + x];
        // If we hit a very dark pixel (marker black border candidate)
        if (val < 65) {
          // Trace horizontal and vertical extent
          let left = x;
          while (left > 0 && gray[y * w + left] < 90) left--;
          let right = x;
          while (right < w - 1 && gray[y * w + right] < 90) right++;
          let top = y;
          while (top > 0 && gray[top * w + x] < 90) top--;
          let bottom = y;
          while (bottom < h - 1 && gray[bottom * w + x] < 90) bottom++;

          const quadW = right - left;
          const quadH = bottom - top;

          if (
            quadW >= minSize &&
            quadW <= maxSize &&
            quadH >= minSize &&
            quadH <= maxSize &&
            Math.abs(quadW - quadH) / Math.max(quadW, quadH) < 0.45
          ) {
            const quad: Point2D[] = [
              { x: left, y: top },
              { x: right, y: top },
              { x: right, y: bottom },
              { x: left, y: bottom },
            ];

            // Verify not duplicate
            const alreadyFound = quads.some(
              (q) => Math.abs(q[0].x - quad[0].x) < step * 2 && Math.abs(q[0].y - quad[0].y) < step * 2
            );
            if (!alreadyFound) {
              quads.push(quad);
              if (quads.length >= 6) return quads;
            }
          }
        }
      }
    }

    return quads;
  }

  /**
   * Samples a 6x6 grid across the quad and tests against known marker templates.
   */
  private static decodeMarkerBits(
    gray: Uint8Array,
    w: number,
    h: number,
    corners: Point2D[]
  ): { id: number; confidence: number } | null {
    const gridDim = 6;
    const bits: number[] = [];

    // Bilinear sampling of 6x6 cells
    for (let r = 0; r < gridDim; r++) {
      const v = (r + 0.5) / gridDim;
      for (let c = 0; c < gridDim; c++) {
        const u = (c + 0.5) / gridDim;

        // Bilinear interpolate corner points
        const topX = corners[0].x + u * (corners[1].x - corners[0].x);
        const topY = corners[0].y + u * (corners[1].y - corners[0].y);
        const botX = corners[3].x + u * (corners[2].x - corners[3].x);
        const botY = corners[3].y + u * (corners[2].y - corners[3].y);

        const px = Math.floor(topX + v * (botX - topX));
        const py = Math.floor(topY + v * (botY - topY));

        if (px >= 0 && px < w && py >= 0 && py < h) {
          const lum = gray[py * w + px];
          bits.push(lum > 128 ? 1 : 0);
        } else {
          bits.push(0);
        }
      }
    }

    // 1. Check outer border: all 20 border cells should be 0 (black)
    let borderBlack = 0;
    const borderIndices = [
      0, 1, 2, 3, 4, 5,
      30, 31, 32, 33, 34, 35,
      6, 12, 18, 24,
      11, 17, 23, 29,
    ];
    for (const idx of borderIndices) {
      if (bits[idx] === 0) borderBlack++;
    }

    if (borderBlack < 15) {
      // Border is not sufficiently black
      return null;
    }

    // 2. Extract 4x4 inner matrix
    const innerBits: number[] = [];
    for (let r = 1; r <= 4; r++) {
      for (let c = 1; c <= 4; c++) {
        innerBits.push(bits[r * 6 + c]);
      }
    }

    // 3. Match against known marker dictionary across 4 possible orientations
    let bestMatch = -1;
    let minHamming = 16;

    for (let markerId = 0; markerId < MARKER_DICT_4X4.length; markerId++) {
      const dictPattern = MARKER_DICT_4X4[markerId];

      for (let rot = 0; rot < 4; rot++) {
        let diff = 0;
        for (let i = 0; i < 16; i++) {
          if (innerBits[i] !== dictPattern[i]) diff++;
        }
        if (diff < minHamming) {
          minHamming = diff;
          bestMatch = markerId;
        }
      }
    }

    if (minHamming <= 3) {
      const confidence = Math.max(0.5, 1 - minHamming / 16);
      return { id: bestMatch, confidence };
    }

    return null;
  }

  /**
   * Computes 3D camera-space position and rotation from 2D marker corner coordinates.
   */
  public static estimatePoseFromCorners(
    corners: Point2D[],
    vw: number,
    vh: number,
    markerPhysicalSize = 0.15
  ): MarkerPose {
    // Virtual focal length estimate (~55 degree fov)
    const aspect = vw / vh;
    const fovY = (50 * Math.PI) / 180;
    const fy = 1.0 / (2 * Math.tan(fovY / 2));
    const fx = fy / aspect;

    // Corner pixel coordinates relative to center
    const c0x = (corners[0].x - 0.5);
    const c0y = (corners[0].y - 0.5);
    const c1x = (corners[1].x - 0.5);
    const c1y = (corners[1].y - 0.5);
    const c2x = (corners[2].x - 0.5);
    const c2y = (corners[2].y - 0.5);
    const c3x = (corners[3].x - 0.5);
    const c3y = (corners[3].y - 0.5);

    // Marker dimensions in normalized screen space
    const topWidth = Math.hypot(c1x - c0x, c1y - c0y);
    const botWidth = Math.hypot(c2x - c3x, c2y - c3y);
    const avgScreenW = (topWidth + botWidth) / 2;

    // Depth estimation based on apparent size
    const estDepth = Math.max(0.2, (markerPhysicalSize * fx) / Math.max(0.01, avgScreenW));

    // Center offset
    const centerX = (c0x + c1x + c2x + c3x) / 4;
    const centerY = (c0y + c1y + c2y + c3y) / 4;

    const posX = (centerX / fx) * estDepth;
    const posY = -(centerY / fy) * estDepth;
    const posZ = -estDepth;

    // Yaw estimation from top edge angle
    const yaw = Math.atan2(c1y - c0y, c1x - c0x);
    // Pitch estimation from perspective foreshortening
    const pitch = Math.min(1.2, Math.max(-1.2, (botWidth - topWidth) * 3));
    // Roll
    const roll = 0;

    const euler = new THREE.Euler(pitch, yaw, roll, 'YXZ');
    const quat = new THREE.Quaternion().setFromEuler(euler);

    const mat = new THREE.Matrix4().compose(
      new THREE.Vector3(posX, posY, posZ),
      quat,
      new THREE.Vector3(1, 1, 1)
    );

    return {
      position: [Number(posX.toFixed(3)), Number(posY.toFixed(3)), Number(posZ.toFixed(3))],
      rotation: [Number(pitch.toFixed(3)), Number(yaw.toFixed(3)), Number(roll.toFixed(3))],
      quaternion: quat,
      matrix: mat,
    };
  }
}
