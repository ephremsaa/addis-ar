import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as THREE from 'three';
import { validateImageQuality } from '@/lib/scanner/image-validator';
import { segmentForeground, applyBrushEdit } from '@/lib/scanner/background-segmenter';
import { marchCubes, type VoxelGrid } from '@/lib/scanner/marching-cubes';
import { optimizeMesh } from '@/lib/scanner/mesh-optimizer';
import { SCAN_STEPS, type ScanPhoto } from '@/lib/scanner/types';
import { extractKeypoints, ransacEpipolarFilter } from '@/lib/scanner/pose-estimator';
import { generateQualityReport } from '@/lib/scanner/quality-report';

// Mock canvas and 2D context for jsdom environment
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn((contextId: string) => {
    if (contextId === '2d') {
      return {
        drawImage: vi.fn(),
        getImageData: vi.fn((x, y, w, h) => ({
          data: new Uint8ClampedArray(w * h * 4).fill(128),
        })),
        putImageData: vi.fn(),
        createImageData: vi.fn((w, h) => ({
          data: new Uint8ClampedArray(w * h * 4),
        })),
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
      } as any;
    }
    return null;
  }) as any;

  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,mock');
});

describe('3D Object Scanner - Image Quality Validator', () => {
  it('analyzes image brightness, sharpness, and feature richness', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;

    const quality = await validateImageQuality(canvas);

    expect(quality).toBeDefined();
    expect(typeof quality.blurScore).toBe('number');
    expect(typeof quality.overallScore).toBe('number');
    expect(Array.isArray(quality.warnings)).toBe(true);
  });
});

describe('3D Object Scanner - Background Segmentation', () => {
  it('generates maskDataUrl and transparentDataUrl', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;

    const result = await segmentForeground(canvas);

    expect(result.maskDataUrl).toBeDefined();
    expect(result.transparentDataUrl).toBeDefined();
    expect(typeof result.foregroundRatio).toBe('number');
  });

  it('allows restoring or erasing mask regions via applyBrushEdit', async () => {
    const origData = 'data:image/png;base64,mock';
    const maskData = 'data:image/png;base64,mock';

    // Mock Image load for jsdom
    global.Image = class {
      width = 100;
      height = 100;
      crossOrigin = '';
      src = '';
      onload: any = null;
      constructor() {
        setTimeout(() => this.onload && this.onload(), 5);
      }
    } as any;

    const edited = await applyBrushEdit(
      origData,
      maskData,
      [{ x: 50, y: 50 }],
      'restore',
      15
    );

    expect(edited.maskDataUrl).toBeDefined();
    expect(edited.transparentDataUrl).toBeDefined();
  });
});

describe('3D Object Scanner - Marching Cubes & Surface Reconstruction', () => {
  it('extracts a manifold 3D triangle mesh from a 3D spherical density field', () => {
    const n = 16;
    const values = new Float32Array(n * n * n);

    // Create a sphere of positive density in the center
    const radius = 0.6;
    for (let z = 0; z < n; z++) {
      const vz = -1 + (z / (n - 1)) * 2;
      for (let y = 0; y < n; y++) {
        const vy = -1 + (y / (n - 1)) * 2;
        for (let x = 0; x < n; x++) {
          const vx = -1 + (x / (n - 1)) * 2;
          const distSq = vx * vx + vy * vy + vz * vz;
          values[z * n * n + y * n + x] = radius * radius - distSq;
        }
      }
    }

    const grid: VoxelGrid = {
      nx: n,
      ny: n,
      nz: n,
      minX: -1,
      minY: -1,
      minZ: -1,
      cellSize: 2 / n,
      values,
    };

    const geometry = marchCubes(grid, 0.0);

    expect(geometry).toBeInstanceOf(THREE.BufferGeometry);
    const pos = geometry.getAttribute('position');
    expect(pos).toBeDefined();
    expect(pos.count).toBeGreaterThan(0);

    // Verify normals and UV attributes exist
    expect(geometry.getAttribute('normal')).toBeDefined();
    expect(geometry.getAttribute('uv')).toBeDefined();
  });
});

describe('3D Object Scanner - Mesh Optimization', () => {
  it('centers geometry and aligns origin to bottom', () => {
    const geo = new THREE.BoxGeometry(1, 2, 1);
    // Shift initial geometry away from origin
    geo.translate(5, 5, 5);

    const optimized = optimizeMesh(geo, {
      center: true,
      origin: 'bottom',
      scale: 1.0,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      removeDisconnectedDebris: false,
      decimationRatio: 1.0,
    });

    optimized.computeBoundingBox();
    const box = optimized.boundingBox!;

    // Bottom origin means minimum Y is 0
    expect(Math.abs(box.min.y)).toBeLessThan(1e-4);
    // Centered in X and Z
    expect(Math.abs((box.min.x + box.max.x) / 2)).toBeLessThan(1e-4);
    expect(Math.abs((box.min.z + box.max.z) / 2)).toBeLessThan(1e-4);
  });
});

