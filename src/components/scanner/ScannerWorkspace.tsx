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
  Video,
  Pause,
  Square,
  Compass,
  Download,
  Radio,
  FileText,
  Utensils,
  Package,
  Footprints,
  Palette,
  Maximize,
  Minimize,
  SlidersHorizontal,
  Info,
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
import {
  ContinuousScanRecorder,
  processRecordedFramesToPhotos,
  exportScanDataset,
  importScanDataset,
  type RecordingGuidance,
} from '@/lib/scanner/continuous-recorder';
import { SectorCoverageRadar } from './SectorCoverageRadar';
import { MaskTouchupModal } from './MaskTouchupModal';
import { ModelViewer3D } from './ModelViewer3D';
import { QualityReportModal } from './QualityReportModal';
import { ReconstructionDebugModal } from './ReconstructionDebugModal';
import { newProject, newObject, saveProject, type Project } from '@/lib/ar/projects';

interface ScannerWorkspaceProps {
  onClose?: () => void;
  targetProject?: Project | undefined;
}

export type ScannerScreen = 'intro' | 'camera' | 'processing' | 'result';
export type ObjectCategory = 'food' | 'products' | 'shoes' | 'art' | 'general';

const OBJECT_PRESETS: Record<
  ObjectCategory,
  {
    name: string;
    icon: React.ComponentType<{ className?: string }>;
    description: string;
    tips: string[];
  }
> = {
  food: {
    name: 'Food & Bakery',
    icon: Utensils,
    description: 'Breads, cakes, burgers, fruit, prepared meals, and pastries.',
    tips: [
      'Keep food item completely stationary on a plate or tabletop.',
      'Use soft, diffuse room lighting — avoid harsh flash or single-point glare.',
      'Include the plate or cutting board only if intended to be part of the model.',
      'Capture Pass 1 at eye-level, then Pass 2 tilted 45° from above.',
    ],
  },
  products: {
    name: 'Products & Gadgets',
    icon: Package,
    description: 'Electronics, tools, cosmetics, bottles, and packaged goods.',
    tips: [
      'Matte and textured objects yield highest photogrammetry confidence.',
      'Avoid high-gloss chrome or clear glass surfaces.',
      'Ensure 360° circular clearance around the object.',
    ],
  },
  shoes: {
    name: 'Shoes & Apparel',
    icon: Footprints,
    description: 'Sneakers, boots, bags, leather goods, and accessories.',
    tips: [
      'Position shoes upright on a clean, contrasting surface.',
      'Orbit close enough so the shoe fills ~70% of the scanning reticle.',
      'Ensure side logos, stitching, and laces receive clean, sharp views.',
    ],
  },
  art: {
    name: 'Art & Sculptures',
    icon: Palette,
    description: 'Pottery, carvings, figurines, ceramics, and statues.',
    tips: [
      'Intricate surface texture provides dense geometric feature matches.',
      'Orbit smoothly to preserve subtle crevices and relief details.',
      'Complete at least two full orbits (eye-level and upper elevation).',
    ],
  },
  general: {
    name: 'General Object',
    icon: Box,
    description: 'Any tabletop physical item with distinct surface texture.',
    tips: [
      'Orbit your phone around the object; avoid turning the object itself.',
      'Move steadily to avoid motion blur and maintain optical overlap.',
      'Aim for 20 to 60 captured views for maximum mesh detail.',
    ],
  },
};

const PROCESSING_STAGES = [
  { id: 'validating', label: '1. Validating captured images' },
  { id: 'segmenting', label: '2. Removing unusable & blurry frames' },
  { id: 'pose-estimation', label: '3. Estimating camera positions & tracking poses' },
  { id: 'feature-matching', label: '4. Registering multi-view camera angles' },
  { id: 'geometry-carving', label: '5. Building sparse 3D point cloud' },
  { id: 'dense-geometry', label: '6. Building dense geometry & depth consensus' },
  { id: 'marching-cubes', label: '7. Reconstructing volumetric mesh surface' },
  { id: 'texturing', label: '8. Generating multi-view UV texture map' },
  { id: 'cleanup', label: '9. Validating mesh geometry & manifold topology' },
  { id: 'exporting', label: '10. Exporting production-ready binary GLB' },
];

