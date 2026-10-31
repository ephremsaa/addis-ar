import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  SwitchCamera,
  Zap,
  ZapOff,
  SlidersHorizontal,
  Compass,
  Sparkles,
  Camera,
  CheckCircle2,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Layers,
  ArrowUp,
  ArrowDown,
  Activity,
  Scan,
} from 'lucide-react';
import { AngleCoverageRing } from './AngleCoverageRing';
import {
  type AngleSector,
  createInitialSectors,
  findSectorForAngle,
  getCoverageStats,
  getMissingAnglesGuidance,
  TOTAL_SECTORS,
  determineHeightLevel,
} from '../lib/sectors';
import { sensorTracker, type OrientationState } from '../lib/sensor-tracker';
import { analyzeVideoFrame, captureFrame, type ImageQualityReport } from '../lib/image-analyzer';
import type { CapturedPhoto, ScannerSettings } from '../types/scanner';

interface CameraScannerProps {
  onFinishScan: (photos: CapturedPhoto[]) => void;
  onOpenSettings: () => void;
  settings: ScannerSettings;
}

// Crisp shutter click sound using Web Audio API
function playShutterSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
  const [stream, setStream] = useState<MediaStream | null>(null);

  // Scanning state
  const [isScanning, setIsScanning] = useState(false);
  const [sectors, setSectors] = useState<AngleSector[]>(createInitialSectors);
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);

  // Sensor state (Gyro + Optical flow)
  const [orientation, setOrientation] = useState<OrientationState>({
    azimuth: 0,
    elevation: 35,
    roll: 0,
    isCalibrated: false,
    angularVelocity: 0,
    trackingSource: 'sensors',
  });

  // Camera settings
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasTorch, setHasTorch] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [showDome, setShowDome] = useState(true);

  // Quality & Feedback
  const [qualityReport, setQualityReport] = useState<ImageQualityReport>({
    isSharp: true,
    sharpness: 10,
    isTooDark: false,
    brightness: 120,
  });
  const [liveTip, setLiveTip] = useState<string>('Point at product & tap capture');
  const [lastCaptureFlash, setLastCaptureFlash] = useState(false);

  // Progress stats
  const stats = getCoverageStats(sectors);

  // 1. Initialize Camera
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

  // 4. Start Sensor & Optical Tracking
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

  // 5. Frame Analysis & Optical Tracking Loop
  useEffect(() => {
    let animId: number;

    const loop = () => {
      if (videoRef.current && videoRef.current.readyState >= 2) {
        // Run optical motion displacement tracking
        sensorTracker.processVideoFrame(videoRef.current);

        // Quality analysis
        const report = analyzeVideoFrame(videoRef.current);
        setQualityReport(report);

        // Compute live tips
        if (isScanning) {
          if (orientation.angularVelocity > 50) {
            setLiveTip('Move slower');
          } else if (report.isTooDark) {
            setLiveTip('Scene too dark · Turn on lights');
          } else if (!report.isSharp) {
            setLiveTip('Hold steady to focus');
          } else {
            const guidance = getMissingAnglesGuidance(sectors, orientation.azimuth, orientation.elevation);
            setLiveTip(guidance);
          }
        }
      }
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isScanning, orientation, sectors]);

  // 6. Primary Angle Photo Capture
  const captureCurrentAngle = useCallback(async (manualStep = false) => {
    if (!videoRef.current || videoRef.current.readyState < 2) return;

    // Find current or nearest uncovered sector
    let currentSector = findSectorForAngle(sectors, orientation.azimuth, orientation.elevation);
    if (!currentSector) {
      currentSector = sectors.find((s) => !s.isCovered) || sectors[0];
    }

    try {
      const { blob, dataUrl, thumbnailUrl } = await captureFrame(videoRef.current);

      const newPhoto: CapturedPhoto = {
        id: `photo-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        dataUrl,
        thumbnailUrl,
        blob,
        timestamp: Date.now(),
        azimuth: orientation.azimuth,
        elevation: orientation.elevation,
        sectorId: currentSector.id,
        sharpness: qualityReport.sharpness,
        brightness: qualityReport.brightness,
      };

      // Mark sector as covered
      setSectors((prev) =>
        prev.map((s) => (s.id === currentSector.id ? { ...s, isCovered: true, photoId: newPhoto.id } : s))
      );

      setPhotos((prev) => [...prev, newPhoto]);

      // Play audio shutter click
      playShutterSound();

      // Haptic vibration feedback
      if (settings.hapticFeedback && typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([45]);
      }

      // Visual camera shutter flash
      setLastCaptureFlash(true);
      setTimeout(() => setLastCaptureFlash(false), 140);

      // Advance azimuth step if requested
      if (manualStep) {
        sensorTracker.stepAngle(30);
      }
    } catch (err) {
      console.error('Frame capture failed:', err);
    }
  }, [orientation, qualityReport, sectors, settings.hapticFeedback]);

  // 7. Auto-Capture Interval when Hovering over Uncovered Angle
  useEffect(() => {
    if (!isScanning || !settings.autoCapture) return;

    if (orientation.angularVelocity > 45 || !qualityReport.isSharp || qualityReport.isTooDark) return;

    const targetSector = findSectorForAngle(sectors, orientation.azimuth, orientation.elevation);
    if (!targetSector || targetSector.isCovered) return;

    const timer = setTimeout(() => {
      captureCurrentAngle(false);
    }, 450);

    return () => clearTimeout(timer);
  }, [isScanning, orientation, qualityReport, sectors, settings.autoCapture, captureCurrentAngle]);

  // 8. Capture Button Tap Handler
  const handleCaptureButtonClick = async () => {
    if (!isScanning) {
      await sensorTracker.requestPermission();
      sensorTracker.resetCalibration();
      setIsScanning(true);
      setLiveTip('Walk 360° around product');
    }
    await captureCurrentAngle(true);
  };

  // 9. Steppers & Elevation Handlers
  const handleStepPrev = () => sensorTracker.stepAngle(-30);
  const handleStepNext = () => sensorTracker.stepAngle(30);
  const handleSetHeight = (elev: number) => sensorTracker.setElevation(elev);

  // 10. Finish Scan Handler
  const handleFinishScan = () => {
    if (photos.length < 3) {
      setLiveTip('Capture at least 3 photos to build 3D model');
      return;
    }
    onFinishScan(photos);
  };

  // 11. Reset Scan
  const handleResetScan = () => {
    setSectors(createInitialSectors());
    setPhotos([]);
    setIsScanning(false);
    sensorTracker.resetCalibration();
    setLiveTip('Point at product & tap capture');
  };

  // Circular progress calculations
  const btnRadius = 38;
  const btnCircumference = 2 * Math.PI * btnRadius;
  const strokeDashoffset = btnCircumference - (stats.percent / 100) * btnCircumference;
  const currentLevel = determineHeightLevel(orientation.elevation);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#07090e] flex flex-col justify-between select-none font-sans">
      {/* 1. Full-Screen Camera Viewport */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 w-full h-full object-cover z-0"
      />

      {/* Futuristic Scanline Overlay */}
      {isScanning && (
        <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden opacity-30">
          <div className="w-full h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_15px_#22d3ee] animate-laser-line" />
        </div>
      )}

      {/* Camera Shutter Flash */}
      <div
        className={`absolute inset-0 bg-white pointer-events-none z-30 transition-opacity duration-150 ${
          lastCaptureFlash ? 'opacity-50' : 'opacity-0'
        }`}
      />

      {/* 2. Top Navigation Bar (Dynamic Island Floating Layout) */}
      <header className="relative z-20 flex items-center justify-between px-4 pt-3 pb-2 mt-safe">
        {/* Reset / Clear Button */}
        <button
          onClick={handleResetScan}
          className="glass-btn w-10 h-10 rounded-full flex items-center justify-center text-slate-200"
          title="Reset scan"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* Live Contextual Status Pill */}
        <div className="glass-pill px-3.5 py-1.5 rounded-full flex items-center gap-2 max-w-[60vw]">
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

        {/* Progress Counter Pill */}
        <div className="glass-pill px-3 py-1.5 rounded-full flex items-center gap-1.5 shrink-0 font-mono">
          <span className="text-xs font-bold text-emerald-400">{stats.percent}%</span>
          <span className="text-[10px] text-slate-400 font-medium">
            {stats.covered}/{TOTAL_SECTORS}
          </span>
        </div>
      </header>

      {/* 3. Center AR HUD & 3D Volume Reticle */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center pointer-events-none">
        {/* 3D Scanning Volume Corner Reticles */}
        <div className="relative w-[72vw] max-w-[310px] h-[72vw] max-h-[310px] flex items-center justify-center pointer-events-none">
          {/* Top-Left Corner */}
          <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-cyan-400/80 rounded-tl-lg shadow-[0_0_8px_rgba(34,211,238,0.4)]" />
          {/* Top-Right Corner */}
          <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-cyan-400/80 rounded-tr-lg shadow-[0_0_8px_rgba(34,211,238,0.4)]" />
          {/* Bottom-Left Corner */}
          <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-cyan-400/80 rounded-bl-lg shadow-[0_0_8px_rgba(34,211,238,0.4)]" />
          {/* Bottom-Right Corner */}
          <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-cyan-400/80 rounded-br-lg shadow-[0_0_8px_rgba(34,211,238,0.4)]" />

          {/* Dynamic Artificial Horizon / Roll Level Line */}
          <div
            className="absolute w-24 h-0.5 bg-gradient-to-r from-transparent via-emerald-400/70 to-transparent pointer-events-none transition-transform duration-75"
            style={{
              transform: `rotate(${-orientation.roll}deg)`,
            }}
          />

          {/* 36-Segment Spatial Dome Radar */}
          {showDome && (
            <div className="transition-all duration-300">
              <AngleCoverageRing
                sectors={sectors}
                currentAzimuth={orientation.azimuth}
                currentElevation={orientation.elevation}
                isScanning={isScanning}
                size={Math.min(window.innerWidth * 0.72, 275)}
              />
            </div>
          )}
        </div>

        {/* Height Level Switchers (Low / Eye / Top) */}
        {isScanning && (
          <div className="mt-3 pointer-events-auto flex items-center gap-1 glass-panel p-1 rounded-full text-[11px] font-semibold">
            <button
              onClick={() => handleSetHeight(15)}
              className={`px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 ${
                currentLevel === 'low'
                  ? 'bg-gradient-to-r from-emerald-400 to-teal-400 text-slate-950 font-bold shadow-[0_2px_12px_rgba(16,185,129,0.4)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ArrowDown className="w-3.5 h-3.5" />
              <span>Low (15°)</span>
            </button>
            <button
              onClick={() => handleSetHeight(35)}
              className={`px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 ${
                currentLevel === 'mid'
                  ? 'bg-gradient-to-r from-emerald-400 to-teal-400 text-slate-950 font-bold shadow-[0_2px_12px_rgba(16,185,129,0.4)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Eye (35°)</span>
            </button>
            <button
              onClick={() => handleSetHeight(70)}
              className={`px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5 ${
                currentLevel === 'top'
                  ? 'bg-gradient-to-r from-emerald-400 to-teal-400 text-slate-950 font-bold shadow-[0_2px_12px_rgba(16,185,129,0.4)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ArrowUp className="w-3.5 h-3.5" />
              <span>Top (70°)</span>
            </button>
          </div>
        )}
      </main>

      {/* 4. Floating Action Dock on Right (VisionOS Style) */}
      <aside className="absolute right-3.5 top-24 z-20 flex flex-col gap-2.5">
        {/* Flip Camera */}
        <button
          onClick={flipCamera}
          className="glass-btn w-11 h-11 rounded-full flex items-center justify-center text-slate-100"
          title="Flip Camera"
        >
          <SwitchCamera className="w-5 h-5" />
        </button>

        {/* Torch / Light */}
        {hasTorch && (
          <button
            onClick={toggleTorch}
            className={`glass-btn w-11 h-11 rounded-full flex items-center justify-center ${
              isTorchOn ? 'text-amber-300 bg-amber-500/25 border-amber-400/60 shadow-[0_0_12px_rgba(251,191,36,0.4)]' : 'text-slate-100'
            }`}
            title="Torch"
          >
            {isTorchOn ? <Zap className="w-5 h-5 fill-amber-300" /> : <ZapOff className="w-5 h-5" />}
          </button>
        )}

        {/* Radar Dome Toggle */}
        <button
          onClick={() => setShowDome((p) => !p)}
          className={`glass-btn w-11 h-11 rounded-full flex items-center justify-center ${
            showDome ? 'text-cyan-300 bg-cyan-500/20 border-cyan-400/40' : 'text-slate-400'
          }`}
          title="Toggle Radar Dome"
        >
          <Compass className="w-5 h-5" />
        </button>

        {/* Settings */}
        <button
          onClick={onOpenSettings}
          className="glass-btn w-11 h-11 rounded-full flex items-center justify-center text-slate-100"
          title="Settings"
        >
          <SlidersHorizontal className="w-5 h-5" />
        </button>
      </aside>

      {/* 5. Bottom Controls: Build Hero Button, Shutter, Angle Steppers & Thumbnails */}
      <footer className="relative z-20 flex flex-col items-center gap-2.5 pb-6 mb-safe w-full">
        {/* HERO FINISH ACTION BUTTON (Appears as soon as ≥ 3 photos captured) */}
        {photos.length >= 3 && (
          <button
            onClick={handleFinishScan}
            className="shimmer-btn px-6 py-3 rounded-full bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 text-slate-950 font-bold text-xs uppercase tracking-wider flex items-center gap-2.5 shadow-[0_0_24px_rgba(16,185,129,0.55)] active:scale-95 transition-all"
          >
            <Sparkles className="w-4 h-4 fill-slate-950" />
            <span>Build 3D Model & Download .GLB</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-950/25 text-slate-950 font-mono text-[11px]">
              {photos.length} views
            </span>
          </button>
        )}

        {/* Thumbnail Strip of Angle Photos */}
        {photos.length > 0 && (
          <div className="w-full px-4 flex items-center gap-2.5 overflow-x-auto scrollbar-none py-1">
            <div className="glass-pill px-3 py-1 rounded-full text-[11px] font-bold text-emerald-400 shrink-0 font-mono flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5" />
              <span>{photos.length} captured</span>
            </div>
            {photos.slice(-12).map((p, idx) => (
              <div key={p.id || idx} className="relative shrink-0">
                <img
                  src={p.thumbnailUrl}
                  alt="Angle view"
                  className="w-10 h-10 rounded-full object-cover border-2 border-emerald-400 shadow-lg"
                />
                <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-slate-900 border border-emerald-400 text-[9px] font-mono text-emerald-300 flex items-center justify-center font-bold">
                  {idx + 1}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Bottom Shutter & Lateral Angle Steppers */}
        <div className="flex items-center gap-6 mt-1">
          {/* Step Angle Left */}
          {isScanning && (
            <button
              onClick={handleStepPrev}
              className="glass-btn px-3 py-2 rounded-full flex items-center gap-1 text-xs font-semibold text-slate-200 active:scale-90"
              title="Step Angle Counterclockwise"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="text-[10px] font-mono">-30°</span>
            </button>
          )}

          {/* Big Snapchat/Camera-Style Trigger Button */}
          <div className="relative flex items-center justify-center">
            {/* Circular Progress Ring */}
            <svg className="w-24 h-24 -rotate-90 pointer-events-none">
              <circle
                cx="48"
                cy="48"
                r={btnRadius}
                className="text-white/10 stroke-current"
                strokeWidth="4"
                fill="transparent"
              />
              <circle
                cx="48"
                cy="48"
                r={btnRadius}
                className="text-emerald-400 stroke-current transition-all duration-300"
                strokeWidth="4.5"
                strokeDasharray={btnCircumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                fill="transparent"
              />
            </svg>

            {/* Tap Shutter Button */}
            <button
              onClick={handleCaptureButtonClick}
              className={`absolute w-18 h-18 rounded-full flex items-center justify-center transition-all duration-200 shadow-2xl active:scale-90 ${
                isScanning
                  ? 'bg-gradient-to-tr from-slate-100 to-white text-slate-950 border-4 border-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.5)]'
                  : 'bg-white text-slate-900 shadow-xl'
              }`}
              title="Tap to capture angle photo"
            >
              <Camera className="w-8 h-8 text-slate-900" />
            </button>
          </div>

          {/* Step Angle Right */}
          {isScanning && (
            <button
              onClick={handleStepNext}
              className="glass-btn px-3 py-2 rounded-full flex items-center gap-1 text-xs font-semibold text-slate-200 active:scale-90"
              title="Step Angle Clockwise"
            >
              <span className="text-[10px] font-mono">+30°</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Micro Guidance Label */}
        <p className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase font-mono">
          {isScanning
            ? 'Tap circle to capture · Orbit product'
            : 'Tap circle to start 3D scan'}
        </p>
      </footer>
    </div>
  );
};
