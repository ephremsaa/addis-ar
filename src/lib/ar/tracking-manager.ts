import * as THREE from "three";
import { MarkerDetector, type DetectedMarker } from "./vision/marker-detector";
import { TargetAnalyzer, type TargetTrackResult } from "./vision/target-analyzer";
import type { LockedTargetData } from "./target-manager";
import type { TrackingMode } from "./projects";

export type TrackingState = "reliable" | "uncertain" | "lost";

export interface TrackingPose {
  position: [number, number, number];
  rotation: [number, number, number]; // Euler angles (radians)
  quaternion: THREE.Quaternion;
  matrix: THREE.Matrix4;
}

export interface TrackingReport {
  mode: TrackingMode;
  state: TrackingState;
  confidence: number; // 0..1
  pose: TrackingPose;
  targetBounds: { x: number; y: number; width: number; height: number } | null;
  statusText: string;
  isWebXRActive: boolean;
  detectedMarkerId?: number | undefined;
}

export type TrackingEventCallback = (report: TrackingReport) => void;

export class TrackingManager {
  private mode: TrackingMode = "focus-target";
  private state: TrackingState = "lost";
  private confidence = 0;
  private smoothingFactor = 0.4; // 0 (heavy smoothing) to 1 (raw instantaneous)
  private confidenceThreshold = 0.4;

  // Raw and smoothed poses
  private currentPosition = new THREE.Vector3(0, 0, -1.5);
  private targetPosition = new THREE.Vector3(0, 0, -1.5);
  private currentQuaternion = new THREE.Quaternion();
  private targetQuaternion = new THREE.Quaternion();

  private targetBounds: { x: number; y: number; width: number; height: number } | null = null;
  private statusText = "Camera AR ready. Point at target and tap Scan Target.";
  private detectedMarkerId?: number | undefined;

  // WebXR session states
  private xrSession: XRSession | null = null;
  private xrRefSpace: XRReferenceSpace | null = null;
  private xrHitTestSource: XRHitTestSource | null = null;
  private isWebXRSupported = false;

  // Device orientation state
  private hasDeviceOrientation = false;
  private deviceEuler = new THREE.Euler(0, 0, 0, "YXZ");

  private listeners: Set<TrackingEventCallback> = new Set();

  constructor() {
    this.checkWebXRSupport();
    this.initDeviceOrientation();
  }

  private async checkWebXRSupport() {
    if (typeof navigator !== "undefined" && "xr" in navigator && navigator.xr) {
      try {
        this.isWebXRSupported = await navigator.xr.isSessionSupported("immersive-ar");
      } catch {
        this.isWebXRSupported = false;
      }
    }
  }

  private initDeviceOrientation() {
    if (typeof window === "undefined") return;
    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      this.hasDeviceOrientation = true;
      // Convert beta/gamma/alpha (degrees) to radians
      const pitch = ((e.beta - 90) * Math.PI) / 180; // tilt
      const roll = (e.gamma * Math.PI) / 180;
      const yaw = ((e.alpha || 0) * Math.PI) / 180;
      this.deviceEuler.set(pitch, -yaw, -roll, "YXZ");
    };

