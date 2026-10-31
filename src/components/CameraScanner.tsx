import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  SwitchCamera,
  Zap,
  ZapOff,
  Grid3X3,
  Settings,
  Sparkles,
  Camera,
  CheckCircle2,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Layers,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { AngleCoverageRing } from './AngleCoverageRing';
import {
  createInitialSectors,
  findSectorForAngle,
  getCoverageStats,
  getMissingAnglesGuidance,
  TOTAL_SECTORS,
  determineHeightLevel,
} from '../lib/sectors';
import { sensorTracker, type OrientationState } from '../lib/sensor-tracker';
import { analyzeVideoFrame, captureFrame, type ImageQualityReport } from '../lib/image-analyzer';
import type { AngleSector, CapturedPhoto, ScannerSettings } from '../types/scanner';

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
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.08);

    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch {
    // Audio context may be restricted before first gesture
  }
}

export const CameraScanner: React.FC<CameraScannerProps> = ({
  onFinishScan,
  onOpenSettings,
  settings,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Scanning State
  const [isScanning, setIsScanning] = useState(false);
  const [sectors, setSectors] = useState<AngleSector[]>(createInitialSectors);
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);

  // Sensor state (Gyro + Optical)
  const [orientation, setOrientation] = useState<OrientationState>({
    azimuth: 0,
    elevation: 30,
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

  // Live feedback
  const [qualityReport, setQualityReport] = useState<ImageQualityReport>({
    isSharp: true,
    sharpness: 50,
    isTooDark: false,
    brightness: 120,
  });
  const [liveTip, setLiveTip] = useState<string>('Point at product & tap capture');
  const [lastCaptureFlash, setLastCaptureFlash] = useState(false);

  // Progress stats
  const stats = getCoverageStats(sectors);

  // 1. Initialize Camera Stream
  const startCamera = useCallback(async () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }

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

      // Check torch capabilities
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities ? (track.getCapabilities() as { torch?: boolean }) : {};
      setHasTorch(Boolean(capabilities.torch));
    } catch (err) {
      console.error('Camera stream access failed:', err);
    }
  }, [facingMode]);

  useEffect(() => {
    startCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [startCamera]);

  // 2. Toggle Torch
  const toggleTorch = async () => {
    if (!streamRef.current || !hasTorch) return;
    const track = streamRef.current.getVideoTracks()[0];
    try {
      const nextTorch = !isTorchOn;
      await (track.applyConstraints as (c: unknown) => Promise<void>)({
        advanced: [{ torch: nextTorch }],
      });
      setIsTorchOn(nextTorch);
    } catch (err) {
      console.warn('Torch constraint error:', err);
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
        // Run optical displacement tracker
        sensorTracker.processVideoFrame(videoRef.current);

        // Quality check
        const report = analyzeVideoFrame(videoRef.current);
        setQualityReport(report);

        // Compute live tips
        if (isScanning) {
          if (orientation.angularVelocity > 50) {
            setLiveTip('⚠️ Move slower');
          } else if (report.isTooDark) {
            setLiveTip('💡 Scene too dark · Add light');
          } else if (!report.isSharp) {
            setLiveTip('✋ Hold steady to scan');
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
        navigator.vibrate([40]);
      }

      // Visual camera shutter flash
      setLastCaptureFlash(true);
      setTimeout(() => setLastCaptureFlash(false), 160);

      // If manual capture, optionally advance to the next angle
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
    }, 400);

    return () => clearTimeout(timer);
  }, [isScanning, orientation, qualityReport, sectors, settings.autoCapture, captureCurrentAngle]);

  // 8. Capture Button Tap Handler
  const handleCaptureButtonClick = async () => {
    if (!isScanning) {
      await sensorTracker.requestPermission();
      sensorTracker.resetCalibration();
      setIsScanning(true);
      setLiveTip('Walk 360° around the product');
    }
    // Immediately capture current angle on every tap!
    await captureCurrentAngle(true);
  };

  // 9. Manual Angle Stepping
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
    setLiveTip('Scan reset. Point at product & tap capture.');
  };

  // Progress ring
  const btnRadius = 38;
  const btnCircumference = 2 * Math.PI * btnRadius;
  const strokeDashoffset = btnCircumference - (stats.percent / 100) * btnCircumference;

  const currentLevel = determineHeightLevel(orientation.elevation);

  return (
    <div className="relative w-full h-full overflow-hidden bg-black flex flex-col justify-between select-none">
      {/* 1. Full-Screen Camera Video Feed */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 w-full h-full object-cover z-0"
      />

      {/* Camera shutter flash effect on capture */}
      <div
        className={`absolute inset-0 bg-white pointer-events-none z-30 transition-opacity duration-150 ${
          lastCaptureFlash ? 'opacity-40' : 'opacity-0'
        }`}
      />

      {/* 2. Top Bar (Snapchat Style) */}
      <header className="relative z-20 flex items-center justify-between px-4 pt-3 pb-2 mt-safe">
        {/* Reset Scan button */}
        <button
          onClick={handleResetScan}
          className="glass-btn w-10 h-10 rounded-full flex items-center justify-center text-white/90"
          title="Reset scan"
        >
          <RotateCcw className="w-5 h-5" />
        </button>

        {/* Live Status Guidance Pill */}
        <div className="glass-pill px-4 py-1.5 rounded-full flex items-center gap-2 max-w-[62vw]">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              isScanning ? 'bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse' : 'bg-sky-400'
            }`}
          />
          <span className="text-xs font-semibold tracking-wide truncate text-slate-100">
            {liveTip}
          </span>
        </div>

        {/* Coverage Progress Badge */}
        <div className="glass-pill px-3 py-1.5 rounded-full flex items-center gap-1.5 shrink-0">
          <span className="text-xs font-bold text-emerald-400">{stats.percent}%</span>
          <span className="text-[10px] text-slate-400 font-medium">
            {stats.covered}/{TOTAL_SECTORS}
          </span>
        </div>
      </header>

      {/* 3. Center 3D Scanning HUD & Angle Coverage Dome */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center pointer-events-none">
        {/* Animated Laser Scanning Line */}
        {isScanning && (
          <div className="absolute w-[76vw] max-w-[320px] h-[76vw] max-h-[320px] border border-sky-400/30 rounded-3xl overflow-hidden pointer-events-none">
            <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_12px_#34d399] animate-laser" />
            <div className="absolute top-2 left-2 text-[10px] font-mono text-emerald-400/80 uppercase">
              3D Laser Active · 360° Mesh
            </div>
          </div>
        )}

        {/* 36-Segment Angle Coverage Dome */}
        {showDome && (
          <div className="transition-all duration-300">
            <AngleCoverageRing
              sectors={sectors}
              currentAzimuth={orientation.azimuth}
              currentElevation={orientation.elevation}
              isScanning={isScanning}
              size={Math.min(window.innerWidth * 0.74, 280)}
            />
          </div>
        )}

        {/* Height Level Switchers (Low / Eye / Top) */}
        {isScanning && (
          <div className="mt-2 pointer-events-auto flex gap-1.5 glass-panel p-1 rounded-full text-[11px] font-semibold">
            <button
              onClick={() => handleSetHeight(15)}
              className={`px-3 py-1 rounded-full transition-all flex items-center gap-1 ${
                currentLevel === 'low'
                  ? 'bg-emerald-400 text-slate-950 font-bold shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <ArrowDown className="w-3 h-3" />
              <span>Low (Base)</span>
            </button>
            <button
              onClick={() => handleSetHeight(35)}
              className={`px-3 py-1 rounded-full transition-all flex items-center gap-1 ${
                currentLevel === 'mid'
                  ? 'bg-emerald-400 text-slate-950 font-bold shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <span>Eye (Sides)</span>
            </button>
            <button
              onClick={() => handleSetHeight(70)}
              className={`px-3 py-1 rounded-full transition-all flex items-center gap-1 ${
                currentLevel === 'top'
                  ? 'bg-emerald-400 text-slate-950 font-bold shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <ArrowUp className="w-3 h-3" />
              <span>Top</span>
            </button>
          </div>
        )}
      </main>

      {/* 4. Right Side Vertical Tools Dock (Snapchat Style) */}
      <aside className="absolute right-3.5 top-28 z-20 flex flex-col gap-3">
        {/* Flip Camera */}
        <button
          onClick={flipCamera}
          className="glass-btn w-11 h-11 rounded-full flex items-center justify-center text-white"
          title="Flip Camera"
        >
          <SwitchCamera className="w-5 h-5" />
        </button>

        {/* Flash / Torch */}
        {hasTorch && (
          <button
            onClick={toggleTorch}
            className={`glass-btn w-11 h-11 rounded-full flex items-center justify-center ${
              isTorchOn ? 'text-amber-300 bg-amber-500/30 border-amber-400/50' : 'text-white'
            }`}
            title="Torch"
          >
            {isTorchOn ? <Zap className="w-5 h-5 fill-amber-300" /> : <ZapOff className="w-5 h-5" />}
          </button>
        )}

        {/* Dome / Radar Toggle */}
        <button
          onClick={() => setShowDome((p) => !p)}
          className={`glass-btn w-11 h-11 rounded-full flex items-center justify-center ${
            showDome ? 'text-sky-300' : 'text-slate-400'
          }`}
          title="Toggle Angle Dome"
        >
          <Grid3X3 className="w-5 h-5" />
        </button>

        {/* Settings */}
        <button
          onClick={onOpenSettings}
          className="glass-btn w-11 h-11 rounded-full flex items-center justify-center text-white"
          title="Settings"
        >
          <Settings className="w-5 h-5" />
        </button>
      </aside>

      {/* 5. Bottom Section: Photo Thumbnail Strip, Finish Button & Snapchat Capture Button */}
      <footer className="relative z-20 flex flex-col items-center gap-3 pb-5 mb-safe w-full">
        {/* FINISH SCAN BUTTON: Appears as soon as at least 3 photos are taken */}
        {photos.length >= 3 && (
          <button
            onClick={handleFinishScan}
            className="glass-panel px-6 py-2.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 text-slate-950 font-bold text-xs uppercase tracking-wider flex items-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.5)] animate-pulse active:scale-95 transition-all"
          >
            <Sparkles className="w-4 h-4 fill-slate-950" />
            <span>Build 3D Model & Download .GLB ({photos.length} Photos)</span>
          </button>
        )}

        {/* Thumbnail Strip of Captured Angle Photos */}
        {photos.length > 0 && (
          <div className="w-full px-4 flex items-center gap-2 overflow-x-auto scrollbar-none py-1">
            <div className="glass-pill px-2.5 py-1 rounded-full text-[11px] font-bold text-emerald-400 shrink-0">
              📸 {photos.length} views
            </div>
            {photos.slice(-12).map((p, idx) => (
              <img
                key={p.id || idx}
                src={p.thumbnailUrl}
                alt="Angle view"
                className="w-10 h-10 rounded-full object-cover border-2 border-emerald-400/80 shadow-md shrink-0"
              />
            ))}
          </div>
        )}

        {/* Bottom Stepper & Big Capture Button */}
        <div className="flex items-center gap-6">
          {/* Step Angle Left */}
          {isScanning && (
            <button
              onClick={handleStepPrev}
              className="glass-btn w-10 h-10 rounded-full flex items-center justify-center text-white active:scale-90"
              title="Step Angle Counterclockwise"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}

          {/* Big Center Capture Button */}
          <div className="relative flex items-center justify-center">
            {/* Circular Progress Ring */}
            <svg className="w-24 h-24 -rotate-90 pointer-events-none">
              <circle
                cx="48"
                cy="48"
                r={btnRadius}
                className="text-white/20 stroke-current"
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

            {/* Tap to Capture Shutter Button */}
            <button
              onClick={handleCaptureButtonClick}
              className={`absolute w-18 h-18 rounded-full flex items-center justify-center transition-all duration-200 shadow-xl active:scale-90 ${
                isScanning
                  ? 'bg-white text-slate-950 border-4 border-emerald-400 shadow-emerald-500/40'
                  : 'bg-white text-slate-900'
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
              className="glass-btn w-10 h-10 rounded-full flex items-center justify-center text-white active:scale-90"
              title="Step Angle Clockwise"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}
        </div>

        {/* Bottom Instruction */}
        <p className="text-[11px] font-semibold tracking-wider text-slate-300 uppercase">
          {isScanning
            ? '📸 Tap circle to capture angle · Orbit slowly'
            : 'Tap circle to start 3D scan'}
        </p>
      </footer>
    </div>
  );
};
