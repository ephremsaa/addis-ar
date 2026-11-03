import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Camera,
  RotateCw,
  Zap,
  ZapOff,
  Sliders,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  RotateCcw,
  Target,
  Wand2,
  AlertTriangle,
} from 'lucide-react';
import { AngleCoverageRing } from './AngleCoverageRing';
import {
  createInitialTargetSlots,
  findSlotForAngle,
  getGuidedAngleInstruction,
  getSlotStats,
  REQUIRED_SLOT_COUNT,
  type TargetAngleSlot,
} from '../lib/sectors';
import { sensorTracker, type OrientationState } from '../lib/sensor-tracker';
import { productTracker, type ProductTrackingResult } from '../lib/product-tracker';
import { aiSegmenter } from '../lib/ai-segmenter';
import {
  analyzeVideoFrame,
  captureFrame,
  scoreCapturedPhotoQuality,
  createTightlyCroppedProduct,
  type ImageQualityReport,
} from '../lib/image-analyzer';
import type {
  CapturedPhoto,
  ScannerSettings,
  ProductShape,
  TargetAngleId,
} from '../types/scanner';

interface CameraScannerProps {
  onFinishScan: (photos: CapturedPhoto[], shape: ProductShape) => void;
  onOpenSettings: () => void;
  settings: ScannerSettings;
}

// Crisp shutter click sound using Web Audio API
function playShutterSound() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(850, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(160, ctx.currentTime + 0.08);

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch {
    // Audio context may be restricted before gesture
  }
}

