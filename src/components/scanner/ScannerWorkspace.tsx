import React, { useRef, useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Camera,
  RefreshCw,
  Zap,
  ZapOff,
  Upload,
  Trash2,
  Sliders,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  RotateCcw,
  Box,
  Layers,
  HelpCircle,
  X,
  Play,
  ShieldCheck,
  Server,
  ArrowLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  type ScanPhoto,
  type AngleGroup,
  type QualityPreset,
  type ReconstructionStageInfo,
  SCAN_STEPS,
} from '@/lib/scanner/types';
import { validateImageQuality } from '@/lib/scanner/image-validator';
import { segmentForeground } from '@/lib/scanner/background-segmenter';
import { reconstruct3DModel, type ReconstructionResult } from '@/lib/scanner/reconstruction-engine';
import { HemisphereDiagram } from './HemisphereDiagram';
import { MaskTouchupModal } from './MaskTouchupModal';
import { ModelViewer3D } from './ModelViewer3D';
import { newProject, newObject, saveProject, type Project } from '@/lib/ar/projects';

interface ScannerWorkspaceProps {
  onClose?: () => void;
  targetProject?: Project;
}

export function ScannerWorkspace({ onClose, targetProject }: ScannerWorkspaceProps) {
  const navigate = useNavigate();

  // Video & Camera state
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torchAvailable, setTorchAvailable] = useState<boolean>(false);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string>('');

  // Workflow State
  const [activeStepIndex, setActiveStepIndex] = useState<number>(0);
  const [photos, setPhotos] = useState<ScanPhoto[]>([]);
  const [inspectPhoto, setInspectPhoto] = useState<ScanPhoto | null>(null);
  const [lastWarning, setLastWarning] = useState<string>('');

  // Reconstruction State
  const [preset, setPreset] = useState<QualityPreset>('standard');
  const [reconstructionStage, setReconstructionStage] = useState<ReconstructionStageInfo>({
    stage: 'idle',
    progress: 0,
    message: '',
  });
  const [reconstructionResult, setReconstructionResult] = useState<ReconstructionResult | null>(null);

  // Settings & Modals
  const [showServerModal, setShowServerModal] = useState<boolean>(false);
  const [serverUrl, setServerUrl] = useState<string>('http://localhost:8000');
  const [showTips, setShowTips] = useState<boolean>(false);

  const currentStep = SCAN_STEPS[activeStepIndex] || SCAN_STEPS[0];

  // Initialize camera stream
  useEffect(() => {
    let alive = true;

    async function startCamera() {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }

      setCameraError('');

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });

        if (!alive) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        setCameraActive(true);

        // Check torch support
        const track = stream.getVideoTracks()[0];
        if (track && 'getCapabilities' in track) {
          const caps = (track as any).getCapabilities?.();
          setTorchAvailable(Boolean(caps?.torch));
        } else {
          setTorchAvailable(false);
        }
      } catch (err) {
        if (!alive) return;
        setCameraActive(false);
        setCameraError(
          'Unable to access camera. Please allow camera permissions or upload photos below.'
        );
      }
    }

    startCamera();

    return () => {
      alive = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [facingMode]);

  // Toggle torch / flashlight
  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;

    try {
      const nextTorch = !torchOn;
      await (track as any).applyConstraints({
        advanced: [{ torch: nextTorch }],
      });
      setTorchOn(nextTorch);
    } catch (err) {
      console.warn('Torch failed:', err);
    }
  };

  // Switch camera front/back
  const switchCamera = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  // Capture photo from live video feed
  const capturePhoto = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    // Haptic feedback
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(40);
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const fullDataUrl = canvas.toDataURL('image/jpeg', 0.92);

    // Create thumbnail
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 160;
    thumbCanvas.height = Math.round((canvas.height / canvas.width) * 160);
    const thumbCtx = thumbCanvas.getContext('2d')!;
    thumbCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
    const thumbnailUrl = thumbCanvas.toDataURL('image/jpeg', 0.75);

    // Validate quality
    const quality = await validateImageQuality(thumbCanvas);
    if (quality.warnings.length > 0) {
      setLastWarning(quality.warnings[0]);
    } else {
      setLastWarning('');
    }

    // Auto-segment foreground asynchronously
    const seg = await segmentForeground(thumbCanvas);

    const newPhoto: ScanPhoto = {
      id: crypto.randomUUID(),
      dataUrl: fullDataUrl,
      thumbnailUrl,
      timestamp: Date.now(),
      angleGroup: currentStep.group,
      azimuth: currentStep.azimuth,
      elevation: currentStep.elevation,
      maskDataUrl: seg.maskDataUrl,
      transparentDataUrl: seg.transparentDataUrl,
      isSegmented: true,
      quality,
    };

    setPhotos((prev) => [...prev, newPhoto]);

    // Advance to next angle step if not already at the end
    if (activeStepIndex < SCAN_STEPS.length - 1) {
      setActiveStepIndex((s) => s + 1);
    }
  };

  // Upload photos from desktop/file dialog
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newItems: ScanPhoto[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const dataUrl = await new Promise<string>((res) => {
        const reader = new FileReader();
        reader.onload = () => res(String(reader.result));
        reader.readAsDataURL(file);
      });

      const img = new Image();
      img.src = dataUrl;
      await new Promise((res) => {
        img.onload = res;
      });

      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = 160;
      thumbCanvas.height = Math.round((img.height / img.width) * 160);
      const thumbCtx = thumbCanvas.getContext('2d')!;
      thumbCtx.drawImage(img, 0, 0, thumbCanvas.width, thumbCanvas.height);
      const thumbnailUrl = thumbCanvas.toDataURL('image/jpeg', 0.75);

      const quality = await validateImageQuality(thumbCanvas);
      const seg = await segmentForeground(thumbCanvas);

      // Estimate angle by index distribution
      const stepIdx = (photos.length + i) % SCAN_STEPS.length;
      const step = SCAN_STEPS[stepIdx];

      newItems.push({
        id: crypto.randomUUID(),
        dataUrl,
        thumbnailUrl,
        timestamp: Date.now(),
        angleGroup: step.group,
        azimuth: step.azimuth,
        elevation: step.elevation,
        maskDataUrl: seg.maskDataUrl,
        transparentDataUrl: seg.transparentDataUrl,
        isSegmented: true,
        quality,
      });
    }

    setPhotos((prev) => [...prev, ...newItems]);
    e.target.value = '';
  };

  const deletePhoto = (id: string) => {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  };

  // Start 3D Reconstruction
  const startReconstruction = async () => {
    if (photos.length < 3) return;

    setReconstructionStage({
      stage: 'validating',
      progress: 5,
      message: 'Initializing multi-view reconstruction…',
    });

    try {
      const result = await reconstruct3DModel(
        photos,
        preset,
        undefined,
        (info) => {
          setReconstructionStage(info);
        }
      );

      setReconstructionResult(result);
    } catch (err: any) {
      setReconstructionStage({
        stage: 'failed',
        progress: 0,
        message: err?.message || 'Reconstruction failed. Please check photos and try again.',
      });
    }
  };

  // Open the newly scanned model in Addis AR Editor
  const handleOpenInEditor = async (glbBlob: Blob, glbDataUrl: string) => {
    try {
      let project = targetProject;
      if (!project) {
        project = newProject('Scanned Object Project');
      }

      const modelObject = newObject('model');
      modelObject.name = 'Scanned Object';
      modelObject.model = glbDataUrl;
      modelObject.position = [0, 0.5, 0];

      const updatedProject: Project = {
        ...project,
        updated: Date.now(),
        objects: [...project.objects, modelObject],
      };

      await saveProject(updatedProject);
      navigate({
        to: '/editor/$projectId',
        params: { projectId: updatedProject.id },
      });
    } catch (err) {
      console.error('Failed to import model into Addis AR editor:', err);
    }
  };

  // Open the newly scanned model in AR Camera mode
  const handleOpenInAR = async (glbBlob: Blob, glbDataUrl: string) => {
    try {
      let project = targetProject;
      if (!project) {
        project = newProject('Scanned AR Experience');
      }

      const modelObject = newObject('model');
      modelObject.name = 'Scanned Object';
      modelObject.model = glbDataUrl;
      modelObject.position = [0, 0, -1.2];

      const updatedProject: Project = {
        ...project,
        updated: Date.now(),
        objects: [...project.objects, modelObject],
      };

      await saveProject(updatedProject);
      navigate({ to: '/ar' });
    } catch (err) {
      console.error('Failed to open in AR:', err);
    }
  };

  // If reconstruction complete, show 3D Model inspection and export
  if (reconstructionResult) {
    return (
      <div className="flex flex-col min-h-screen bg-background text-foreground p-4 lg:p-6">
        <header className="flex items-center justify-between pb-4 border-b border-border mb-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setReconstructionResult(null)}
              title="Back to camera"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-base font-bold text-foreground flex items-center gap-2">
                <Box className="w-5 h-5 text-primary" />
                Reconstructed 3D Model
              </h1>
              <p className="text-xs text-muted-foreground">
                Genuine photogrammetry mesh with baked photographic texture
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setReconstructionResult(null);
                setPhotos([]);
                setActiveStepIndex(0);
              }}
              className="text-xs gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Scan Another Object
            </Button>
            {onClose && (
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="w-5 h-5" />
              </Button>
            )}
          </div>
        </header>

        <div className="flex-1">
          <ModelViewer3D
            initialGeometry={reconstructionResult.geometry}
            textureCanvas={reconstructionResult.textureCanvas}
            onOpenInEditor={handleOpenInEditor}
            onOpenInAR={handleOpenInAR}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground p-3 lg:p-6 select-none">
      {/* Top Navigation Bar */}
      <header className="flex items-center justify-between pb-3 border-b border-border/60 mb-4">
        <div className="flex items-center gap-3">
          {onClose ? (
            <Button variant="ghost" size="icon" onClick={onClose}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
          ) : (
            <Button variant="ghost" size="icon" onClick={() => navigate({ to: '/' })}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
          )}

          <div>
            <h1 className="text-sm lg:text-base font-bold text-foreground flex items-center gap-2">
              <Camera className="w-4 h-4 text-primary" />
              3D Object Scanner
            </h1>
            <p className="text-[11px] text-muted-foreground">
              Capture multi-angle photos, extract silhouettes & generate real .glb models
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs gap-1"
            onClick={() => setShowTips(!showTips)}
          >
            <HelpCircle className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="hidden sm:inline">Capture Tips</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="text-xs gap-1"
            onClick={() => setShowServerModal(true)}
          >
            <Server className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="hidden sm:inline">Engine</span>
          </Button>
        </div>
      </header>

      {/* Capture Tips Banner */}
      {showTips && (
        <div className="mb-4 p-4 rounded-xl bg-card border border-primary/30 text-xs space-y-2 relative">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 h-6 w-6"
            onClick={() => setShowTips(false)}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
          <div className="font-semibold text-primary flex items-center gap-1.5">
            <Sparkles className="w-4 h-4" />
            Best Practices for High-Quality Photogrammetry
          </div>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground text-[11px]">
            <li>
              <strong>Light evenly:</strong> Avoid harsh single-source shadows or deep backlighting.
            </li>
            <li>
              <strong>Textured objects work best:</strong> Matte sculptures, pottery, shoes, toys, and wood reconstruct accurately.
            </li>
            <li>
              <strong>Avoid reflective/transparent items:</strong> Mirrors, glass, shiny metals, and featureless white spheres produce lower confidence.
            </li>
            <li>
              <strong>Keep the object stationary:</strong> Orbit your phone around the object; do NOT rotate the object itself.
            </li>
            <li>
              <strong>Capture 20–60 photos:</strong> Comprehensive coverage of all sides and top ensures complete 360° geometry.
            </li>
          </ul>
        </div>
      )}

      {/* Main Workspace Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1">
        {/* Left Column: Viewfinder & Camera Controls (7 Cols) */}
        <div className="lg:col-span-7 flex flex-col space-y-3">
          {/* Viewfinder Container */}
          <div className="relative aspect-[4/3] sm:aspect-[16/10] bg-neutral-950 rounded-2xl overflow-hidden border border-border/80 shadow-2xl flex items-center justify-center">
            {cameraActive ? (
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
                <Camera className="w-10 h-10 mb-2 opacity-40 text-primary" />
                <p className="text-xs max-w-xs">{cameraError || 'Initializing camera stream…'}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 text-xs gap-1.5"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-3.5 h-3.5" />
                  Upload Photographs Instead
                </Button>
              </div>
            )}

            {/* Scanning Overlay Reticle */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-52 h-52 sm:w-64 sm:h-64 border-2 border-dashed border-primary/50 rounded-3xl flex items-center justify-center">
                <div className="w-4 h-4 border-t-2 border-l-2 border-primary absolute top-2 left-2" />
                <div className="w-4 h-4 border-t-2 border-r-2 border-primary absolute top-2 right-2" />
                <div className="w-4 h-4 border-b-2 border-l-2 border-primary absolute bottom-2 left-2" />
                <div className="w-4 h-4 border-b-2 border-r-2 border-primary absolute bottom-2 right-2" />
                <div className="w-2 h-2 rounded-full bg-primary/40 animate-ping" />
              </div>
            </div>

            {/* Top Viewfinder Controls */}
            <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-auto">
              <div className="bg-black/60 backdrop-blur-md px-3 py-1 rounded-full text-[11px] font-semibold text-white flex items-center gap-1.5 border border-white/10">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                {currentStep.title} ({activeStepIndex + 1}/{SCAN_STEPS.length})
              </div>

              <div className="flex items-center gap-1.5">
                {torchAvailable && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-white hover:bg-black/80"
                    onClick={toggleTorch}
                    title="Toggle Torch"
                  >
                    {torchOn ? (
                      <Zap className="w-4 h-4 text-amber-400 fill-amber-400" />
                    ) : (
                      <ZapOff className="w-4 h-4 text-white/70" />
                    )}
                  </Button>
                )}

                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-white hover:bg-black/80"
                  onClick={switchCamera}
                  title="Switch Camera"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Bottom Warning Alert */}
            {lastWarning && (
              <div className="absolute bottom-3 left-3 right-3 bg-amber-500/90 text-amber-950 px-3 py-1.5 rounded-xl text-[11px] font-semibold flex items-center gap-2 backdrop-blur-md shadow-lg animate-in fade-in slide-in-from-bottom-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="truncate">{lastWarning}</span>
              </div>
            )}
          </div>

          {/* Shutter & File Upload Controls */}
          <div className="flex items-center justify-between p-3 bg-card/60 rounded-2xl border border-border/60">
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-3.5 h-3.5" />
              Upload Photos
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              hidden
              onChange={handleFileUpload}
            />

            {/* Shutter Button */}
            <button
              onClick={capturePhoto}
              disabled={!cameraActive}
              aria-label="Capture photograph"
              className="relative w-16 h-16 rounded-full border-4 border-primary flex items-center justify-center transition-all transform active:scale-90 hover:scale-105 disabled:opacity-40"
            >
              <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
                <Camera className="w-6 h-6 text-primary-foreground" />
              </div>
            </button>

            <div className="text-right">
              <span className="text-xs font-semibold text-foreground">
                {photos.length} captured
              </span>
              <p className="text-[10px] text-muted-foreground">
                {photos.length < 6
                  ? 'Min 6 needed'
                  : photos.length < 20
                    ? 'Good start'
                    : 'Optimal (20–60)'}
              </p>
            </div>
          </div>

          {/* Current Step Instruction Card */}
          <div className="p-4 bg-card rounded-2xl border border-border/60 text-xs space-y-1">
            <div className="font-semibold text-primary flex items-center justify-between">
              <span>{currentStep.title}</span>
              <span className="text-[10px] text-muted-foreground uppercase font-mono">
                {currentStep.stageName} stage
              </span>
            </div>
            <p className="text-muted-foreground text-[11px]">{currentStep.instruction}</p>
          </div>
        </div>

        {/* Right Column: Angle Coverage Diagram & Reconstruction (5 Cols) */}
        <div className="lg:col-span-5 flex flex-col space-y-4">
          {/* Visual Hemisphere Orbit Diagram */}
          <HemisphereDiagram
            photos={photos}
            activeGroup={currentStep.group}
            onSelectGroup={(g) => {
              const idx = SCAN_STEPS.findIndex((s) => s.group === g);
              if (idx >= 0) setActiveStepIndex(idx);
            }}
          />

          {/* Captured Photos Gallery */}
          <div className="bg-card rounded-2xl border border-border/60 p-4 flex flex-col space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-primary" />
                Captured Photos ({photos.length})
              </span>
              {photos.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] text-destructive hover:text-destructive"
                  onClick={() => setPhotos([])}
                >
                  Clear All
                </Button>
              )}
            </div>

            {photos.length === 0 ? (
              <div className="p-6 text-center text-[11px] text-muted-foreground border border-dashed border-border/60 rounded-xl">
                No photos captured yet. Point your camera at the object and tap the shutter button.
              </div>
            ) : (
              <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
                {photos.map((p, idx) => (
                  <div
                    key={p.id}
                    className="relative shrink-0 w-20 h-20 rounded-xl overflow-hidden border border-border group"
                  >
                    <img
                      src={p.transparentDataUrl || p.thumbnailUrl}
                      alt={`Photo ${idx + 1}`}
                      className="w-full h-full object-cover bg-neutral-900"
                    />

                    {/* Quality score indicator */}
                    <div className="absolute top-1 left-1 bg-black/70 px-1 py-0.5 rounded text-[8px] font-mono text-white">
                      {p.quality.overallScore}%
                    </div>

                    {/* Touchup mask button */}
                    <button
                      onClick={() => setInspectPhoto(p)}
                      title="Touch up background mask"
                      className="absolute bottom-1 left-1 bg-primary/80 hover:bg-primary text-primary-foreground p-1 rounded-md text-[9px]"
                    >
                      <Sliders className="w-2.5 h-2.5" />
                    </button>

                    {/* Delete button */}
                    <button
                      onClick={() => deletePhoto(p.id)}
                      title="Delete photo"
                      className="absolute top-1 right-1 bg-rose-600/80 hover:bg-rose-600 text-white p-1 rounded-md"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Reconstruction Execution Card */}
          <div className="bg-card rounded-2xl border border-border/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  3D Reconstruction
                </h3>
                <p className="text-[10px] text-muted-foreground">
                  Space-Carving + Marching Cubes + Projective Texture Baking
                </p>
              </div>

              {/* Quality Preset Buttons */}
              <div className="flex items-center gap-1 bg-background/60 p-0.5 rounded-lg border border-border/40">
                {(['draft', 'standard', 'high'] as const).map((q) => (
                  <Button
                    key={q}
                    size="sm"
                    variant={preset === q ? 'secondary' : 'ghost'}
                    className="h-6 text-[10px] capitalize px-2"
                    onClick={() => setPreset(q)}
                  >
                    {q}
                  </Button>
                ))}
              </div>
            </div>

            {/* Reconstruction Progress Bar (when active) */}
            {reconstructionStage.stage !== 'idle' && (
              <div className="space-y-1.5 p-3 rounded-xl bg-background/50 border border-primary/20">
                <div className="flex justify-between text-[11px]">
                  <span className="font-semibold text-primary capitalize">
                    {reconstructionStage.message}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {reconstructionStage.progress}%
                  </span>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary to-emerald-400 transition-all duration-300"
                    style={{ width: `${reconstructionStage.progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Error Message */}
            {reconstructionStage.stage === 'failed' && (
              <div className="p-3 bg-destructive/20 border border-destructive/40 rounded-xl text-[11px] text-destructive">
                {reconstructionStage.message}
              </div>
            )}

            <Button
              className="w-full gap-2 font-semibold bg-primary text-primary-foreground"
              disabled={
                photos.length < 3 ||
                (reconstructionStage.stage !== 'idle' &&
                  reconstructionStage.stage !== 'failed')
              }
              onClick={startReconstruction}
            >
              <Play className="w-4 h-4 fill-primary-foreground" />
              {reconstructionStage.stage !== 'idle' &&
              reconstructionStage.stage !== 'failed'
                ? 'Reconstructing 3D Model…'
                : 'Start 3D Reconstruction'}
            </Button>

            <div className="flex items-center gap-2 text-[10px] text-muted-foreground justify-center">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>100% Local & Free. No subscriptions or cloud API keys.</span>
            </div>
          </div>
        </div>
      </div>

      {/* Mask Touch-up Modal */}
      {inspectPhoto && (
        <MaskTouchupModal
          photo={inspectPhoto}
          onSave={(updated) => {
            setPhotos((prev) =>
              prev.map((p) => (p.id === updated.id ? updated : p))
            );
            setInspectPhoto(null);
          }}
          onClose={() => setInspectPhoto(null)}
        />
      )}

      {/* Reconstruction Engine Settings Modal */}
      {showServerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Server className="w-4 h-4 text-primary" />
                Reconstruction Engine Settings
              </h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowServerModal(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Addis AR includes a built-in browser engine that runs 100% offline. You can also connect a self-hosted COLMAP backend.
            </p>

            <div className="space-y-2">
              <div className="p-3 rounded-xl border border-primary/40 bg-primary/5 text-xs">
                <div className="font-semibold text-foreground">
                  Browser Local Engine (Active)
                </div>
                <div className="text-muted-foreground text-[11px] mt-0.5">
                  Instant, offline, zero installation. Uses visual space-carving and Marching Cubes.
                </div>
              </div>

              <div className="p-3 rounded-xl border border-border/40 bg-muted/20 text-xs space-y-2">
                <div className="font-semibold text-foreground">
                  Self-Hosted COLMAP Engine (Optional)
                </div>
                <div className="text-muted-foreground text-[11px]">
                  Requires running `python server/photogrammetry_server.py` locally.
                </div>
                <input
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="http://localhost:8000"
                  className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button size="sm" onClick={() => setShowServerModal(false)}>
                Save Settings
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
