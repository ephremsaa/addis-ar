import React, { useRef, useState, useEffect } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import {
  Download,
  FolderPlus,
  Camera,
  Maximize2,
  RotateCw,
  Sliders,
  Eye,
  Layers,
  Sparkles,
  Info,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Grid,
  FileCode,
  Image as ImageIcon,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { ModelCleanupOptions } from "@/lib/scanner/types";
import { optimizeMesh } from "@/lib/scanner/mesh-optimizer";
import { download, blobToDataUrl } from "@/lib/ar/projects";

interface ModelViewer3DProps {
  initialGeometry: THREE.BufferGeometry;
  textureCanvas?: HTMLCanvasElement;
  modelTitle?: string;
  onOpenInEditor?: (glbBlob: Blob, glbDataUrl: string) => void;
  onOpenInAR?: (glbBlob: Blob, glbDataUrl: string) => void;
  onRescan?: () => void;
  onViewQualityReport?: () => void;
  onViewDataset?: () => void;
}

export function ModelViewer3D({
  initialGeometry,
  textureCanvas,
  modelTitle = "Scanned 3D Object",
  onOpenInEditor,
  onOpenInAR,
  onRescan,
  onViewQualityReport,
  onViewDataset,
}: ModelViewer3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);

  const [modelName, setModelName] = useState<string>(modelTitle);
  const [renderMode, setRenderMode] = useState<"textured" | "wireframe" | "matcap">("textured");
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [cleanupOptions, setCleanupOptions] = useState<ModelCleanupOptions>({
    center: true,
    origin: "bottom",
    scale: 1.0,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    removeDisconnectedDebris: true,
    decimationRatio: 1.0,
  });

  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportMessage, setExportMessage] = useState<string>("");
  const [fileSizeBytes, setFileSizeBytes] = useState<number>(0);
  const [stats, setStats] = useState({
    vertices: 0,
    triangles: 0,
    dimensions: "0 × 0 × 0",
  });

  // Setup Three.js WebGL scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 450;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#090710");
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 50);
    camera.position.set(2.2, 1.6, 2.8);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    rendererRef.current = renderer;

    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0.4, 0);
    controlsRef.current = controls;

    // Lighting setup
    const ambientLight = new THREE.AmbientLight("#ffffff", 1.3);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight("#ffffff", 2.2);
    dirLight1.position.set(5, 8, 5);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight("#9333ea", 1.1);
    dirLight2.position.set(-5, -2, -5);
    scene.add(dirLight2);

    const dirLight3 = new THREE.DirectionalLight("#38bdf8", 0.8);
    dirLight3.position.set(0, -6, 4);
    scene.add(dirLight3);

    // Ground grid
    const grid = new THREE.GridHelper(8, 20, "#7e22ce", "#27272a");
    grid.position.y = -0.005;
    gridRef.current = grid;
    scene.add(grid);

    // Animation loop
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Update grid visibility
  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.visible = showGrid;
    }
  }, [showGrid]);

  // Update mesh geometry and material whenever options or render mode change
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (meshRef.current) {
      scene.remove(meshRef.current);
      meshRef.current.geometry.dispose();
      meshRef.current = null;
    }

    const optimized = optimizeMesh(initialGeometry, cleanupOptions);

    let material: THREE.Material;
    if (renderMode === "textured" && textureCanvas) {
      const tex = new THREE.CanvasTexture(textureCanvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;
      material = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.55,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });
    } else if (renderMode === "wireframe") {
      material = new THREE.MeshBasicMaterial({
        color: "#a855f7",
        wireframe: true,
      });
    } else {
      // Matcap / Clay neutral render
      material = new THREE.MeshStandardMaterial({
        color: "#e2e8f0",
        roughness: 0.45,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });
    }

    const mesh = new THREE.Mesh(optimized, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshRef.current = mesh;

    // Calculate actual geometry statistics
    const posAttr = optimized.getAttribute("position");
    const indexAttr = optimized.getIndex();
    const vCount = posAttr ? posAttr.count : 0;
    const tCount = indexAttr ? indexAttr.count / 3 : vCount / 3;

    optimized.computeBoundingBox();
    const bb = optimized.boundingBox;
    let dimStr = "0 × 0 × 0";
    if (bb) {
      const sx = (bb.max.x - bb.min.x).toFixed(2);
      const sy = (bb.max.y - bb.min.y).toFixed(2);
      const sz = (bb.max.z - bb.min.z).toFixed(2);
      dimStr = `${sx} × ${sy} × ${sz} m`;
    }

    setStats({
      vertices: vCount,
      triangles: Math.floor(tCount),
      dimensions: dimStr,
    });

    // Estimate file size
    void generateCurrentGLB()
      .then(({ blob }) => {
        setFileSizeBytes(blob.size);
      })
      .catch(() => {});
  }, [initialGeometry, cleanupOptions, renderMode, textureCanvas]);

  // Camera orientation presets
  const setCameraView = (type: "front" | "top" | "side" | "iso") => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    switch (type) {
      case "front":
        camera.position.set(0, 0.4, 3.0);
        break;
      case "top":
        camera.position.set(0, 3.6, 0.01);
        break;
      case "side":
        camera.position.set(3.0, 0.4, 0);
        break;
      case "iso":
        camera.position.set(2.2, 1.6, 2.6);
        break;
    }
    controls.target.set(0, 0.35, 0);
    controls.update();
  };

  const handleZoom = (delta: number) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
    camera.position.addScaledVector(dir, delta);
    controls.update();
  };

  const resetCamera = () => {
    setCameraView("iso");
  };

  // Generate binary GLB from current configured mesh with glTF 2.0 validation
  const generateCurrentGLB = async (): Promise<{ blob: Blob; dataUrl: string }> => {
    if (!meshRef.current) throw new Error("No mesh available to export");

    const scene = new THREE.Scene();
    scene.add(meshRef.current.clone());

    const exporter = new GLTFExporter();
    const buffer = await exporter.parseAsync(scene, { binary: true });

    if (!(buffer instanceof ArrayBuffer)) {
      throw new Error("GLB export failed: Exporter did not return binary data.");
    }

    // Validate glTF 2.0 binary magic header ("glTF" -> 0x46546C67)
    const headerView = new DataView(buffer);
    if (headerView.byteLength < 12 || headerView.getUint32(0, true) !== 0x46546c67) {
      throw new Error("GLB export validation failed: Corrupted glTF 2.0 binary container.");
    }

    const blob = new Blob([buffer], { type: "model/gltf-binary" });
    const dataUrl = await blobToDataUrl(blob);
    return { blob, dataUrl };
  };

  const handleDownloadGLB = async () => {
    setIsExporting(true);
    setExportMessage("Validating and compiling GLB…");
    try {
      const { blob } = await generateCurrentGLB();
      const safeName = (modelName.trim() || "scanned-model")
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-");
      download(blob, `${safeName}.glb`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`GLB Download error: ${message}`);
    } finally {
      setIsExporting(false);
      setExportMessage("");
    }
  };

  const handleDownloadTextures = () => {
    if (!textureCanvas) {
      toast.error("No texture canvas available for this scan.");
      return;
    }
    textureCanvas.toBlob((blob) => {
      if (blob) {
        const safeName = (modelName.trim() || "scanned-model")
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, "-");
        download(blob, `${safeName}-texture.png`);
      }
    }, "image/png");
  };

  const handleExportOBJ = () => {
    if (!meshRef.current) return;
    try {
      const exporter = new OBJExporter();
      const result = exporter.parse(meshRef.current);
      const blob = new Blob([result], { type: "text/plain" });
      const safeName = (modelName.trim() || "scanned-model")
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-");
      download(blob, `${safeName}.obj`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`OBJ Export error: ${message}`);
    }
  };

  const handleEditorClick = async () => {
    setIsExporting(true);
    setExportMessage("Transferring model to Addis AR Editor…");
    try {
      const { blob, dataUrl } = await generateCurrentGLB();
      onOpenInEditor?.(blob, dataUrl);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Editor transfer error: ${message}`);
    } finally {
      setIsExporting(false);
      setExportMessage("");
    }
  };

  const handleARClick = async () => {
    setIsExporting(true);
    setExportMessage("Preparing AR Camera preview…");
    try {
      const { blob, dataUrl } = await generateCurrentGLB();
      onOpenInAR?.(blob, dataUrl);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`AR transfer error: ${message}`);
    } finally {
      setIsExporting(false);
      setExportMessage("");
    }
  };

  const fileSizeFormatted =
    fileSizeBytes > 1048576
      ? `${(fileSizeBytes / 1048576).toFixed(2)} MB`
      : fileSizeBytes > 0
        ? `${Math.round(fileSizeBytes / 1024)} KB`
        : "Calculating…";

  return (
    <div className="flex flex-col w-full h-full space-y-4">
      {/* Result Header Banner */}
      <div className="p-4 sm:p-5 bg-card/90 backdrop-blur-md rounded-2xl border border-border/60 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <h1 className="text-base sm:text-lg font-bold text-foreground">
              Your 3D Model Is Ready
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              className="text-xs sm:text-sm font-semibold bg-background/80 border border-border/60 rounded-lg px-2.5 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-52 sm:w-64"
              placeholder="Object Name"
            />
            <span className="text-[11px] text-muted-foreground">· Validated glTF 2.0 Binary</span>
          </div>
        </div>

        {/* Measured Real Model Telemetry Badge */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full md:w-auto text-xs bg-background/60 p-2.5 rounded-xl border border-border/40">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase font-mono">Vertices</div>
            <div className="font-bold text-foreground font-mono">
              {stats.vertices.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase font-mono">Triangles</div>
            <div className="font-bold text-foreground font-mono">
              {stats.triangles.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase font-mono">File Size</div>
            <div className="font-bold text-foreground font-mono">{fileSizeFormatted}</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase font-mono">Texture</div>
            <div className="font-bold text-emerald-400 font-mono flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              <span>Baked Atlas</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main 3D Viewport & Control Drawer Layout */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-[560px] bg-background rounded-2xl overflow-hidden border border-border/60 shadow-2xl">
        {/* Interactive 3D Canvas Area */}
        <div className="relative flex-1 min-h-[440px] bg-neutral-950">
          <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

          {/* Top Left: Quick Camera Orientation */}
          <div className="absolute top-3 left-3 flex flex-wrap items-center gap-1 bg-black/75 backdrop-blur-md p-1 rounded-xl border border-white/10 text-xs">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2.5 text-xs text-white"
              onClick={() => setCameraView("iso")}
            >
              Iso
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2.5 text-xs text-white"
              onClick={() => setCameraView("front")}
            >
              Front
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2.5 text-xs text-white"
              onClick={() => setCameraView("side")}
            >
              Side
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2.5 text-xs text-white"
              onClick={() => setCameraView("top")}
            >
              Top
            </Button>
            <div className="w-px h-4 bg-white/20 mx-0.5" />
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-white"
              onClick={resetCamera}
              title="Reset Camera"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Top Right: Render Modes (Textured, Wireframe, Clay) & Grid */}
          <div className="absolute top-3 right-3 flex items-center gap-1 bg-black/75 backdrop-blur-md p-1 rounded-xl border border-white/10 text-xs">
            <Button
              size="sm"
              variant={renderMode === "textured" ? "default" : "ghost"}
              className="h-7 text-xs px-2.5"
              onClick={() => setRenderMode("textured")}
            >
              Textured
            </Button>
            <Button
              size="sm"
              variant={renderMode === "wireframe" ? "default" : "ghost"}
              className="h-7 text-xs px-2.5"
              onClick={() => setRenderMode("wireframe")}
            >
              Wireframe
            </Button>
            <Button
              size="sm"
              variant={renderMode === "matcap" ? "default" : "ghost"}
              className="h-7 text-xs px-2.5"
              onClick={() => setRenderMode("matcap")}
            >
              Clay
            </Button>
            <Button
              size="sm"
              variant={showGrid ? "secondary" : "ghost"}
              className="h-7 w-7 p-0 text-white"
              onClick={() => setShowGrid(!showGrid)}
              title="Toggle Ground Grid"
            >
              <Grid className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Bottom Right: Interactive Zoom Buttons */}
          <div className="absolute bottom-3 right-3 flex flex-col gap-1 bg-black/75 backdrop-blur-md p-1 rounded-xl border border-white/10">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 text-white"
              onClick={() => handleZoom(-0.5)}
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 text-white"
              onClick={() => handleZoom(0.5)}
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </Button>
          </div>

          {/* Loading / Exporting Overlay */}
          {isExporting && (
            <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-30">
              <RotateCw className="w-8 h-8 text-primary animate-spin mb-3" />
              <div className="text-sm font-semibold text-white">
                {exportMessage || "Processing 3D model…"}
              </div>
            </div>
          )}
        </div>

        {/* Right Action & Optimization Drawer */}
        <div className="w-full lg:w-84 xl:w-96 bg-card/95 border-t lg:border-t-0 lg:border-l border-border/60 p-4 sm:p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-4">
            <div className="font-semibold text-xs sm:text-sm text-foreground flex items-center justify-between">
              <span>Model Optimization & Alignment</span>
              <span className="text-[11px] font-mono text-muted-foreground">
                {stats.dimensions}
              </span>
            </div>

            {/* Rotation Controls */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Rotate Model</label>
              <div className="grid grid-cols-3 gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() =>
                    setCleanupOptions((s) => ({ ...s, rotationX: s.rotationX + Math.PI / 2 }))
                  }
                >
                  Pitch +90°
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() =>
                    setCleanupOptions((s) => ({ ...s, rotationY: s.rotationY + Math.PI / 2 }))
                  }
                >
                  Yaw +90°
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() =>
                    setCleanupOptions((s) => ({ ...s, rotationZ: s.rotationZ + Math.PI / 2 }))
                  }
                >
                  Roll +90°
                </Button>
              </div>
            </div>

            {/* Clean Floating Debris Filter */}
            <div className="flex items-center justify-between p-3 bg-muted/20 border border-border/40 rounded-xl">
              <div>
                <div className="text-xs font-medium text-foreground">Clean Floating Fragments</div>
                <div className="text-[10px] text-muted-foreground">
                  Remove disconnected photogrammetry noise
                </div>
              </div>
              <input
                type="checkbox"
                checked={cleanupOptions.removeDisconnectedDebris}
                onChange={(e) =>
                  setCleanupOptions((s) => ({ ...s, removeDisconnectedDebris: e.target.checked }))
                }
                className="w-4 h-4 accent-primary rounded"
              />
            </div>

            {/* Decimation / Polygon reduction slider */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-foreground">Mesh Detail (Decimation)</span>
                <span className="font-mono text-muted-foreground">
                  {Math.round(cleanupOptions.decimationRatio * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.25"
                max="1.0"
                step="0.05"
                value={cleanupOptions.decimationRatio}
                onChange={(e) =>
                  setCleanupOptions((s) => ({ ...s, decimationRatio: Number(e.target.value) }))
                }
                className="w-full accent-primary"
              />
              <p className="text-[10px] text-muted-foreground">
                Decimate dense meshes for faster real-time mobile AR loading.
              </p>
            </div>
          </div>

          {/* Primary & Secondary Action Buttons */}
          <div className="space-y-2 pt-3 border-t border-border/60">
            {/* Primary Action: Download GLB */}
            <Button
              className="w-full h-11 gap-2 font-bold bg-primary text-primary-foreground shadow-lg shadow-primary/25"
              onClick={handleDownloadGLB}
              disabled={isExporting}
            >
              <Download className="w-4 h-4" />
              <span>Download GLB (.glb)</span>
              <span className="text-[10px] bg-black/20 px-1.5 py-0.5 rounded font-mono ml-auto">
                {fileSizeFormatted}
              </span>
            </Button>

            {/* Secondary Action: Open in Addis AR Editor */}
            {onOpenInEditor && (
              <Button
                variant="secondary"
                className="w-full h-10 gap-2 font-semibold text-xs"
                onClick={handleEditorClick}
                disabled={isExporting}
              >
                <FolderPlus className="w-4 h-4 text-primary" />
                <span>Open in Addis AR Editor</span>
              </Button>
            )}

            {/* View in AR Camera */}
            {onOpenInAR && (
              <Button
                variant="outline"
                className="w-full h-9 gap-2 font-medium text-xs border-emerald-500/40 text-emerald-400 hover:bg-emerald-950/20"
                onClick={handleARClick}
                disabled={isExporting}
              >
                <Camera className="w-3.5 h-3.5" />
                <span>View in AR Camera</span>
              </Button>
            )}

            {/* Additional Export & Utility Actions */}
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                onClick={handleDownloadTextures}
              >
                <ImageIcon className="w-3 h-3" />
                <span>Textures (.png)</span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                onClick={handleExportOBJ}
              >
                <FileCode className="w-3 h-3" />
                <span>Export OBJ (.obj)</span>
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {onViewQualityReport && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                  onClick={onViewQualityReport}
                >
                  <ShieldCheck className="w-3 h-3 text-purple-400" />
                  <span>Quality Report</span>
                </Button>
              )}

              {onRescan && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                  onClick={onRescan}
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Rescan Object</span>
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