export const CameraScanner: React.FC<CameraScannerProps> = ({
  onFinishScan,
  onOpenSettings,
  settings,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const liveOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  // 8 Target Slots State
  const [slots, setSlots] = useState<TargetAngleSlot[]>(createInitialTargetSlots);
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [productShape, setProductShape] = useState<ProductShape>('auto');

  // AI Live Segmentation Highlight (Product highlighted, background dimmed)
  const [showLiveHighlight, setShowLiveHighlight] = useState(true);

  // Sensor state (Gyro + Accelerometer + Optical flow)
  const [orientation, setOrientation] = useState<OrientationState>(() => sensorTracker.getState());

  // Real-time Product Tracking Result
  const [tracking, setTracking] = useState<ProductTrackingResult>({
    isLocked: false,
    confidence: 0,
    bounds: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    pixelBounds: { minX: 20, minY: 20, maxX: 100, maxY: 70 },
    featurePoints: [],
    distanceFeedback: 'optimal',
    guidance: 'Center product in frame',
    aspectRatio: 0.85,
  });

  // Camera settings
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasTorch, setHasTorch] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);

  // Quality & Feedback
  const [qualityReport, setQualityReport] = useState<ImageQualityReport>({
    isSharp: true,
    sharpness: 50,
    isTooDark: false,
    brightness: 120,
  });
  const [liveTip, setLiveTip] = useState<string>('Point at product & tap capture');
  const [lastCaptureFlash, setLastCaptureFlash] = useState(false);
  const [lastQualityWarning, setLastQualityWarning] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  // Guided Angle Computations
  const stats = getSlotStats(slots);
  const guided = getGuidedAngleInstruction(slots, orientation.azimuth, orientation.elevation);
  const activeSlot = findSlotForAngle(slots, orientation.azimuth, orientation.elevation);

  // 1. Initialize Camera Stream
  useEffect(() => {
    let currentStream: MediaStream | null = null;

    async function initCamera() {
      try {
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
        }

        const constraints: MediaStreamConstraints = {
          audio: false,
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        };

        const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        currentStream = mediaStream;
        setStream(mediaStream);

        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          await videoRef.current.play().catch(() => {});
        }

        const videoTrack = mediaStream.getVideoTracks()[0];
        if (videoTrack) {
          const caps = (videoTrack.getCapabilities ? videoTrack.getCapabilities() : {}) as MediaTrackCapabilities & { torch?: boolean };
          setHasTorch(Boolean(caps.torch));
        }
      } catch (err) {
        console.warn('Camera initialization error:', err);
      }
    }

    initCamera();

    return () => {
      if (currentStream) {
        currentStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [facingMode]);

  // 2. Torch / Flash Toggle
  const toggleTorch = async () => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (track) {
      try {
        await (track as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
          advanced: [{ torch: !isTorchOn }],
        });
        setIsTorchOn(!isTorchOn);
      } catch (e) {
        console.warn('Could not toggle torch:', e);
      }
    }
  };

  // 3. Flip Camera
  const flipCamera = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  // 4. Start Sensor & Motion Tracking
  useEffect(() => {
    const unsub = sensorTracker.subscribe((state) => {
      setOrientation(state);
    });

    sensorTracker.start();

    return () => {
      unsub();
      sensorTracker.stop();
    };
  }, []);

  // 5. Product Tracking & AI Live Highlight Loop
  useEffect(() => {
    let animId: number;

    const loop = () => {
      if (videoRef.current && videoRef.current.readyState >= 2) {
        sensorTracker.processVideoFrame(videoRef.current);
        const trackRes = productTracker.trackFrame(videoRef.current);
        setTracking(trackRes);

        if (trackRes.bounds.width > 0) {
          const estMeters = 0.45 * (0.4 / Math.max(0.15, trackRes.bounds.width));
          sensorTracker.setEstimatedDistance(estMeters);
        }

        // Render AI Live Highlight (Product highlighted, table dimmed)
        if (showLiveHighlight && liveOverlayRef.current) {
          const cvs = liveOverlayRef.current;
          if (cvs.width !== 320 || cvs.height !== 240) {
            cvs.width = 320;
            cvs.height = 240;
          }
          aiSegmenter.renderLivePreview(videoRef.current, cvs);
        } else if (liveOverlayRef.current) {
          const octx = liveOverlayRef.current.getContext('2d');
          if (octx) octx.clearRect(0, 0, liveOverlayRef.current.width, liveOverlayRef.current.height);
        }

        // Frame quality
        const report = analyzeVideoFrame(videoRef.current);
        setQualityReport(report);

        // Contextual Guidance
        if (isScanning) {
          if (orientation.angularVelocity > 45) {
            setLiveTip('Move slower');
          } else if (report.isTooDark) {
            setLiveTip('Too dark · Increase lighting');
          } else if (!report.isSharp) {
            setLiveTip('Hold steady to focus');
          } else if (trackRes.distanceFeedback === 'too_far') {
            setLiveTip('Move closer to product');
          } else if (trackRes.distanceFeedback === 'too_close') {
            setLiveTip('Step back slightly');
          } else {
            setLiveTip(guided.instruction);
          }
        }
      }
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isScanning, orientation, slots, showLiveHighlight, guided.instruction]);

  // 6. Capture Angle Photo with AI Scoring & Background Removal
  const captureSlotPhoto = useCallback(
    async (targetSlotId?: TargetAngleId) => {
      if (!videoRef.current || videoRef.current.readyState < 2 || isCapturing) return;

      const slotToCapture = targetSlotId
        ? slots.find((s) => s.id === targetSlotId)
        : activeSlot || guided.targetSlot || slots.find((s) => !s.isCaptured) || slots[0];

      if (!slotToCapture) return;

      setIsCapturing(true);

      try {
        const { canvas, blob, dataUrl, thumbnailUrl } = await captureFrame(videoRef.current);
        const realPose = sensorTracker.getCurrentPose();

        // 1. Run AI segmentation and table cutout
        const segRes = await aiSegmenter.segmentPhoto(blob);

        // 2. Crop tightly and center on neutral canvas
        const croppedRes = await createTightlyCroppedProduct(canvas, segRes.maskCanvas);

        // 3. AI Quality Scoring (0..100%)
        const qualityScore = scoreCapturedPhotoQuality({
          imageCanvas: canvas,
          maskCanvas: segRes.maskCanvas,
          targetSlotId: slotToCapture.id,
          azimuth: orientation.azimuth,
          elevation: orientation.elevation,
          existingPhotos: photos,
        });

        // 4. Quality Gatekeeper: If photo scores < 60%, warn and require retake
        if (!qualityScore.isAcceptable) {
          setLastQualityWarning(qualityScore.feedback);
          setLiveTip(`⚠️ ${qualityScore.feedback}`);
          if (settings.hapticFeedback && typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([100, 50, 100]); // double buzz for warning
          }
          setIsCapturing(false);
          return;
        }

        setLastQualityWarning(null);

        const newPhoto: CapturedPhoto = {
          id: `photo-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          dataUrl,
          thumbnailUrl: croppedRes.croppedDataUrl || thumbnailUrl,
          croppedDataUrl: croppedRes.croppedDataUrl,
          blob,
          timestamp: Date.now(),
          azimuth: orientation.azimuth,
          elevation: orientation.elevation,
          sectorId: slotToCapture.id,
          slotId: slotToCapture.id,
          sharpness: qualityScore.sharpness,
          brightness: qualityScore.lighting,
          pose: realPose,
          maskDataUrl: segRes.maskDataUrl,
          maskBlob: segRes.maskBlob,
          segmentedDataUrl: segRes.segmentedDataUrl,
          qualityScore,
        };

        // Update Slot State
        setSlots((prev) =>
          prev.map((s) =>
            s.id === slotToCapture.id
              ? {
                  ...s,
                  isCaptured: true,
                  capturedPhotoId: newPhoto.id,
                  qualityScore,
                  confidence: qualityScore.overall,
                  isEstimated: false,
                }
              : s
          )
        );

        // Replace previous photo for this slot if re-taking
        setPhotos((prev) => {
          const filtered = prev.filter((p) => p.slotId !== slotToCapture.id);
          return [...filtered, newPhoto];
        });

        playShutterSound();

        if (settings.hapticFeedback && typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([45]);
        }

        setLastCaptureFlash(true);
        setTimeout(() => setLastCaptureFlash(false), 140);
      } catch (err) {
        console.error('Frame capture error:', err);
      } finally {
        setIsCapturing(false);
      }
    },
    [activeSlot, guided.targetSlot, isCapturing, orientation, photos, settings.hapticFeedback, slots]
  );

  // 7. Auto-Capture Trigger when Aimed and Steady
  useEffect(() => {
    if (!isScanning || isCapturing) return;

    const timer = setTimeout(() => {
      // Must be steady (< 25 deg/sec)
      if (orientation.angularVelocity > 25) return;
      if (!qualityReport.isSharp || qualityReport.isTooDark) return;

      // Active slot must be uncovered
      if (activeSlot && !activeSlot.isCaptured) {
        captureSlotPhoto(activeSlot.id);
      }
    }, 750);

    return () => clearTimeout(timer);
  }, [activeSlot, captureSlotPhoto, isCapturing, isScanning, orientation.angularVelocity, qualityReport]);

  // Start / Stop Scanner
  const handleToggleScan = () => {
    if (!isScanning) {
      setIsScanning(true);
      setLiveTip('Aim at product front view to begin');
    } else if (stats.isReady) {
      // Finish and proceed to 3D generation
      onFinishScan(photos, productShape);
    } else {
      setIsScanning(false);
    }
  };

  // Calibrate Front heading to 0°
  const handleCalibrateFront = () => {
    sensorTracker.resetAzimuthToZero();
    setLiveTip('Calibrated! Current direction is Front (0°)');
  };

  // Reset scan
  const handleResetScan = () => {
    setSlots(createInitialTargetSlots());
    setPhotos([]);
    setIsScanning(false);
    setLiveTip('Point at product & tap capture');
  };

  const boxWidth = Math.round(tracking.bounds.width * window.innerWidth);
  const boxHeight = Math.round(tracking.bounds.height * window.innerHeight);
  const boxLeft = Math.round((tracking.bounds.x - tracking.bounds.width / 2) * window.innerWidth);
  const boxTop = Math.round((tracking.bounds.y - tracking.bounds.height / 2) * window.innerHeight);

  return (
    <div className="relative w-full h-full bg-black overflow-hidden select-none font-sans">
      {/* 1. Live Camera Stream */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* AI Live Segmentation Mask Shader Overlay */}
      {showLiveHighlight && (
        <canvas
          ref={liveOverlayRef}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-200"
          style={{ opacity: 0.92 }}
        />
      )}

      {/* White Camera Flash Burst */}
      {lastCaptureFlash && (
        <div className="absolute inset-0 bg-white pointer-events-none z-50 animate-out fade-out duration-150" />
      )}

      {/* 2. Top VisionOS Glass Bar */}
      <header className="relative z-20 flex items-center justify-between px-4 pt-3 pb-2 mt-safe">
        {/* Reset Scan Button */}
        <button
          onClick={handleResetScan}
          className="glass-btn p-2.5 rounded-full text-slate-300 hover:text-white"
          title="Reset Scan"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* Live Contextual Status Pill */}
        <div className="glass-pill px-3.5 py-1.5 rounded-full flex items-center gap-2 max-w-[58vw]">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              isScanning
                ? 'bg-emerald-400 shadow-[0_0_10px_#34d399] animate-pulse'
                : 'bg-sky-400'
            }`}
          />
          <span className="text-xs font-semibold tracking-tight truncate text-slate-100">
            {liveTip}
          </span>
        </div>

        {/* 0° Front Calibrate & Progress Pill */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCalibrateFront}
            className="glass-btn px-2.5 py-1.5 rounded-full flex items-center gap-1 text-[11px] font-mono text-cyan-300 font-bold"
            title="Set Current Heading as Front (0°)"
          >
            <Target className="w-3.5 h-3.5 text-cyan-400" />
            <span>0°</span>
          </button>

          <div className="glass-pill px-3 py-1.5 rounded-full flex items-center gap-1.5 shrink-0 font-mono">
            <span className="text-xs font-bold text-emerald-400">{stats.capturedRequired}/8</span>
            <span className="text-[10px] text-slate-400 font-medium">angles</span>
          </div>
        </div>
      </header>

      {/* Quality Warning Alert Pill if photo was rejected */}
      {lastQualityWarning && (
        <div className="relative z-30 mx-4 mt-1 px-3.5 py-2 rounded-xl bg-amber-500/20 border border-amber-500/40 backdrop-blur-xl flex items-center justify-between text-xs text-amber-200 shadow-lg animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{lastQualityWarning}</span>
          </div>
          <button
            onClick={() => captureSlotPhoto()}
            className="px-2.5 py-1 rounded-lg bg-amber-400 text-slate-950 font-bold text-[10px] ml-2 shrink-0"
          >
            Retake
          </button>
        </div>
      )}

      {/* 3. Center AR HUD & 8-Slot Guided Angle Ring */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center pointer-events-none">
        {/* Product Tracking Bounding Reticle */}
        <div
          className="absolute pointer-events-none transition-all duration-100 border border-cyan-400/40 rounded-2xl shadow-[0_0_15px_rgba(34,211,238,0.2)]"
          style={{
            left: boxLeft,
            top: boxTop,
            width: boxWidth,
            height: boxHeight,
          }}
        >
          <div className="absolute -top-1 -left-1 w-5 h-5 border-t-2 border-l-2 border-cyan-400 rounded-tl shadow-[0_0_8px_#22d3ee]" />
          <div className="absolute -top-1 -right-1 w-5 h-5 border-t-2 border-r-2 border-cyan-400 rounded-tr shadow-[0_0_8px_#22d3ee]" />
          <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-2 border-l-2 border-cyan-400 rounded-bl shadow-[0_0_8px_#22d3ee]" />
          <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-2 border-r-2 border-cyan-400 rounded-br shadow-[0_0_8px_#22d3ee]" />

          {/* Product Lock Status Tag */}
          <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-slate-950/80 border border-cyan-400/60 text-[9px] font-mono font-bold text-cyan-300 flex items-center gap-1 shadow-md whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>
              {activeSlot ? activeSlot.label.toUpperCase() : 'AI TRACKING'} · {Math.round(orientation.azimuth)}°
            </span>
          </div>
        </div>

        {/* 8 Guided Angle Slots Ring HUD */}
        <div className="transition-all duration-300">
          <AngleCoverageRing
            slots={slots}
            activeSlotId={activeSlot?.id}
            nextRecommendedId={guided.targetSlot?.id}
            currentAzimuth={orientation.azimuth}
            currentElevation={orientation.elevation}
            isScanning={isScanning}
            size={Math.min(window.innerWidth * 0.78, 295)}
            onSelectSlot={(slotId) => captureSlotPhoto(slotId as TargetAngleId)}
          />
        </div>
      </main>

      {/* 4. Right Utility Dock */}
      <aside className="absolute right-4 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-3">
        <button
          onClick={flipCamera}
          className="glass-btn p-3 rounded-full text-slate-200 active:scale-95 transition-all shadow-lg"
          title="Flip Camera"
        >
          <RotateCw className="w-5 h-5" />
        </button>

        {hasTorch && (
          <button
            onClick={toggleTorch}
            className={`glass-btn p-3 rounded-full active:scale-95 transition-all shadow-lg ${
              isTorchOn ? 'text-amber-300 border-amber-400/60' : 'text-slate-200'
            }`}
            title="Toggle Flashlight"
          >
            {isTorchOn ? <Zap className="w-5 h-5" /> : <ZapOff className="w-5 h-5" />}
          </button>
        )}

        {/* AI Background Removal Toggle */}
        <button
          onClick={() => setShowLiveHighlight(!showLiveHighlight)}
          className={`glass-btn p-3 rounded-full active:scale-95 transition-all shadow-lg ${
            showLiveHighlight ? 'text-cyan-300 border-cyan-400/60' : 'text-slate-400'
          }`}
          title="Toggle AI Cut-out Highlight"
        >
          <Wand2 className="w-5 h-5" />
        </button>

        <button
          onClick={onOpenSettings}
          className="glass-btn p-3 rounded-full text-slate-200 active:scale-95 transition-all shadow-lg"
          title="Scanner Settings"
        >
          <Sliders className="w-5 h-5" />
        </button>
      </aside>

      {/* 5. Bottom Tray: Clean AI Cut-out Thumbnails Strip */}
      {photos.length > 0 && (
        <div className="relative z-20 px-4 pb-2 flex items-center gap-2 overflow-x-auto no-scrollbar">
          {photos.map((p, idx) => (
            <div
              key={p.id}
              className="relative shrink-0 w-12 h-12 rounded-xl overflow-hidden glass-panel border border-cyan-400/40 shadow-md group"
            >
              <img
                src={p.thumbnailUrl || p.dataUrl}
                alt={`Angle ${idx + 1}`}
                className="w-full h-full object-contain bg-slate-900/60"
              />
              <span className="absolute bottom-0 inset-x-0 bg-slate-950/80 text-[8px] font-mono font-bold text-center text-emerald-400 py-0.2">
                {p.qualityScore?.overall || 90}%
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 6. Bottom Capture & Action Deck */}
      <footer className="relative z-20 flex flex-col items-center gap-3 px-4 pb-7 mb-safe w-full">
        {/* If ready (>=6 angles), show Build 3D Model button */}
        {stats.isReady ? (
          <button
            onClick={() => onFinishScan(photos, productShape)}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 text-slate-950 font-extrabold text-sm flex items-center justify-center gap-2 shadow-[0_0_25px_rgba(16,185,129,0.5)] active:scale-95 transition-all shimmer-btn"
          >
            <Sparkles className="w-5 h-5" />
            <span>Build 3D Model ({stats.capturedRequired}/8 Angles)</span>
            <ArrowRight className="w-4 h-4 ml-1" />
          </button>
        ) : (
          <div className="flex items-center justify-center w-full relative">
            {/* Big Round Shutter Button */}
            <button
              onClick={() => {
                if (!isScanning) {
                  setIsScanning(true);
                  setLiveTip('Aim at product front view to begin');
                } else {
                  captureSlotPhoto();
                }
              }}
              disabled={isCapturing}
              className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all active:scale-90 shadow-2xl ${
                isScanning
                  ? 'bg-gradient-to-tr from-cyan-500 to-emerald-400 ring-4 ring-cyan-400/30'
                  : 'bg-white ring-4 ring-white/30'
              }`}
            >
              {isScanning ? (
                <div className="w-7 h-7 rounded-lg bg-slate-950 flex items-center justify-center">
                  <Camera className="w-4 h-4 text-emerald-400" />
                </div>
              ) : (
                <Camera className="w-8 h-8 text-slate-900" />
              )}
            </button>
          </div>
        )}

        {/* Micro Guidance Status */}
        <p className="text-[11px] font-medium text-slate-400">
          {stats.isReady
            ? '✨ 6+ angles ready! Tap above to build, or scan remaining angles'
            : isScanning
            ? `${8 - stats.capturedRequired} angles remaining · Orbit slowly around product`
            : 'Tap shutter button to start 8-angle scan'}
        </p>
      </footer>
    </div>
  );
};
