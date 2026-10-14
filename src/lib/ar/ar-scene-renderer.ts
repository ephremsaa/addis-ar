import * as THREE from "three";
import { buildObject } from "./scene";
import type { SceneObject } from "./projects";
import type { TrackingReport } from "./tracking-manager";

export class ARSceneRenderer {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private targetAnchor: THREE.Group;
  private objectGroups: Map<string, THREE.Object3D> = new Map();
  private reticleMesh: THREE.Mesh | null = null;
  private targetRingMesh: THREE.Mesh | null = null;
  private shadowPlane: THREE.Mesh | null = null;

  private isRunning = false;
  private animFrameId: number | null = null;
  private width = 640;
  private height = 480;

  // Cached objects list
  private currentObjects: SceneObject[] = [];
  private selectedObjectId = "";

  constructor(container: HTMLElement) {
    this.container = container;
    this.canvas = document.createElement("canvas");
    this.canvas.style.position = "absolute";
    this.canvas.style.top = "0";
    this.canvas.style.left = "0";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.pointerEvents = "none";
    this.canvas.style.zIndex = "2";
    this.container.appendChild(this.canvas);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 100);
    this.camera.position.set(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 1.2);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
    dirLight.position.set(2, 5, 3);
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x9682ed, 0.6);
    fillLight.position.set(-3, -1, -2);
    this.scene.add(fillLight);

    // Target anchor group (all AR objects live inside here)
    this.targetAnchor = new THREE.Group();
    this.scene.add(this.targetAnchor);

    // Add subtle visual target indicator ring
    this.createTargetVisuals();

    this.resize();
  }

  private createTargetVisuals() {
    // Ground shadow catcher plane
    const planeGeo = new THREE.PlaneGeometry(5, 5);
    const planeMat = new THREE.ShadowMaterial({ opacity: 0.3 });
    this.shadowPlane = new THREE.Mesh(planeGeo, planeMat);
    this.shadowPlane.rotation.x = -Math.PI / 2;
    this.shadowPlane.position.y = -0.01;
    this.targetAnchor.add(this.shadowPlane);

    // Target alignment ring
    const ringGeo = new THREE.RingGeometry(0.18, 0.22, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x9682ed,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75,
    });
    this.targetRingMesh = new THREE.Mesh(ringGeo, ringMat);
    this.targetRingMesh.rotation.x = -Math.PI / 2;
    this.targetAnchor.add(this.targetRingMesh);
  }

  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  public getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  public resize(width?: number, height?: number) {
    this.width = width || this.container.clientWidth || 640;
    this.height = height || this.container.clientHeight || 480;

    if (this.width > 0 && this.height > 0) {
      this.camera.aspect = this.width / this.height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.width, this.height, false);
    }
  }

  /**
   * Updates the 3D scene objects with project data.
   */
  public async setObjects(objects: SceneObject[], selectedId = ""): Promise<void> {
    this.currentObjects = objects;
    this.selectedObjectId = selectedId;

    const currentIds = new Set(objects.map((o) => o.id));

    // Remove objects that no longer exist
    for (const [id, mesh] of this.objectGroups.entries()) {
      if (!currentIds.has(id)) {
        this.targetAnchor.remove(mesh);
        this.disposeMesh(mesh);
        this.objectGroups.delete(id);
      }
    }

    // Add or update objects
    for (const obj of objects) {
      let existing = this.objectGroups.get(obj.id);
      if (!existing) {
        try {
          existing = await buildObject(obj);
          this.objectGroups.set(obj.id, existing);
          this.targetAnchor.add(existing);
        } catch (e) {
          console.error("Failed to build AR object:", e);
          continue;
        }
      }

      // Update transforms & visibility
      existing.position.fromArray(obj.position);
      existing.rotation.set(...obj.rotation);
      existing.scale.fromArray(obj.scale);
      existing.visible = obj.visible;
    }
  }

  /**
   * Synchronizes the target anchor pose with the tracking report.
   */
  public updateTracking(report: TrackingReport) {
    if (report.state === "lost") {
      // Fade or hide target visuals when lost
      if (this.targetRingMesh) {
        (this.targetRingMesh.material as THREE.MeshBasicMaterial).opacity = 0.15;
      }
      this.targetAnchor.visible = false;
    } else {
      this.targetAnchor.visible = true;

      // Update target anchor transform from smoothed pose
      this.targetAnchor.position.fromArray(report.pose.position);
      this.targetAnchor.quaternion.copy(report.pose.quaternion);

      // Ring pulse color based on tracking quality
      if (this.targetRingMesh) {
        const mat = this.targetRingMesh.material as THREE.MeshBasicMaterial;
        mat.opacity = report.state === "reliable" ? 0.85 : 0.45;
        mat.color.setHex(report.state === "reliable" ? 0x84cba1 : 0xeaaf71);
      }
    }
  }

  /**
   * Starts the animation/render loop.
   */
  public start(onFrame?: () => void) {
    if (this.isRunning) return;
    this.isRunning = true;

    const render = () => {
      if (!this.isRunning) return;
      if (onFrame) onFrame();

      // Gentle spin of the target ring indicator
      if (this.targetRingMesh) {
        this.targetRingMesh.rotation.z += 0.01;
      }

      this.renderer.render(this.scene, this.camera);
      this.animFrameId = requestAnimationFrame(render);
    };

    this.animFrameId = requestAnimationFrame(render);
  }

  /**
   * Stops the render loop.
   */
  public stop() {
    this.isRunning = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  private disposeMesh(obj: THREE.Object3D) {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else if (child.material) {
          child.material.dispose();
        }
      }
    });
  }

  /**
   * Cleans up all Three.js WebGL and DOM resources.
   */
  public dispose() {
    this.stop();

    for (const mesh of this.objectGroups.values()) {
      this.disposeMesh(mesh);
    }
    this.objectGroups.clear();

    if (this.shadowPlane) {
      this.disposeMesh(this.shadowPlane);
    }
    if (this.targetRingMesh) {
      this.disposeMesh(this.targetRingMesh);
    }

    this.renderer.dispose();
    if (this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
  }
}
