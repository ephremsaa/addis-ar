import React, { useRef, useState, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ModelCleanupOptions } from '@/lib/scanner/types';
import { optimizeMesh } from '@/lib/scanner/mesh-optimizer';
import { download } from '@/lib/ar/projects';

interface ModelViewer3DProps {
  initialGeometry: THREE.BufferGeometry;
  textureCanvas?: HTMLCanvasElement;
  onOpenInEditor?: (glbBlob: Blob, glbDataUrl: string) => void;
  onOpenInAR?: (glbBlob: Blob, glbDataUrl: string) => void;
}

export function ModelViewer3D({
  initialGeometry,
  textureCanvas,
  onOpenInEditor,
  onOpenInAR,
}: ModelViewer3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);

  const [renderMode, setRenderMode] = useState<'textured' | 'wireframe' | 'matcap'>('textured');
  const [cleanupOptions, setCleanupOptions] = useState<ModelCleanupOptions>({
    center: true,
    origin: 'bottom',
    scale: 1.0,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    removeDisconnectedDebris: true,
    decimationRatio: 1.0,
  });

  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [stats, setStats] = useState({
    vertices: 0,
    triangles: 0,
    dimensions: '0 × 0 × 0',
  });

  // Setup Three.js WebGL scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0a0812');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 50);
    camera.position.set(2.5, 1.8, 3.2);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    rendererRef.current = renderer;

    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0.5, 0);
    controlsRef.current = controls;

    // Lighting
    const ambientLight = new THREE.AmbientLight('#ffffff', 1.2);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight('#ffffff', 2.0);
    dirLight1.position.set(4, 8, 4);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight('#9333ea', 1.0);
    dirLight2.position.set(-4, -2, -4);
    scene.add(dirLight2);

    // Subtle ground grid
    const grid = new THREE.GridHelper(10, 20, '#6b21a8', '#27272a');
    grid.position.y = -0.01;
    scene.add(grid);

    // Animation render loop
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
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

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
    if (renderMode === 'textured' && textureCanvas) {
      const tex = new THREE.CanvasTexture(textureCanvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;
      material = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.6,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });
    } else if (renderMode === 'wireframe') {
      material = new THREE.MeshBasicMaterial({
        color: '#a855f7',
        wireframe: true,
      });
    } else {
      // Normal / Matcap inspection
      material = new THREE.MeshNormalMaterial({
        side: THREE.DoubleSide,
      });
    }

    const newMesh = new THREE.Mesh(optimized, material);
    newMesh.name = 'ScannedObject';
    scene.add(newMesh);
    meshRef.current = newMesh;

    // Update stats
    const pos = optimized.getAttribute('position');
    const vertCount = pos ? pos.count : 0;
    const triCount = Math.floor(vertCount / 3);

    optimized.computeBoundingBox();
    const box = optimized.boundingBox!;
    const size = new THREE.Vector3();
    box.getSize(size);

    setStats({
      vertices: vertCount,
      triangles: triCount,
      dimensions: `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m`,
    });
  }, [initialGeometry, cleanupOptions, renderMode, textureCanvas]);

  // View Presets
  const setCameraView = (type: 'front' | 'top' | 'side' | 'iso') => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    switch (type) {
      case 'front':
        camera.position.set(0, 0.5, 3.2);
        break;
      case 'top':
        camera.position.set(0, 3.8, 0.01);
        break;
      case 'side':
        camera.position.set(3.2, 0.5, 0);
        break;
      case 'iso':
        camera.position.set(2.4, 1.8, 2.6);
        break;
    }
    controls.target.set(0, 0.4, 0);
    controls.update();
  };

  // Generate binary GLB from current configured mesh with glTF 2.0 validation
  const generateCurrentGLB = async (): Promise<{ blob: Blob; dataUrl: string }> => {
    if (!meshRef.current) throw new Error('No mesh available to export');

    const scene = new THREE.Scene();
    scene.add(meshRef.current.clone());

    const exporter = new GLTFExporter();
    const buffer = await exporter.parseAsync(scene, { binary: true });

    if (!(buffer instanceof ArrayBuffer)) {
      throw new Error('GLB export failed: Exporter did not return binary data.');
    }

    // Validate glTF 2.0 binary magic header ("glTF" -> 0x46546C67)
    const headerView = new DataView(buffer);
    if (headerView.byteLength < 12 || headerView.getUint32(0, true) !== 0x46546c67) {
      throw new Error('GLB export validation failed: Corrupted glTF 2.0 binary container.');
    }

    const blob = new Blob([buffer], { type: 'model/gltf-binary' });
    const dataUrl = URL.createObjectURL(blob);
    return { blob, dataUrl };
  };

  const handleDownload = async () => {
    setIsExporting(true);
    try {
      const { blob } = await generateCurrentGLB();
      download(blob, 'scanned-object.glb');
    } catch (err) {
      console.error('Download error:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleEditorClick = async () => {
    setIsExporting(true);
    try {
      const { blob, dataUrl } = await generateCurrentGLB();
      onOpenInEditor?.(blob, dataUrl);
    } catch (err) {
      console.error('Editor transfer error:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleARClick = async () => {
    setIsExporting(true);
    try {
      const { blob, dataUrl } = await generateCurrentGLB();
      onOpenInAR?.(blob, dataUrl);
    } catch (err) {
      console.error('AR transfer error:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row w-full h-full min-h-[580px] bg-background rounded-2xl overflow-hidden border border-border/60">
      {/* 3D Viewport Area */}
      <div className="relative flex-1 min-h-[420px] bg-neutral-950">
        <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

        {/* View presets floating toolbar */}
        <div className="absolute top-4 left-4 flex items-center gap-1 bg-card/80 backdrop-blur-md p-1.5 rounded-xl border border-border/50 text-xs">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setCameraView('iso')}
          >
            Iso
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setCameraView('front')}
          >
            Front
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setCameraView('side')}
          >
            Side
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setCameraView('top')}
          >
            Top
          </Button>
        </div>

        {/* Display modes floating toolbar */}
        <div className="absolute top-4 right-4 flex items-center gap-1 bg-card/80 backdrop-blur-md p-1.5 rounded-xl border border-border/50 text-xs">
          <Button
            size="sm"
            variant={renderMode === 'textured' ? 'default' : 'ghost'}
            className="h-7 text-xs gap-1"
            onClick={() => setRenderMode('textured')}
          >
            <Sparkles className="w-3 h-3 text-amber-400" /> Textured
          </Button>
          <Button
            size="sm"
            variant={renderMode === 'matcap' ? 'default' : 'ghost'}
            className="h-7 text-xs gap-1"
            onClick={() => setRenderMode('matcap')}
          >
            <Eye className="w-3 h-3" /> Normals
          </Button>
          <Button
            size="sm"
            variant={renderMode === 'wireframe' ? 'default' : 'ghost'}
            className="h-7 text-xs gap-1"
            onClick={() => setRenderMode('wireframe')}
          >
            <Layers className="w-3 h-3" /> Wireframe
          </Button>
        </div>

        {/* Model stats badge */}
        <div className="absolute bottom-4 left-4 bg-card/80 backdrop-blur-md px-3 py-2 rounded-xl border border-border/50 text-[11px] font-mono text-muted-foreground flex items-center gap-3">
          <span>{stats.triangles.toLocaleString()} faces</span>
          <span>·</span>
          <span>{stats.vertices.toLocaleString()} vertices</span>
          <span>·</span>
          <span>{stats.dimensions}</span>
        </div>
      </div>

      {/* Right Sidebar: Cleanup, Optimization & Export */}
      <div className="w-full lg:w-80 bg-card border-t lg:border-t-0 lg:border-l border-border p-5 flex flex-col justify-between overflow-y-auto">
        <div className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Sliders className="w-4 h-4 text-primary" />
              Model Cleanup & Controls
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Refine geometry before export or importing to Addis AR.
            </p>
          </div>

          {/* Model Origin */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Model Origin</label>
            <div className="grid grid-cols-3 gap-1 bg-background/60 p-1 rounded-lg border border-border/40">
              {(['bottom', 'center', 'top'] as const).map((o) => (
                <Button
                  key={o}
                  size="sm"
                  variant={cleanupOptions.origin === o ? 'secondary' : 'ghost'}
                  className="h-7 text-xs capitalize"
                  onClick={() => setCleanupOptions((s) => ({ ...s, origin: o }))}
                >
                  {o}
                </Button>
              ))}
            </div>
          </div>

          {/* Scale multiplier */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-foreground">Scale Multiplier</span>
              <span className="font-mono text-muted-foreground">
                {cleanupOptions.scale.toFixed(2)}x
              </span>
            </div>
            <input
              type="range"
              min="0.2"
              max="3.0"
              step="0.05"
              value={cleanupOptions.scale}
              onChange={(e) =>
                setCleanupOptions((s) => ({ ...s, scale: Number(e.target.value) }))
              }
              className="w-full accent-primary"
            />
          </div>

          {/* 90-degree axis rotation */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <RotateCw className="w-3.5 h-3.5 text-primary" />
              Rotate 90° Axis
            </label>
            <div className="grid grid-cols-3 gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() =>
                  setCleanupOptions((s) => ({
                    ...s,
                    rotationX: s.rotationX + Math.PI / 2,
                  }))
                }
              >
                X +90°
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() =>
                  setCleanupOptions((s) => ({
                    ...s,
                    rotationY: s.rotationY + Math.PI / 2,
                  }))
                }
              >
                Y +90°
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() =>
                  setCleanupOptions((s) => ({
                    ...s,
                    rotationZ: s.rotationZ + Math.PI / 2,
                  }))
                }
              >
                Z +90°
              </Button>
            </div>
          </div>

          {/* Floating Debris Filter */}
          <div className="flex items-center justify-between p-3 bg-muted/20 border border-border/40 rounded-xl">
            <div>
              <div className="text-xs font-medium text-foreground">
                Clean Floating Debris
              </div>
              <div className="text-[10px] text-muted-foreground">
                Filter out scan noise & floating fragments
              </div>
            </div>
            <input
              type="checkbox"
              checked={cleanupOptions.removeDisconnectedDebris}
              onChange={(e) =>
                setCleanupOptions((s) => ({
                  ...s,
                  removeDisconnectedDebris: e.target.checked,
                }))
              }
              className="w-4 h-4 accent-primary rounded"
            />
          </div>

          {/* Export Quality Levels: HIGH QUALITY, BALANCED, LIGHTWEIGHT */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Export Quality Level</label>
            <div className="grid grid-cols-3 gap-1 bg-background/60 p-1 rounded-lg border border-border/40">
              <Button
                size="sm"
                variant={cleanupOptions.decimationRatio >= 0.95 ? 'secondary' : 'ghost'}
                className="h-7 text-[10px] px-1"
                onClick={() => setCleanupOptions((s) => ({ ...s, decimationRatio: 1.0 }))}
                title="Preserve full geometric and texture detail"
              >
                High Quality
              </Button>
              <Button
                size="sm"
                variant={cleanupOptions.decimationRatio >= 0.65 && cleanupOptions.decimationRatio < 0.95 ? 'secondary' : 'ghost'}
                className="h-7 text-[10px] px-1"
                onClick={() => setCleanupOptions((s) => ({ ...s, decimationRatio: 0.75 }))}
                title="Optimized for typical real-time AR use"
              >
                Balanced
              </Button>
              <Button
                size="sm"
                variant={cleanupOptions.decimationRatio < 0.65 ? 'secondary' : 'ghost'}
                className="h-7 text-[10px] px-1"
                onClick={() => setCleanupOptions((s) => ({ ...s, decimationRatio: 0.4 }))}
                title="Reduced polygon and texture sizes for mobile performance"
              >
                Lightweight
              </Button>
            </div>
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
              min="0.2"
              max="1.0"
              step="0.05"
              value={cleanupOptions.decimationRatio}
              onChange={(e) =>
                setCleanupOptions((s) => ({
                  ...s,
                  decimationRatio: Number(e.target.value),
                }))
              }
              className="w-full accent-primary"
            />
            <p className="text-[10px] text-muted-foreground">
              Adjust mesh density while preserving original high-quality scan data.
            </p>
          </div>
        </div>

        {/* Bottom Actions: GLB Download and Addis AR Integration */}
        <div className="space-y-2 mt-6 pt-4 border-t border-border">
          <Button
            className="w-full gap-2 font-semibold bg-primary text-primary-foreground"
            onClick={handleDownload}
            disabled={isExporting}
          >
            <Download className="w-4 h-4" />
            Download GLB (.glb)
          </Button>

          {onOpenInEditor && (
            <Button
              variant="secondary"
              className="w-full gap-2 font-semibold"
              onClick={handleEditorClick}
              disabled={isExporting}
            >
              <FolderPlus className="w-4 h-4 text-primary" />
              Open in Addis AR Editor
            </Button>
          )}

          {onOpenInAR && (
            <Button
              variant="outline"
              className="w-full gap-2 font-semibold"
              onClick={handleARClick}
              disabled={isExporting}
            >
              <Camera className="w-4 h-4 text-emerald-400" />
              View in AR Camera
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