export function ScannerWorkspace({ onClose, targetProject }: ScannerWorkspaceProps) {
  const navigate = useNavigate();

  // App Workflow State
  const [currentScreen, setCurrentScreen] = useState<ScannerScreen>('intro');
  const [selectedCategory, setSelectedCategory] = useState<ObjectCategory>('food');

  // Video & Camera state
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const datasetInputRef = useRef<HTMLInputElement>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torchAvailable, setTorchAvailable] = useState<boolean>(false);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraInitializing, setCameraInitializing] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string>('');

  // Scanning Guide / Reticle state
  const [reticleShape, setReticleShape] = useState<'box' | 'circle' | 'oval'>('box');
  const [reticleScale, setReticleScale] = useState<number>(1.0);
  const [showReticleSettings, setShowReticleSettings] = useState<boolean>(false);

  // Continuous Recording State
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const recorderRef = useRef<ContinuousScanRecorder | null>(null);
  const [recordingGuidance, setRecordingGuidance] = useState<RecordingGuidance>({
    status: 'optimal',
    message: 'Position object inside guide and tap Start Continuous Scan.',
    durationSeconds: 0,
    capturedFramesCount: 0,
    keyframeCount: 0,
    coveragePercent: 0,
    azimuthCoverage: new Array(12).fill(false),
    currentAzimuth: 0,
    isPaused: false,
    isWebXRActive: false,
  });
  const [isProcessingFrames, setIsProcessingFrames] = useState<boolean>(false);
  const [frameProcessingMessage, setFrameProcessingMessage] = useState<string>('');

  // Keyframes / Photo Dataset
  const [photos, setPhotos] = useState<ScanPhoto[]>([]);
  const [inspectPhoto, setInspectPhoto] = useState<ScanPhoto | null>(null);
  const [lastFeedbackToast, setLastFeedbackToast] = useState<{
    type: 'success' | 'warning' | 'info';
    text: string;
  } | null>(null);

  // Reconstruction State
  const [preset, setPreset] = useState<QualityPreset>('standard');
  const [reconstructionStage, setReconstructionStage] = useState<ReconstructionStageInfo>({
    stage: 'idle',
    progress: 0,
    message: '',
  });
  const [reconstructionResult, setReconstructionResult] = useState<ReconstructionResult | null>(null);
  const [showQualityReport, setShowQualityReport] = useState<boolean>(false);
  const [showDebugModal, setShowDebugModal] = useState<boolean>(false);

  // Settings & Modals
  const [showServerModal, setShowServerModal] = useState<boolean>(false);
  const [serverUrl, setServerUrl] = useState<string>('http://localhost:8000');
  const [showTips, setShowTips] = useState<boolean>(false);

  // Stop camera tracks cleanly
  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setTorchOn(false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCameraStream();
      if (recorderRef.current) {
        void recorderRef.current.stop();
      }
    };
  }, []);

  // Request & Start Camera
  const startCamera = async () => {
    stopCameraStream();
    setCameraError('');
    setCameraInitializing(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraActive(true);
      setCurrentScreen('camera');

      // Check torch capability
      const track = stream.getVideoTracks()[0];
      if (track && 'getCapabilities' in track) {
        const caps = (track as any).getCapabilities?.();
        setTorchAvailable(Boolean(caps?.torch));
      } else {
        setTorchAvailable(false);
      }
    } catch (err: any) {
      console.error('Camera initialization failed:', err);
      setCameraActive(false);
      setCameraError(
        err?.name === 'NotAllowedError'
          ? 'Camera permission was denied. Please allow camera access in your browser settings to scan in real-time, or upload photos below.'
          : 'Unable to start camera stream. Please ensure no other application is using the camera.'
      );
    } finally {
      setCameraInitializing(false);
    }
  };

  // Switch rear/front camera
  const switchCamera = async () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
    stopCameraStream();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { exact: nextMode },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch {
      // Fallback to ideal if exact fails
      void startCamera();
    }
  };

  // Toggle flashlight / torch
  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (track && 'applyConstraints' in track) {
      try {
        await (track as any).applyConstraints({
          advanced: [{ torch: !torchOn }],
        });
        setTorchOn(!torchOn);
      } catch (err) {
        console.warn('Torch toggle failed:', err);
      }
    }
  };

  // Start continuous ARCore-style recording
  const startContinuousScan = () => {
    if (!videoRef.current || !cameraActive) return;

    let previousKeyframeCount = 0;

    const recorder = new ContinuousScanRecorder(videoRef.current, {
      targetKeyframeIntervalMs: 380,
      minMotionDiffPercent: 3.5,
      minBlurScore: 24,
      onGuidanceUpdate: (g) => {
        setRecordingGuidance(g);

        // Feedback toast when a new keyframe is captured
        if (g.keyframeCount > previousKeyframeCount) {
          previousKeyframeCount = g.keyframeCount;
          setLastFeedbackToast({
            type: 'success',
            text: `Good angle captured (${g.keyframeCount} views)`,
          });
        } else if (g.status === 'too-fast') {
          setLastFeedbackToast({
            type: 'warning',
            text: 'Moving too fast — slow down for sharp views',
          });
        }
      },
    });

    recorderRef.current = recorder;
    recorder.start();
    setIsRecording(true);
    setIsPaused(false);
  };

  const pauseContinuousScan = () => {
    if (recorderRef.current && isRecording) {
      recorderRef.current.pause();
      setIsPaused(true);
    }
  };

  const resumeContinuousScan = () => {
    if (recorderRef.current && isRecording) {
      recorderRef.current.resume();
      setIsPaused(false);
    }
  };

  const stopContinuousScan = async () => {
    if (!recorderRef.current || !isRecording) return;
    setIsRecording(false);
    setIsPaused(false);
    setIsProcessingFrames(true);
    setFrameProcessingMessage('Finalizing continuous recording frames…');

    try {
      const frames = await recorderRef.current.stop();
      if (frames.length > 0) {
        setFrameProcessingMessage(`Filtering and validating ${frames.length} keyframes…`);
        const newPhotos = await processRecordedFramesToPhotos(frames, (msg) => {
          setFrameProcessingMessage(msg);
        });
        setPhotos((prev) => [...prev, ...newPhotos]);
      }
    } catch (err: any) {
      console.error('Frame processing failed:', err);
    } finally {
      setIsProcessingFrames(false);
      setFrameProcessingMessage('');
      recorderRef.current = null;
    }
  };

  // Single Photo Manual Capture
  const captureSinglePhoto = async () => {
    const video = videoRef.current;
    if (!video || !cameraActive || video.videoWidth === 0) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

    // Create thumbnail
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 160;
    thumbCanvas.height = 120;
    const thumbCtx = thumbCanvas.getContext('2d');
    if (thumbCtx) {
      thumbCtx.drawImage(canvas, 0, 0, 160, 120);
    }
    const thumbnailUrl = thumbCanvas.toDataURL('image/jpeg', 0.8);

    const quality = await validateImageQuality(canvas);
    const seg = await segmentForeground(canvas);

    const newPhoto: ScanPhoto = {
      id: crypto.randomUUID(),
      dataUrl,
      thumbnailUrl,
      timestamp: Date.now(),
      angleGroup: 'front',
      azimuth: (photos.length * 25) % 360,
      elevation: 20,
      maskDataUrl: seg.maskDataUrl,
      transparentDataUrl: seg.transparentDataUrl,
      isSegmented: true,
      quality,
    };

    setPhotos((prev) => [...prev, newPhoto]);
    setLastFeedbackToast({
      type: 'success',
      text: `Photo captured (${photos.length + 1} views)`,
    });
  };

  // File Upload Batch Processing
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessingFrames(true);
    setFrameProcessingMessage(`Processing batch of ${files.length} uploaded photos…`);

    const newItems: ScanPhoto[] = [];
    const totalBatch = files.length;

    for (let i = 0; i < totalBatch; i++) {
      const file = files[i];
      if (!file) continue;

      setFrameProcessingMessage(`Processing image ${i + 1} of ${totalBatch}…`);
      const dataUrl = await new Promise<string>((res) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result as string);
        reader.readAsDataURL(file);
      });

      const img = document.createElement('img');
      img.src = dataUrl;
      await new Promise((res) => {
        img.onload = res;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(img, 0, 0);

      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = 160;
      thumbCanvas.height = 120;
      const thumbCtx = thumbCanvas.getContext('2d');
      if (thumbCtx) thumbCtx.drawImage(img, 0, 0, 160, 120);
      const thumbnailUrl = thumbCanvas.toDataURL('image/jpeg', 0.8);

      const quality = await validateImageQuality(canvas);
      const seg = await segmentForeground(canvas);

      const globalIdx = photos.length + i;
      const globalTotal = photos.length + totalBatch;
      const azimuth = Math.round((globalIdx / globalTotal) * 360) % 360;
      const elevation = globalTotal >= 20 && globalIdx >= Math.floor(globalTotal * 0.65) ? 40 : 15;

      newItems.push({
        id: crypto.randomUUID(),
        dataUrl,
        thumbnailUrl,
        timestamp: Date.now(),
        angleGroup: elevation >= 35 ? 'top-front' : 'front',
        azimuth,
        elevation,
        maskDataUrl: seg.maskDataUrl,
        transparentDataUrl: seg.transparentDataUrl,
        isSegmented: true,
        quality,
      });
    }

    setPhotos((prev) => [...prev, ...newItems]);
    setIsProcessingFrames(false);
    setFrameProcessingMessage('');
    if (e.target) e.target.value = '';
  };

  // Import Scan Dataset (.json)
  const handleDatasetUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsProcessingFrames(true);
      setFrameProcessingMessage('Parsing imported scan dataset…');
      const importedPhotos = await importScanDataset(file);
      setPhotos((prev) => [...prev, ...importedPhotos]);
      setLastFeedbackToast({
        type: 'success',
        text: `Imported ${importedPhotos.length} views from dataset`,
      });
    } catch (err: any) {
      alert(`Dataset import failed: ${err.message}`);
    } finally {
      setIsProcessingFrames(false);
      setFrameProcessingMessage('');
      if (e.target) e.target.value = '';
    }
  };

  // Export Scan Dataset
  const handleExportDataset = () => {
    if (photos.length === 0) return;
    const blob = exportScanDataset(photos, {
      objectName: OBJECT_PRESETS[selectedCategory].name,
      captureDurationSec: recordingGuidance.durationSeconds,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `addis-ar-scan-dataset-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Finish Scanning and Start Reconstruction
  const finishScanAndReconstruct = async (
    retryStrategy?: 'filter-blurry' | 'relax-features' | 'conservative-carving' | 'recompute-textures'
  ) => {
    if (isRecording) {
      await stopContinuousScan();
    }
    stopCameraStream();

    if (photos.length < 3) {
      alert('Please capture or upload at least 3 photos from different angles to reconstruct a 3D model.');
      return;
    }

    setCurrentScreen('processing');
    setReconstructionStage({
      stage: 'validating',
      progress: 5,
      message: 'Initializing multi-view photogrammetry pipeline…',
    });

    try {
      const result = await reconstruct3DModel(
        photos,
        preset,
        undefined,
        (info) => {
          setReconstructionStage(info);
        },
        retryStrategy
      );

      setReconstructionResult(result);
      setCurrentScreen('result');
    } catch (err: any) {
      console.error('Reconstruction error:', err);
      setReconstructionStage({
        stage: 'failed',
        progress: 0,
        message: err?.message || 'Reconstruction failed. Please review your views and try again.',
      });
    }
  };

  // Handoff to Addis AR Editor
  const handleOpenInEditor = async (glbBlob: Blob, glbDataUrl: string) => {
    try {
      let project = targetProject;
      if (!project) {
        project = newProject(`${OBJECT_PRESETS[selectedCategory].name} Scan`);
      }

      const modelObject = newObject('model');
      modelObject.name = `${OBJECT_PRESETS[selectedCategory].name} Model`;
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

  // Handoff to AR Camera Mode
  const handleOpenInAR = async (glbBlob: Blob, glbDataUrl: string) => {
    try {
      let project = targetProject;
      if (!project) {
        project = newProject('Scanned AR Experience');
      }

      const modelObject = newObject('model');
      modelObject.name = `${OBJECT_PRESETS[selectedCategory].name} AR Object`;
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

  // ==========================================
  // SCREEN 4: FINAL 3D RESULT SCREEN
  // ==========================================
  if (currentScreen === 'result' && reconstructionResult) {
    return (
      <div className="flex flex-col min-h-screen bg-background text-foreground p-3 sm:p-5 select-none">
        {/* Navigation Bar */}
        <header className="flex items-center justify-between pb-3 border-b border-border/60 mb-3">
          <div className="flex items-center gap-2.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCurrentScreen('camera')}
              title="Return to Camera"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <div className="text-sm sm:text-base font-bold text-foreground flex items-center gap-2">
                <Box className="w-4 h-4 text-primary" />
                <span>3D Reconstruction Result</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Genuine photogrammetry mesh with baked photographic texture
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowQualityReport(true)}
              className="text-xs gap-1.5 border-purple-500/40 text-purple-300 hover:bg-purple-950/40"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
              <span className="hidden sm:inline">Quality Report</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setReconstructionResult(null);
                setPhotos([]);
                setCurrentScreen('intro');
              }}
              className="text-xs gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>New Scan</span>
            </Button>
          </div>
        </header>

        {/* 3D Model Result Viewer */}
        <div className="flex-1">
          <ModelViewer3D
            initialGeometry={reconstructionResult.geometry}
            textureCanvas={reconstructionResult.textureCanvas}
            modelTitle={`${OBJECT_PRESETS[selectedCategory].name} Scan`}
            onOpenInEditor={handleOpenInEditor}
            onOpenInAR={handleOpenInAR}
            onRescan={() => {
              setReconstructionResult(null);
              setCurrentScreen('camera');
              void startCamera();
            }}
            onViewQualityReport={() => setShowQualityReport(true)}
            onViewDataset={handleExportDataset}
          />
        </div>

        {/* Quality Report Modal */}
        {showQualityReport && reconstructionResult.qualityReport && (
          <QualityReportModal
            report={reconstructionResult.qualityReport}
            isOpen={showQualityReport}
            onClose={() => setShowQualityReport(false)}
            onContinue={() => setShowQualityReport(false)}
            onRetry={(strategy) => {
              setShowQualityReport(false);
              void finishScanAndReconstruct(strategy);
            }}
          />
        )}
      </div>
    );
  }

  // ==========================================
  // SCREEN 3: DEDICATED PROCESSING SCREEN
  // ==========================================
  if (currentScreen === 'processing') {
    const isFailed = reconstructionStage.stage === 'failed';

    return (
      <div className="flex flex-col min-h-screen bg-neutral-950 text-foreground items-center justify-center p-4 sm:p-6 select-none">
        <div className="w-full max-w-lg bg-card/90 backdrop-blur-xl border border-border/80 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
          {/* Header */}
          <div className="text-center space-y-1.5">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 text-primary mb-2">
              {isFailed ? (
                <AlertTriangle className="w-7 h-7 text-destructive" />
              ) : (
                <RefreshCw className="w-7 h-7 text-primary animate-spin" />
              )}
            </div>
            <h1 className="text-lg sm:text-xl font-bold text-foreground">
              {isFailed ? 'Reconstruction Failed' : 'Reconstructing 3D Model'}
            </h1>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              {isFailed
                ? reconstructionStage.message
                : reconstructionStage.message || 'Processing multi-view photographic dataset…'}
            </p>
          </div>

          {/* Progress Bar */}
          {!isFailed && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-muted-foreground">Reconstruction Progress</span>
                <span className="text-primary font-bold">{reconstructionStage.progress}%</span>
              </div>
              <div className="w-full h-2.5 bg-muted/40 rounded-full overflow-hidden p-0.5 border border-border/40">
                <div
                  className="h-full bg-gradient-to-r from-purple-600 to-indigo-500 rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(5, reconstructionStage.progress)}%` }}
                />
              </div>
            </div>
          )}

          {/* 10 Genuine Processing Stages */}
          <div className="space-y-1.5 bg-background/50 p-3 rounded-2xl border border-border/40 text-xs">
            {PROCESSING_STAGES.map((s, idx) => {
              const currentIdx = PROCESSING_STAGES.findIndex(
                (item) => item.id === reconstructionStage.stage
              );
              const isPast = !isFailed && currentIdx > idx;
              const isCurrent = !isFailed && currentIdx === idx;

              return (
                <div
                  key={s.id}
                  className={`flex items-center justify-between py-1 px-2 rounded-lg transition-all ${
                    isCurrent
                      ? 'bg-primary/15 text-primary font-semibold'
                      : isPast
                        ? 'text-foreground/80'
                        : 'text-muted-foreground/50'
                  }`}
                >
                  <span className="text-[11px] truncate">{s.label}</span>
                  {isPast ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : isCurrent ? (
                    <RefreshCw className="w-3 h-3 text-primary animate-spin shrink-0" />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-border shrink-0" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Failure Action Options */}
          {isFailed && (
            <div className="space-y-2 pt-2">
              <Button
                className="w-full gap-2 font-semibold bg-primary text-primary-foreground"
                onClick={() => void finishScanAndReconstruct('conservative-carving')}
              >
                <RefreshCw className="w-4 h-4" />
                <span>Retry with Conservative Carving</span>
              </Button>
              <Button
                variant="outline"
                className="w-full gap-2 font-semibold text-xs"
                onClick={() => void finishScanAndReconstruct('filter-blurry')}
              >
                <Sparkles className="w-4 h-4" />
                <span>Filter Blurry Images & Retry</span>
              </Button>
              <Button
                variant="ghost"
                className="w-full text-xs text-muted-foreground"
                onClick={() => {
                  setCurrentScreen('camera');
                  void startCamera();
                }}
              >
                Return to Camera to Add More Views
              </Button>
            </div>
          )}

          <div className="text-center text-[10px] text-muted-foreground">
            100% On-Device WebAssembly & WebGL. No cloud uploads or external API fees.
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // SCREEN 2: FULL-SCREEN IMMERSIVE LIVE CAMERA
  // ==========================================
  if (currentScreen === 'camera') {
    return (
      <div className="fixed inset-0 z-40 bg-black flex flex-col select-none overflow-hidden touch-none">
        {/* Full-Bleed Live Camera Viewfinder */}
        <div className="relative flex-1 w-full h-full bg-neutral-950 overflow-hidden flex items-center justify-center">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="absolute inset-0 w-full h-full object-cover"
          />

          {/* Central Adjustable Object Placement Guide */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div
              style={{
                transform: `scale(${reticleScale})`,
              }}
              className={`relative transition-transform duration-150 ${
                reticleShape === 'circle'
                  ? 'w-64 h-64 rounded-full border-2'
                  : reticleShape === 'oval'
                    ? 'w-72 h-52 rounded-[100px] border-2'
                    : 'w-64 h-64 sm:w-72 sm:h-72 rounded-3xl border-2'
              } ${
                isRecording
                  ? 'border-red-500/80 shadow-[0_0_35px_rgba(239,68,68,0.35)] animate-pulse'
                  : 'border-primary/70 shadow-[0_0_20px_rgba(168,85,247,0.2)]'
              }`}
            >
              {/* Corner brackets */}
              <div className="w-5 h-5 border-t-2 border-l-2 border-white absolute -top-1 -left-1" />
              <div className="w-5 h-5 border-t-2 border-r-2 border-white absolute -top-1 -right-1" />
              <div className="w-5 h-5 border-b-2 border-l-2 border-white absolute -bottom-1 -left-1" />
              <div className="w-5 h-5 border-b-2 border-r-2 border-white absolute -bottom-1 -right-1" />

              {/* Center Crosshair */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-3 h-3 rounded-full border border-white/60 flex items-center justify-center">
                  <div className="w-1 h-1 rounded-full bg-white" />
                </div>
              </div>

              {/* Object category tag */}
              <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-md px-3 py-0.5 rounded-full text-[10px] font-semibold text-white/90 border border-white/10 uppercase tracking-wider">
                {OBJECT_PRESETS[selectedCategory].name}
              </div>
            </div>
          </div>

          {/* Floating Live Guidance Toast Pill */}
          <div className="absolute top-18 left-4 right-4 flex justify-center pointer-events-none z-10">
            <div
              className={`px-4 py-2 rounded-2xl text-xs font-semibold flex items-center gap-2 backdrop-blur-xl shadow-2xl transition-all max-w-sm text-center ${
                lastFeedbackToast?.type === 'warning'
                  ? 'bg-amber-500/90 text-amber-950 border border-amber-400'
                  : lastFeedbackToast?.type === 'success'
                    ? 'bg-emerald-600/90 text-white border border-emerald-400'
                    : 'bg-black/75 text-white border border-white/15'
              }`}
            >
              <Sparkles className="w-4 h-4 shrink-0 text-amber-300" />
              <span>{lastFeedbackToast?.text || recordingGuidance.message}</span>
            </div>
          </div>

          {/* Floating Sector Coverage Radar (Top Right) */}
          <div className="absolute top-18 right-4 hidden sm:block z-10 pointer-events-auto">
            <SectorCoverageRadar
              photos={photos}
              currentAzimuth={recordingGuidance.currentAzimuth}
              rejectedCount={Math.max(0, recordingGuidance.capturedFramesCount - recordingGuidance.keyframeCount)}
              trackingStatus={recordingGuidance.status === 'optimal' ? 'optimal' : recordingGuidance.status === 'too-fast' ? 'limited' : 'optimal'}
              currentPass={recordingGuidance.coveragePercent > 75 ? 2 : 1}
              mode="floating"
            />
          </div>

          {/* Frame Processing Spinner Overlay */}
          {isProcessingFrames && (
            <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-30">
              <RefreshCw className="w-9 h-9 text-primary animate-spin mb-3" />
              <div className="text-sm font-semibold text-white">
                {frameProcessingMessage || 'Extracting optimal keyframes…'}
              </div>
              <p className="text-xs text-white/60 mt-1 max-w-xs">
                Filtering motion blur, evaluating viewpoint disparity, and generating foreground masks…
              </p>
            </div>
          )}

          {/* Camera Error Message */}
          {cameraError && (
            <div className="absolute inset-0 bg-black/90 p-6 flex flex-col items-center justify-center text-center z-30">
              <AlertTriangle className="w-10 h-10 text-amber-400 mb-3" />
              <h2 className="text-base font-bold text-white mb-1">Camera Access Issue</h2>
              <p className="text-xs text-white/70 max-w-sm mb-4">{cameraError}</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void startCamera()}>
                  Retry Camera
                </Button>
                <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  Upload Photos
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Top Dark Translucent Information Bar */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3 sm:px-4 py-3 bg-gradient-to-b from-black/90 via-black/60 to-transparent">
          {/* Back button */}
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-white hover:bg-black/80"
            onClick={() => {
              if (isRecording) {
                if (confirm('Stop recording and return to setup?')) {
                  void stopContinuousScan();
                  stopCameraStream();
                  setCurrentScreen('intro');
                }
              } else {
                stopCameraStream();
                setCurrentScreen('intro');
              }
            }}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>

          {/* Center Status Badge & Timer */}
          <div className="flex items-center gap-2 bg-black/70 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/15 text-white text-xs font-semibold">
            {isRecording ? (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                <span className="font-mono text-red-400 font-bold">
                  {Math.floor(recordingGuidance.durationSeconds / 60).toString().padStart(2, '0')}:
                  {Math.floor(recordingGuidance.durationSeconds % 60).toString().padStart(2, '0')}
                </span>
                <span className="text-white/30">|</span>
                <span>{photos.length + recordingGuidance.keyframeCount} views</span>
              </>
            ) : isPaused ? (
              <>
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="text-amber-300">PAUSED</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>{photos.length} captured</span>
              </>
            )}
          </div>

          {/* Right Action Controls */}
          <div className="flex items-center gap-1.5">
            {torchAvailable && (
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-white hover:bg-black/80"
                onClick={toggleTorch}
                title="Toggle Torch"
              >
                {torchOn ? <Zap className="w-4 h-4 text-amber-400 fill-amber-400" /> : <ZapOff className="w-4 h-4 text-white/70" />}
              </Button>
            )}

            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-white hover:bg-black/80"
              onClick={switchCamera}
              title="Flip Camera"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>

            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-white hover:bg-black/80"
              onClick={() => setShowReticleSettings(!showReticleSettings)}
              title="Adjust Reticle"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Reticle Guide Settings Drawer */}
        {showReticleSettings && (
          <div className="absolute top-16 left-3 right-3 sm:left-auto sm:right-4 sm:w-72 bg-black/85 backdrop-blur-xl border border-white/15 rounded-2xl p-4 text-white z-30 shadow-2xl space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span>Scanning Guide Settings</span>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setShowReticleSettings(false)}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>

            {/* Shape selection */}
            <div className="space-y-1">
              <label className="text-[10px] text-white/70 uppercase">Guide Shape</label>
              <div className="grid grid-cols-3 gap-1">
                {(['box', 'circle', 'oval'] as const).map((shape) => (
                  <Button
                    key={shape}
                    size="sm"
                    variant={reticleShape === shape ? 'secondary' : 'ghost'}
                    className="h-7 text-xs capitalize"
                    onClick={() => setReticleShape(shape)}
                  >
                    {shape}
                  </Button>
                ))}
              </div>
            </div>

            {/* Size scale */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-white/70">
                <span>Guide Size</span>
                <span>{Math.round(reticleScale * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.7"
                max="1.3"
                step="0.05"
                value={reticleScale}
                onChange={(e) => setReticleScale(Number(e.target.value))}
                className="w-full accent-primary"
              />
            </div>
          </div>
        )}

        {/* Bottom Full-Screen Recording Controls */}
        <div className="absolute bottom-0 left-0 right-0 z-20 p-4 sm:p-6 bg-gradient-to-t from-black/95 via-black/80 to-transparent flex flex-col items-center gap-3">
          {/* Main Actions Dock */}
          <div className="flex items-center justify-center gap-4 w-full max-w-md">
            {!isRecording ? (
              <>
                {/* Batch Upload Option */}
                <Button
                  variant="outline"
                  size="icon"
                  className="h-12 w-12 rounded-full bg-black/60 backdrop-blur-md border border-white/20 text-white hover:bg-black/80"
                  onClick={() => fileInputRef.current?.click()}
                  title="Upload Batch"
                >
                  <Upload className="w-5 h-5" />
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  hidden
                  onChange={handleFileUpload}
                />

                {/* Primary: Start Continuous Scan Shutter */}
                <button
                  onClick={startContinuousScan}
                  className="relative group h-20 w-20 rounded-full bg-gradient-to-tr from-red-600 via-purple-600 to-indigo-600 p-1 shadow-[0_0_40px_rgba(239,68,68,0.45)] transform active:scale-95 transition-all flex items-center justify-center"
                >
                  <div className="w-full h-full rounded-full border-2 border-white/80 flex items-center justify-center bg-black/30 group-hover:bg-transparent">
                    <span className="w-6 h-6 rounded-full bg-white group-hover:scale-110 transition-transform shadow-lg" />
                  </div>
                </button>

                {/* Single Shot Shutter */}
                <Button
                  variant="outline"
                  size="icon"
                  className="h-12 w-12 rounded-full bg-black/60 backdrop-blur-md border border-white/20 text-white hover:bg-black/80"
                  onClick={() => void captureSinglePhoto()}
                  title="Single Snapshot"
                >
                  <Camera className="w-5 h-5" />
                </Button>
              </>
            ) : (
              <>
                {/* Pause / Resume */}
                <Button
                  variant="outline"
                  size="default"
                  className="h-12 px-5 rounded-full bg-black/60 backdrop-blur-md border border-white/20 text-white hover:bg-black/80 font-semibold text-xs gap-2"
                  onClick={isPaused ? resumeContinuousScan : pauseContinuousScan}
                >
                  {isPaused ? <Play className="w-4 h-4 text-emerald-400" /> : <Pause className="w-4 h-4 text-amber-400" />}
                  <span>{isPaused ? 'Resume' : 'Pause'}</span>
                </Button>

                {/* Big Finish Scan Button */}
                <Button
                  variant="destructive"
                  size="default"
                  className="h-14 px-8 rounded-full font-bold text-xs sm:text-sm gap-2.5 shadow-2xl shadow-red-900/50 bg-red-600 hover:bg-red-700"
                  onClick={() => void finishScanAndReconstruct()}
                >
                  <Square className="w-4 h-4 fill-white" />
                  <span>Finish & Reconstruct</span>
                </Button>
              </>
            )}
          </div>

          {/* Quick Finish Button when in Single-Shot Mode with photos */}
          {!isRecording && photos.length >= 3 && (
            <Button
              className="h-10 px-6 rounded-full bg-primary text-primary-foreground font-bold text-xs gap-2 shadow-lg shadow-purple-900/40"
              onClick={() => void finishScanAndReconstruct()}
            >
              <Play className="w-3.5 h-3.5 fill-primary-foreground" />
              <span>Reconstruct {photos.length} Captured Views</span>
            </Button>
          )}

          {/* Instructions note */}
          <div className="text-[11px] text-white/70 text-center font-medium">
            {isRecording
              ? 'Move slowly in a 360° circle around your object. Keep it centered.'
              : 'Tap the center button to begin recording. Orbit around your object smoothly.'}
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // SCREEN 1: INTRODUCTION & SCANNER SETUP
  // ==========================================
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground p-4 lg:p-8 select-none max-w-5xl mx-auto space-y-6">
      {/* Top Header */}
      <header className="flex items-center justify-between pb-4 border-b border-border/60">
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
            <h1 className="text-lg lg:text-xl font-bold text-foreground flex items-center gap-2">
              <Camera className="w-5 h-5 text-primary" />
              Scan a 3D Object
            </h1>
            <p className="text-xs text-muted-foreground">
              Capture your object from every angle.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs gap-1.5"
            onClick={() => setShowTips(!showTips)}
          >
            <HelpCircle className="w-3.5 h-3.5 text-muted-foreground" />
            <span>Scanning Guide</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="text-xs gap-1.5"
            onClick={() => setShowServerModal(true)}
          >
            <Server className="w-3.5 h-3.5 text-muted-foreground" />
            <span>Engine</span>
          </Button>
        </div>
      </header>

      {/* Hero Setup Card */}
      <div className="p-6 sm:p-8 bg-card/80 backdrop-blur-xl rounded-3xl border border-border/70 shadow-2xl space-y-6">
        <div className="space-y-2">
          <h2 className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Select Object Type for Tailored Guidance
          </h2>
          <p className="text-xs text-muted-foreground">
            Addis AR automatically adapts photogrammetry feature thresholds and orbit recommendations based on object material.
          </p>
        </div>

        {/* Object Categories Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(Object.keys(OBJECT_PRESETS) as ObjectCategory[]).map((catKey) => {
            const item = OBJECT_PRESETS[catKey];
            const Icon = item.icon;
            const isSelected = selectedCategory === catKey;

            return (
              <button
                key={catKey}
                onClick={() => setSelectedCategory(catKey)}
                className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between space-y-3 ${
                  isSelected
                    ? 'border-primary bg-primary/10 shadow-lg shadow-primary/10 ring-1 ring-primary'
                    : 'border-border/60 bg-muted/20 hover:bg-muted/40 hover:border-border'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <div
                    className={`p-2 rounded-xl ${
                      isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  {isSelected && <span className="w-2 h-2 rounded-full bg-primary" />}
                </div>

                <div>
                  <div className="text-xs font-bold text-foreground">{item.name}</div>
                  <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                    {item.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Specific Object Advice Banner */}
        <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20 space-y-2">
          <div className="text-xs font-bold text-primary flex items-center gap-1.5">
            <Info className="w-4 h-4" />
            Capture Recommendations for {OBJECT_PRESETS[selectedCategory].name}
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-muted-foreground">
            {OBJECT_PRESETS[selectedCategory].tips.map((tip, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-primary font-bold">·</span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Primary Action Button: Start Recording */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-border/60">
          <div className="text-xs text-muted-foreground">
            <div className="font-semibold text-foreground">Camera Permission</div>
            <p className="text-[11px]">
              Tapping Start Recording requests rear-camera access to display the full-screen viewfinder.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            <Button
              variant="outline"
              size="default"
              className="h-12 px-5 text-xs gap-2 flex-1 sm:flex-initial"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-4 h-4" />
              <span>Upload Photos</span>
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              hidden
              onChange={handleFileUpload}
            />

            <Button
              size="lg"
              className="h-12 px-8 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold text-sm shadow-xl shadow-purple-900/30 gap-2.5 flex-1 sm:flex-initial hover:opacity-95"
              onClick={() => void startCamera()}
              disabled={cameraInitializing}
            >
              <Camera className="w-5 h-5" />
              <span>{cameraInitializing ? 'Initializing Camera…' : 'Start Recording'}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Dataset & Workstation SfM Tools */}
      <div className="p-4 bg-card/50 rounded-2xl border border-border/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
        <div>
          <span className="font-semibold text-foreground">Import Existing Dataset</span>
          <p className="text-[11px] text-muted-foreground">
            Load an ARCore session dataset or desktop workstation keyframe package (.json).
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="text-xs gap-1.5"
          onClick={() => datasetInputRef.current?.click()}
        >
          <Upload className="w-3.5 h-3.5" />
          <span>Import Dataset (.json)</span>
        </Button>
        <input
          ref={datasetInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={handleDatasetUpload}
        />
      </div>

      {/* Settings Modal */}
      {showServerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Server className="w-4 h-4 text-primary" />
                Photogrammetry Engine Settings
              </h2>
              <Button variant="ghost" size="icon" onClick={() => setShowServerModal(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Addis AR uses a high-performance in-browser engine. You can also connect a self-hosted COLMAP backend.
            </p>

            <div className="p-3 rounded-xl border border-primary/40 bg-primary/5 text-xs">
              <div className="font-semibold text-foreground">Browser Local Engine (Active)</div>
              <div className="text-muted-foreground text-[11px] mt-0.5">
                Instant, 100% offline, zero cloud API fees.
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
