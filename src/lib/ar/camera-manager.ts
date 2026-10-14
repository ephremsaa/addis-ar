export type CameraStatus =
  "idle" | "requesting" | "running" | "denied" | "not-found" | "in-use" | "insecure" | "error";

export interface CameraDeviceInfo {
  deviceId: string;
  label: string;
  facingMode?: "environment" | "user" | undefined;
}

export type CameraEventCallback = (status: CameraStatus, error?: string) => void;

export class CameraManager {
  private stream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private status: CameraStatus = "idle";
  private errorMessage = "";
  private availableCameras: CameraDeviceInfo[] = [];
  private selectedDeviceId = "";
  private currentFacing: "environment" | "user" = "environment";
  private listeners: Set<CameraEventCallback> = new Set();

  constructor() {
    this.checkSecureContext();
  }

  public isSecureContext(): boolean {
    if (typeof window === "undefined") return false;
    const isLocal =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "[::1]";
    return Boolean(window.isSecureContext || isLocal);
  }

  private checkSecureContext(): boolean {
    if (!this.isSecureContext()) {
      this.status = "insecure";
      this.errorMessage =
        "Camera access requires a secure connection (HTTPS) or localhost. Please test on HTTPS or local development server.";
      return false;
    }
    return true;
  }

  public getStatus(): CameraStatus {
    return this.status;
  }

  public getErrorMessage(): string {
    return this.errorMessage;
  }

  public getStream(): MediaStream | null {
    return this.stream;
  }

  public getAvailableCameras(): CameraDeviceInfo[] {
    return this.availableCameras;
  }

  public getSelectedDeviceId(): string {
    return this.selectedDeviceId;
  }

  public getCurrentFacing(): "environment" | "user" {
    return this.currentFacing;
  }

  public getVideoElement(): HTMLVideoElement | null {
    return this.videoElement;
  }

  public subscribe(cb: CameraEventCallback): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(status: CameraStatus, error?: string) {
    this.status = status;
    this.errorMessage = error || "";
    for (const cb of this.listeners) {
      cb(status, error);
    }
  }

  /**
   * Enumerates connected video input devices without requesting permission.
   */
  public async enumerateCameras(): Promise<CameraDeviceInfo[]> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      return [];
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === "videoinput");

      this.availableCameras = videoInputs.map((d, index) => {
        let facing: "environment" | "user" | undefined;
        const lbl = d.label.toLowerCase();
        if (lbl.includes("back") || lbl.includes("rear") || lbl.includes("environment")) {
          facing = "environment";
        } else if (lbl.includes("front") || lbl.includes("user") || lbl.includes("selfie")) {
          facing = "user";
        }

        return {
          deviceId: d.deviceId,
          label: d.label || `Camera ${index + 1}`,
          facingMode: facing,
        };
      });

      return this.availableCameras;
    } catch {
      return [];
    }
  }

  /**
   * Starts camera stream with rear-camera preference on mobile devices.
   */
  public async startCamera(
    preferredDeviceId?: string,
    preferredFacing: "environment" | "user" = "environment",
  ): Promise<MediaStream> {
    if (!this.checkSecureContext()) {
      const err = this.errorMessage;
      this.notify("insecure", err);
      throw new Error(err);
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      const err = "MediaDevices API not supported on this device/browser.";
      this.notify("error", err);
      throw new Error(err);
    }

    // Stop existing stream if active
    this.stopCamera();

    this.notify("requesting");
    this.currentFacing = preferredFacing;

    const constraints: MediaStreamConstraints = {
      audio: false,
      video: preferredDeviceId
        ? {
            deviceId: { exact: preferredDeviceId },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          }
        : {
            facingMode: { ideal: preferredFacing },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.stream = stream;

      // Update active deviceId from video track
      const track = stream.getVideoTracks()[0];
      if (track) {
        const settings = track.getSettings();
        if (settings.deviceId) {
          this.selectedDeviceId = settings.deviceId;
        }
        if (settings.facingMode) {
          this.currentFacing = settings.facingMode as "environment" | "user";
        }

        // Handle track ended or muted
        track.onended = () => {
          this.notify("idle", "Camera disconnected.");
        };
      }

      // Re-enumerate to get labels now that permission is granted
      await this.enumerateCameras();

      // Attach to video element if bound
      if (this.videoElement) {
        this.videoElement.srcObject = stream;
        try {
          await this.videoElement.play();
        } catch {
          // autoplay restrictions
        }
      }

      this.notify("running");
      return stream;
    } catch (err: unknown) {
      const error = err as { name?: string; message?: string };
      let status: CameraStatus = "error";
      let message = "Unable to access camera.";

      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        status = "denied";
        message =
          "Camera permission was denied. Please allow camera access in your browser site permissions to use AR.";
      } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        status = "not-found";
        message = "No camera device found on this system.";
      } else if (error.name === "NotReadableError" || error.name === "TrackStartError") {
        status = "in-use";
        message = "Camera is already in use by another application or tab.";
      } else if (error.name === "OverconstrainedError") {
        // Fallback to minimal video constraint
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true });
          this.stream = fallbackStream;
          if (this.videoElement) {
            this.videoElement.srcObject = fallbackStream;
            await this.videoElement.play();
          }
          await this.enumerateCameras();
          this.notify("running");
          return fallbackStream;
        } catch {
          message = "Camera requested resolution or facing mode is unsupported.";
        }
      } else if (error.message) {
        message = error.message;
      }

      this.notify(status, message);
      throw new Error(message);
    }
  }

  /**
   * Attaches an HTMLVideoElement to the current stream.
   */
  public attachVideoElement(video: HTMLVideoElement) {
    this.videoElement = video;
    if (this.stream) {
      video.srcObject = this.stream;
      video.play().catch(() => {});
    }
  }

  /**
   * Switches to another camera device.
   */
  public async switchCamera(deviceId: string): Promise<MediaStream> {
    this.selectedDeviceId = deviceId;
    return this.startCamera(deviceId, this.currentFacing);
  }

  /**
   * Toggles between environment (rear) and user (front) camera.
   */
  public async toggleFacingMode(): Promise<MediaStream> {
    const nextFacing = this.currentFacing === "environment" ? "user" : "environment";
    return this.startCamera(undefined, nextFacing);
  }

  /**
   * Stops camera stream and releases hardware tracks immediately.
   */
  public stopCamera(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }

    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }

    if (this.status === "running" || this.status === "requesting") {
      this.notify("idle");
    }
  }

  /**
   * Captures a single image frame onto an offscreen canvas.
   */
  public captureFrame(): HTMLCanvasElement | null {
    if (!this.videoElement || !this.videoElement.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = this.videoElement.videoWidth;
    canvas.height = this.videoElement.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(this.videoElement, 0, 0);
    return canvas;
  }
}