    window.addEventListener("deviceorientation", handleOrientation, { passive: true });
  }

  public subscribe(cb: TrackingEventCallback): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify() {
    const report = this.getReport();
    for (const cb of this.listeners) {
      cb(report);
    }
  }

  public setMode(mode: TrackingMode) {
    this.mode = mode;
    this.targetBounds = null;
    this.state = "lost";
    this.confidence = 0;
    this.statusText = `Switched to ${mode} mode.`;
    this.notify();
  }

  public getMode(): TrackingMode {
    return this.mode;
  }

  public setSmoothingFactor(factor: number) {
    this.smoothingFactor = Math.max(0.05, Math.min(1.0, factor));
  }

  public setConfidenceThreshold(thresh: number) {
    this.confidenceThreshold = Math.max(0.1, Math.min(0.9, thresh));
  }

  public getWebXRSupported(): boolean {
    return this.isWebXRSupported;
  }

  /**
   * Processes a video frame and updates pose estimation according to active mode.
   */
  public processFrame(video: HTMLVideoElement | null, lockedTarget: LockedTargetData | null): void {
    if (!video || !video.videoWidth) {
      this.state = "lost";
      this.confidence = 0;
      return;
    }

    if (this.mode === "marker") {
      this.processMarkerTracking(video);
    } else if (this.mode === "focus-target") {
      this.processFocusTargetTracking(video, lockedTarget);
    } else if (this.mode === "device-orientation") {
      this.processDeviceOrientationTracking();
    } else if (this.mode === "webxr-plane") {
      this.processWebXRTracking();
    }

    // Apply pose smoothing
    this.applySmoothing();
    this.notify();
  }

  /**
   * Fiducial / ArUco marker tracking
   */
  private processMarkerTracking(video: HTMLVideoElement) {
    const markers = MarkerDetector.detectMarkers(video, 0.15);
    const best = markers[0];
    if (best) {
      this.detectedMarkerId = best.id;
      this.confidence = best.confidence;

      this.targetPosition.set(...best.pose.position);
      this.targetQuaternion.copy(best.pose.quaternion);

      // Compute bounding box from corners
      const xs = best.corners.map((c) => c.x);
      const ys = best.corners.map((c) => c.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      this.targetBounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

      if (this.confidence >= 0.7) {
        this.state = "reliable";
        this.statusText = `Marker #${best.id} tracked stably (${Math.round(this.confidence * 100)}%)`;
      } else {
        this.state = "uncertain";
        this.statusText = `Marker #${best.id} tracking uncertain`;
      }
    } else {
      this.detectedMarkerId = undefined;
      this.confidence = Math.max(0, this.confidence - 0.15); // gentle decay
      if (this.confidence < this.confidenceThreshold) {
        this.state = "lost";
        this.targetBounds = null;
        this.statusText = "Marker lost. Hold marker in view of camera.";
      } else {
        this.state = "uncertain";
        this.statusText = "Holding previous marker pose…";
      }
    }
  }

  /**
   * Focus & Place visual target tracking
   */
  private processFocusTargetTracking(
    video: HTMLVideoElement,
    lockedTarget: LockedTargetData | null,
  ) {
    if (!lockedTarget) {
      this.state = "lost";
      this.confidence = 0;
      this.targetBounds = null;
      this.statusText = "No target locked. Align focus reticle & tap Scan Target.";
      return;
    }

    const lastCenter = {
      x: lockedTarget.roi.x + lockedTarget.roi.width / 2,
      y: lockedTarget.roi.y + lockedTarget.roi.height / 2,
    };

    const trackResult = TargetAnalyzer.trackTemplate(
      video,
      lockedTarget.templateData,
      lockedTarget.templateWidth,
      lockedTarget.templateHeight,
      lastCenter,
    );

    if (trackResult.detected) {
      this.confidence = trackResult.confidence;
      this.targetBounds = trackResult.bounds;

      // Map 2D target displacement to 3D space
      const normX = (trackResult.center.x - 0.5) * 2; // -1..1
      const normY = -(trackResult.center.y - 0.5) * 2; // -1..1
      const estZ = -1.5 / Math.max(0.5, trackResult.scaleEstimate);

      this.targetPosition.set(normX * 0.8, normY * 0.6, estZ);

      // Subtle tilt based on position
      const euler = new THREE.Euler(normY * 0.25, -normX * 0.25, 0, "YXZ");
      this.targetQuaternion.setFromEuler(euler);

      if (this.confidence >= 0.7) {
        this.state = "reliable";
        this.statusText = `Target “${lockedTarget.label}” tracked (${Math.round(this.confidence * 100)}%)`;
      } else {
        this.state = "uncertain";
        this.statusText = `Target tracking uncertain (${Math.round(this.confidence * 100)}%)`;
      }
    } else {
      this.confidence = Math.max(0, this.confidence - 0.15);
      if (this.confidence < this.confidenceThreshold) {
        this.state = "lost";
        this.targetBounds = null;
        this.statusText = "Target lost. Realign camera with selected target.";
      } else {
        this.state = "uncertain";
        this.statusText = "Target tracking uncertain";
      }
    }
  }

  /**
   * Device gyroscope orientation tracking
   */
  private processDeviceOrientationTracking() {
    if (this.hasDeviceOrientation) {
      this.confidence = 0.85;
      this.state = "reliable";
      this.targetQuaternion.setFromEuler(this.deviceEuler);
      this.targetPosition.set(0, 0, -1.2);
      this.statusText = "Device gyro orientation active";
    } else {
      this.confidence = 0.5;
      this.state = "uncertain";
      this.statusText = "Gyroscope unavailable. Using touch orbit controls.";
    }
  }

  /**
   * WebXR plane hit-test tracking
   */
  private processWebXRTracking() {
    if (!this.isWebXRSupported) {
      this.state = "lost";
      this.confidence = 0;
      this.statusText = "WebXR Immersive-AR not supported on this browser/device.";
    } else {
      this.statusText = "WebXR session active";
    }
  }

  /**
   * Applies smoothing (Lerp on position and Slerp on quaternion)
   */
  private applySmoothing() {
    const alpha = this.smoothingFactor;
    this.currentPosition.lerp(this.targetPosition, alpha);
    this.currentQuaternion.slerp(this.targetQuaternion, alpha);
  }

  public getSmoothedPose(): TrackingPose {
    const euler = new THREE.Euler().setFromQuaternion(this.currentQuaternion, "YXZ");
    const mat = new THREE.Matrix4().compose(
      this.currentPosition,
      this.currentQuaternion,
      new THREE.Vector3(1, 1, 1),
    );

    return {
      position: [
        Number(this.currentPosition.x.toFixed(3)),
        Number(this.currentPosition.y.toFixed(3)),
        Number(this.currentPosition.z.toFixed(3)),
      ],
      rotation: [
        Number(euler.x.toFixed(3)),
        Number(euler.y.toFixed(3)),
        Number(euler.z.toFixed(3)),
      ],
      quaternion: this.currentQuaternion.clone(),
      matrix: mat,
    };
  }

  public getReport(): TrackingReport {
    return {
      mode: this.mode,
      state: this.state,
      confidence: Number(this.confidence.toFixed(2)),
      pose: this.getSmoothedPose(),
      targetBounds: this.targetBounds,
      statusText: this.statusText,
      isWebXRActive: Boolean(this.xrSession),
      detectedMarkerId: this.detectedMarkerId,
    };
  }

  public resetPose() {
    this.currentPosition.set(0, 0, -1.5);
    this.targetPosition.set(0, 0, -1.5);
    this.currentQuaternion.identity();
    this.targetQuaternion.identity();
    this.confidence = 0;
    this.state = "lost";
    this.targetBounds = null;
    this.notify();
  }
}
