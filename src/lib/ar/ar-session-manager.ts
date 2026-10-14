import { CameraManager, type CameraStatus, type CameraDeviceInfo } from "./camera-manager";
import { TrackingManager, type TrackingReport } from "./tracking-manager";
import { TargetManager, type LockedTargetData } from "./target-manager";
import { ARSceneRenderer } from "./ar-scene-renderer";
import { PlacementController } from "./placement-controller";
import { download, type SceneObject, type TrackingMode } from "./projects";
import type { TrackabilityReport } from "./vision/target-analyzer";

export interface ARSessionState {
  cameraStatus: CameraStatus;
  cameraError: string;
  trackingReport: TrackingReport;
  targetCandidate: TrackabilityReport | null;
  lockedTarget: LockedTargetData | null;
  availableCameras: CameraDeviceInfo[];
  selectedCameraId: string;
  facingMode: "environment" | "user";
  isWebXRSupported: boolean;
}

export type ARSessionStateCallback = (state: ARSessionState) => void;

export class ARSessionManager {
  public readonly camera: CameraManager;
  public readonly tracking: TrackingManager;
  public readonly target: TargetManager;
  private renderer: ARSceneRenderer | null = null;

  private isRunning = false;
  private listeners: Set<ARSessionStateCallback> = new Set();
  private unsubs: (() => void)[] = [];

  constructor() {
    this.camera = new CameraManager();
    this.tracking = new TrackingManager();
    this.target = new TargetManager();

    // Listen to changes across managers
    this.unsubs.push(
      this.camera.subscribe(() => this.notifyState()),
      this.tracking.subscribe(() => this.notifyState()),
      this.target.subscribe(() => this.notifyState()),
    );
  }

  public subscribe(cb: ARSessionStateCallback): () => void {
    this.listeners.add(cb);
    cb(this.getState());
    return () => this.listeners.delete(cb);
  }

  public getState(): ARSessionState {
    return {
      cameraStatus: this.camera.getStatus(),
      cameraError: this.camera.getErrorMessage(),
      trackingReport: this.tracking.getReport(),
      targetCandidate: this.target.getCandidate(),
      lockedTarget: this.target.getLockedTarget(),
      availableCameras: this.camera.getAvailableCameras(),
      selectedCameraId: this.camera.getSelectedDeviceId(),
      facingMode: this.camera.getCurrentFacing(),
      isWebXRSupported: this.tracking.getWebXRSupported(),
    };
  }

  private notifyState() {
    const state = this.getState();
    for (const cb of this.listeners) {
      cb(state);
    }
  }

  /**
   * Initializes AR session with camera element and WebGL overlay container.
   */
  public async initSession(
    viewportContainer: HTMLElement,
    videoElement: HTMLVideoElement,
    initialObjects: SceneObject[] = [],
    selectedId = "",
  ): Promise<void> {
    this.camera.attachVideoElement(videoElement);

    if (this.renderer) {
      this.renderer.dispose();
    }
    this.renderer = new ARSceneRenderer(viewportContainer);
    await this.renderer.setObjects(initialObjects, selectedId);

    // Start render and tracking loop
    this.isRunning = true;
    this.renderer.start(() => {
      if (!this.isRunning) return;
      const vid = this.camera.getVideoElement();
      const locked = this.target.getLockedTarget();

      // Run real-time computer vision frame processing
      this.tracking.processFrame(vid, locked);

      // Sync 3D scene anchor with tracking pose
      const report = this.tracking.getReport();
      this.renderer?.updateTracking(report);
    });

    await this.camera.enumerateCameras();
    this.notifyState();
  }

  /**
   * Starts camera stream.
   */
  public async startCamera(deviceId?: string): Promise<void> {
    await this.camera.startCamera(deviceId);
    this.notifyState();
  }

  /**
   * Stops camera stream and tracking.
   */
  public stopCamera(): void {
    this.camera.stopCamera();
    this.tracking.resetPose();
    this.notifyState();
  }

  /**
   * Switches tracking mode.
   */
  public setTrackingMode(mode: TrackingMode): void {
    this.tracking.setMode(mode);
    this.notifyState();
  }

  /**
   * Scans the visual target in the center reticle.
   */
  public scanTarget(): TrackabilityReport | null {
    const vid = this.camera.getVideoElement();
    if (!vid || !vid.videoWidth) return null;
    const report = this.target.scanTarget(vid);
    this.notifyState();
    return report;
  }

  /**
   * Confirms and locks the scanned target.
   */
  public confirmTarget(label?: string): boolean {
    const vid = this.camera.getVideoElement();
    if (!vid) return false;
    const success = this.target.confirmCandidate(vid, label);
    if (success) {
      this.tracking.resetPose();
    }
    this.notifyState();
    return success;
  }

  /**
   * Unlocks the target.
   */
  public unlockTarget(): void {
    this.target.unlockTarget();
    this.tracking.resetPose();
    this.notifyState();
  }

  /**
   * Updates 3D scene objects inside the renderer.
   */
  public async updateObjects(objects: SceneObject[], selectedId = ""): Promise<void> {
    if (this.renderer) {
      await this.renderer.setObjects(objects, selectedId);
    }
  }

  /**
   * Resizes viewport renderer.
   */
  public handleResize(width?: number, height?: number): void {
    this.renderer?.resize(width, height);
  }

  /**
   * Captures a high-resolution composite screenshot of the camera + AR scene overlay.
   */
  public async captureScreenshot(projectName = "experience"): Promise<void> {
    const vid = this.camera.getVideoElement();
    const webglCanvas = this.renderer?.getCanvas();
    if (!vid || !webglCanvas) return;

    const width = vid.videoWidth || webglCanvas.width || 1280;
    const height = vid.videoHeight || webglCanvas.height || 720;

    const compositeCanvas = document.createElement("canvas");
    compositeCanvas.width = width;
    compositeCanvas.height = height;
    const ctx = compositeCanvas.getContext("2d");
    if (!ctx) return;

    // 1. Draw live camera frame
    ctx.drawImage(vid, 0, 0, width, height);

    // 2. Draw 3D WebGL scene overlay
    ctx.drawImage(webglCanvas, 0, 0, width, height);

    // 3. Brand watermark
    ctx.fillStyle = "rgba(25, 25, 30, 0.7)";
    ctx.roundRect(24, height - 56, 170, 32, 6);
    ctx.fill();
    ctx.font = 'bold 12px "Manrope", sans-serif';
    ctx.fillStyle = "#ffffff";
    ctx.fillText("ADDIS AR · CREATIVE", 36, height - 36);

    const blob = await new Promise<Blob | null>((resolve) =>
      compositeCanvas.toBlob(resolve, "image/png"),
    );

    if (blob) {
      download(blob, `${projectName.replace(/\s+/g, "-").toLowerCase()}-ar-capture.png`);
    }
  }

  /**
   * Disposes session, stops hardware camera tracks and releases WebGL resources.
   */
  public dispose(): void {
    this.isRunning = false;
    this.camera.stopCamera();
    this.renderer?.dispose();
    this.renderer = null;

    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];
    this.listeners.clear();
  }
}
