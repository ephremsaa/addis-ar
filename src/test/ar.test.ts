import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { CameraManager } from '@/lib/ar/camera-manager';
import { TargetManager } from '@/lib/ar/target-manager';
import { TrackingManager } from '@/lib/ar/tracking-manager';
import { PlacementController } from '@/lib/ar/placement-controller';
import { MarkerDetector } from '@/lib/ar/vision/marker-detector';
import { TargetAnalyzer } from '@/lib/ar/vision/target-analyzer';
import { ARSessionManager } from '@/lib/ar/ar-session-manager';
import { newObject, type SceneObject } from '@/lib/ar/projects';

describe('CameraManager', () => {
  let camera: CameraManager;

  beforeEach(() => {
    camera = new CameraManager();
  });

  it('initializes in idle or insecure state based on context', () => {
    expect(['idle', 'insecure']).toContain(camera.getStatus());
  });

  it('stops camera cleanly and resets stream', () => {
    const mockTrack = { stop: vi.fn() } as unknown as MediaStreamTrack;
    const mockStream = {
      getTracks: () => [mockTrack],
    } as unknown as MediaStream;

    (camera as unknown as { stream: MediaStream }).stream = mockStream;
    camera.stopCamera();

    expect(mockTrack.stop).toHaveBeenCalled();
    expect(camera.getStream()).toBeNull();
  });
});

describe('MarkerDetector', () => {
  it('generates a valid SVG test marker with specified ID', () => {
    const svg = MarkerDetector.generateMarkerSVG(0, 300);
    expect(svg).toContain('<svg');
    expect(svg).toContain('Addis AR Fiducial Marker #0');
  });

  it('generates a data URL for downloading/viewing', () => {
    const url = MarkerDetector.generateMarkerDataURL(1, 200);
    expect(url.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('estimates 3D pose from 4 corner points', () => {
    const corners = [
      { x: 0.3, y: 0.3 },
      { x: 0.7, y: 0.3 },
      { x: 0.7, y: 0.7 },
      { x: 0.3, y: 0.7 },
    ];
    const pose = MarkerDetector.estimatePoseFromCorners(corners, 640, 480, 0.15);
    expect(pose.position).toHaveLength(3);
    expect(pose.rotation).toHaveLength(3);
    expect(pose.position[2]).toBeLessThan(0); // positioned in front of camera
    expect(pose.matrix).toBeInstanceOf(THREE.Matrix4);
  });
});

describe('PlacementController', () => {
  let testObj: SceneObject;

  beforeEach(() => {
    testObj = newObject('cube');
    testObj.position = [1.5, 2.0, -3.0];
    testObj.rotation = [0.5, 1.0, 0];
    testObj.scale = [2, 2, 2];
  });

  it('snaps object to target origin [0, 0, 0]', () => {
    const snapped = PlacementController.snapToTarget(testObj);
    expect(snapped.position).toEqual([0, 0, 0]);
  });

  it('aligns object to surface ground plane (Y = 0)', () => {
    const aligned = PlacementController.alignToSurface(testObj);
    expect(aligned.position[1]).toBe(0);
    expect(aligned.position[0]).toBe(1.5);
    expect(aligned.position[2]).toBe(-3.0);
  });

  it('places object in front of camera view along -Z', () => {
    const front = PlacementController.placeInFrontOfCamera(testObj, 2.0);
    expect(front.position).toEqual([0, 0, -2.0]);
  });

  it('resets transforms to standard default [0, 0, 0]', () => {
    const reset = PlacementController.resetTransform(testObj);
    expect(reset.position).toEqual([0, 0, 0]);
    expect(reset.rotation).toEqual([0, 0, 0]);
    expect(reset.scale).toEqual([1, 1, 1]);
  });

  it('updates uniform scale proportionally', () => {
    const scaled = PlacementController.setUniformScale(testObj, 3.5);
    expect(scaled.scale).toEqual([3.5, 3.5, 3.5]);
  });

  it('fine-nudges transform values along specific axis', () => {
    const nudged = PlacementController.fineStep(testObj, 'position', 0, 0.25);
    expect(nudged.position[0]).toBe(1.75);
  });
});

describe('TrackingManager', () => {
  let tracking: TrackingManager;

  beforeEach(() => {
    tracking = new TrackingManager();
  });

  it('starts in lost state without active video or target', () => {
    const report = tracking.getReport();
    expect(report.state).toBe('lost');
    expect(report.confidence).toBe(0);
  });

  it('switches tracking modes cleanly', () => {
    tracking.setMode('marker');
    expect(tracking.getMode()).toBe('marker');

    tracking.setMode('device-orientation');
    expect(tracking.getMode()).toBe('device-orientation');
  });

  it('notifies subscribers upon pose updates', () => {
    let callCount = 0;
    const unsub = tracking.subscribe(() => {
      callCount++;
    });

    tracking.resetPose();
    expect(callCount).toBeGreaterThanOrEqual(1);
    unsub();
  });
});

describe('ARSessionManager', () => {
  it('instantiates sub-managers and publishes aggregate state', () => {
    const session = new ARSessionManager();
    const state = session.getState();

    expect(state).toHaveProperty('cameraStatus');
    expect(state).toHaveProperty('trackingReport');
    expect(state).toHaveProperty('targetCandidate');
    expect(state).toHaveProperty('lockedTarget');
    expect(state).toHaveProperty('availableCameras');

    session.dispose();
  });
});
