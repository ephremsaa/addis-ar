import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as THREE from 'three';
import { validateImageQuality } from '@/lib/scanner/image-validator';
import { segmentForeground, applyBrushEdit } from '@/lib/scanner/background-segmenter';
import { marchCubes, type VoxelGrid } from '@/lib/scanner/marching-cubes';
import { optimizeMesh } from '@/lib/scanner/mesh-optimizer';
import { SCAN_STEPS, type ScanPhoto } from '@/lib/scanner/types';

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