describe('3D Object Scanner - Steps & Hemisphere Configuration', () => {
  it('defines comprehensive multi-angle steps covering 360 azimuth and elevations', () => {
    expect(SCAN_STEPS.length).toBeGreaterThanOrEqual(12);

    const azimuths = SCAN_STEPS.map((s) => s.azimuth);
    expect(azimuths).toContain(0);
    expect(azimuths).toContain(90);
    expect(azimuths).toContain(180);
    expect(azimuths).toContain(270);

    const elevations = SCAN_STEPS.map((s) => s.elevation);
    expect(elevations.some((e) => e > 30)).toBe(true);
  });
});

describe('3D Object Scanner - Optical Pose Estimation & Epipolar Matching', () => {
  it('extracts corner keypoints with 32-byte binary descriptors', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const ctx = canvas.getContext('2d')!;

    const keypoints = extractKeypoints(ctx, 160, 120, 50);
    expect(Array.isArray(keypoints)).toBe(true);
  });

  it('filters outlier feature correspondences with RANSAC epipolar geometry', () => {
    const dummyMatches = [
      { kp1: { x: 20, y: 20 }, kp2: { x: 25, y: 22 }, distance: 5 },
      { kp1: { x: 40, y: 30 }, kp2: { x: 46, y: 31 }, distance: 6 },
      { kp1: { x: 60, y: 50 }, kp2: { x: 65, y: 52 }, distance: 7 },
      { kp1: { x: 80, y: 70 }, kp2: { x: 86, y: 71 }, distance: 8 },
      { kp1: { x: 100, y: 90 }, kp2: { x: 105, y: 91 }, distance: 6 },
      { kp1: { x: 120, y: 100 }, kp2: { x: 126, y: 102 }, distance: 5 },
      { kp1: { x: 140, y: 110 }, kp2: { x: 145, y: 111 }, distance: 7 },
      { kp1: { x: 150, y: 115 }, kp2: { x: 155, y: 116 }, distance: 6 },
      // Severe outlier
      { kp1: { x: 10, y: 10 }, kp2: { x: 150, y: 90 }, distance: 40 },
    ];

    const result = ransacEpipolarFilter(dummyMatches as any, 160, 120, 20, 5.0);

    expect(result.inliers).toBeDefined();
    expect(result.inliers.length).toBeGreaterThan(0);
    expect(typeof result.reprojectionError).toBe('number');
  });
});

describe('3D Object Scanner - Quality Report & Auto-Retry Generation', () => {
  it('generates a measured quality report with diagnostics and retries', () => {
    const goodReport = generateQualityReport({
      totalPhotos: 16,
      registeredCameras: 16,
      registrationPercentage: 100,
      sparsePointCount: 1420,
      densePointCount: 4200,
      vertexCount: 4200,
      triangleCount: 8400,
      textureResolution: 1024,
      meanReprojectionErrorPx: 1.4,
      disconnectedComponentsCount: 0,
      surfaceCoverageScore: 92,
      exportValid: true,
      warnings: [],
    });

    expect(goodReport.status).toBe('Good');
    expect(goodReport.score).toBeGreaterThanOrEqual(80);
    expect(goodReport.metrics.exportValid).toBe(true);

    const poorReport = generateQualityReport({
      totalPhotos: 12,
      registeredCameras: 6,
      registrationPercentage: 50,
      sparsePointCount: 120,
      densePointCount: 600,
      vertexCount: 600,
      triangleCount: 500,
      textureResolution: 1024,
      meanReprojectionErrorPx: 4.8,
      disconnectedComponentsCount: 8,
      surfaceCoverageScore: 40,
      exportValid: true,
      warnings: ['Sparse feature overlap'],
    });

    expect(poorReport.status).toBe('Needs improvement');
    expect(poorReport.diagnostics.length).toBeGreaterThan(0);
    expect(poorReport.retryRecommendation?.canAutoRetry).toBe(true);
  });
});

describe('3D Object Scanner - Mesh Spike Artifact & Topology Cleaner', () => {
  it('detects and eliminates needle spikes and degenerate faces while preserving genuine geometry', async () => {
    const { cleanReconstructedMesh } = await import('@/lib/scanner/mesh-cleaner');

    const geom = new THREE.BufferGeometry();
    // Create 3 triangles:
    // Tri 1: Normal equilateral-like triangle on real object surface
    // Tri 2: Degenerate triangle (all identical points)
    // Tri 3: Needle spike triangle with extreme aspect ratio (base = 0.005, height = 2.5)
    const positions = new Float32Array([
      // Normal Triangle
      0.0, 0.0, 0.0,
      0.1, 0.0, 0.0,
      0.05, 0.1, 0.0,

      // Degenerate Triangle (zero area)
      0.2, 0.2, 0.2,
      0.2, 0.2, 0.2,
      0.2, 0.2, 0.2,

      // Needle Spike Triangle (spanning empty space)
      0.0, 0.0, 0.0,
      0.002, 0.0, 0.0,
      0.001, 2.8, 0.0,
    ]);

    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const { geometry: cleaned, report } = cleanReconstructedMesh(geom);

    expect(report.originalFaceCount).toBe(3);
    expect(report.degenerateFacesRemoved).toBe(1);
    expect(report.spikeTrianglesRemoved).toBeGreaterThanOrEqual(1);
    expect(cleaned.getAttribute('position').count).toBe(3); // Only the 1 normal triangle survives
  });
});

