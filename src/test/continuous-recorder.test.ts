import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import {
  ContinuousScanRecorder,
  processRecordedFramesToPhotos,
  exportScanDataset,
  importScanDataset,
} from "../lib/scanner/continuous-recorder";
import {
  validateAndCalibrateDepth,
  fuseDepthObservations,
  isWebXRDepthSupported,
} from "../lib/scanner/depth-processor";
import type { ScanPhoto } from "../lib/scanner/types";

describe("ContinuousScanRecorder and Frame Selection", () => {
  it("detects WebXR depth capability gracefully", () => {
    const supported = isWebXRDepthSupported();
    expect(typeof supported).toBe("boolean");
  });

  it("filters and calibrates depth measurements within valid object bounds", () => {
    const width = 10;
    const height = 10;
    const rawDepths = new Float32Array(width * height);

    // Populate half with valid object depths (0.4m), half with invalid noise (0m, 5.0m, NaN)
    for (let i = 0; i < rawDepths.length; i++) {
      if (i < 50) {
        rawDepths[i] = 0.45; // Valid 45cm distance
      } else if (i < 70) {
        rawDepths[i] = 0.05; // Too close (< 0.15m)
      } else {
        rawDepths[i] = 4.5; // Too far (> 1.2m)
      }
    }

    const calibrated = validateAndCalibrateDepth(rawDepths, width, height, 1.0, 0.15, 1.2);
    expect(calibrated).not.toBeNull();
    if (calibrated) {
      expect(calibrated.width).toBe(width);
      expect(calibrated.height).toBe(height);
      // Valid depths preserved
      expect(calibrated.depthBuffer[0]).toBeCloseTo(0.45);
      // Invalid depths zeroed out
      expect(calibrated.depthBuffer[60]).toBe(0);
      expect(calibrated.depthBuffer[80]).toBe(0);
    }
  });

  it("rejects completely noisy or empty depth maps (<5% valid)", () => {
    const width = 10;
    const height = 10;
    const rawDepths = new Float32Array(width * height); // all 0

    const calibrated = validateAndCalibrateDepth(rawDepths, width, height);
    expect(calibrated).toBeNull();
  });

  it("fuses depth observations into a structured 3D point cloud", () => {
    const width = 4;
    const height = 4;
    const depthBuffer = new Float32Array(width * height).fill(0.5); // 0.5m

    const observation = {
      width,
      height,
      depthBuffer,
      minValidDepth: 0.15,
      maxValidDepth: 1.2,
      timestamp: Date.now(),
    };

    const pose = {
      position: new THREE.Vector3(0, 0, 0.5),
      matrix: new THREE.Matrix4().identity(),
    };

    const pointCloud = fuseDepthObservations([{ depth: observation, pose }]);
    expect(pointCloud).not.toBeNull();
    if (pointCloud) {
      expect(pointCloud.pointCount).toBeGreaterThan(0);
      expect(pointCloud.positions.length).toBe(pointCloud.pointCount * 3);
      expect(pointCloud.bounds.center).toBeDefined();
    }
  });

  it("calculates 360-degree orbit guidance correctly as camera moves around object", () => {
    const recorder = new ContinuousScanRecorder(null, {
      minMotionDiffPercent: 4.0,
    });

    // Simulate 4 cameras around 4 quadrants (0 deg, 90 deg, 180 deg, 270 deg)
    const angles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
    for (let i = 0; i < angles.length; i++) {
      const theta = angles[i]!;
      const pos = new THREE.Vector3(Math.cos(theta) * 0.5, 0, Math.sin(theta) * 0.5);
      const pose = {
        position: pos,
        matrix: new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z),
      };

      recorder.updateCoverage(pose);
    }

    const coverage = recorder.getCoverage();
    expect(coverage.visitedBins).toBeGreaterThanOrEqual(4);
    expect(coverage.percentage).toBeGreaterThan(25);
  });

  it("exports and imports ARCore scan datasets with frame timestamps and telemetry", async () => {
    // Generate dummy 1x1 base64 png
    const dummyImage =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const testPhotos = [
      {
        id: "photo-1",
        dataUrl: dummyImage,
        thumbnailUrl: dummyImage,
        timestamp: 1690000000,
        qualityScore: 88,
        blurScore: 120,
        coverageCategory: "side" as const,
        suggestedNextAngle: "left",
      },
      {
        id: "photo-2",
        dataUrl: dummyImage,
        thumbnailUrl: dummyImage,
        timestamp: 1690000002,
        qualityScore: 92,
        blurScore: 140,
        coverageCategory: "top" as const,
        suggestedNextAngle: "right",
      },
      {
        id: "photo-3",
        dataUrl: dummyImage,
        thumbnailUrl: dummyImage,
        timestamp: 1690000004,
        qualityScore: 95,
        blurScore: 160,
        coverageCategory: "side" as const,
        suggestedNextAngle: "up",
      },
    ];

    const blob = exportScanDataset(testPhotos as unknown as ScanPhoto[], {
      objectName: "Test Scanned Object",
      captureDurationSec: 15.5,
    });

    expect(blob).toBeInstanceOf(Blob);
    const jsonString = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(blob);
    });
    expect(typeof jsonString).toBe("string");
    const parsed = JSON.parse(jsonString);
    expect(parsed.format).toContain("AddisAR-ScanDataset");
    expect(parsed.frames.length).toBe(3);
    expect(parsed.metadata.objectName).toBe("Test Scanned Object");

    const importedPhotos = await importScanDataset(blob);
    expect(importedPhotos.length).toBe(3);
    expect(importedPhotos[0]?.id).toBe("photo-1");
    expect(importedPhotos[1]?.id).toBe("photo-2");
    expect(importedPhotos[2]?.id).toBe("photo-3");
  });
});
