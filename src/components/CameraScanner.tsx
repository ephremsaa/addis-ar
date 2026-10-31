import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  X,
  SwitchCamera,
  Zap,
  ZapOff,
  Grid3X3,
  Settings,
  Sparkles,
  Camera,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { AngleCoverageRing } from './AngleCoverageRing';
import {
  createInitialSectors,
  findSectorForAngle,
  getCoverageStats,
  getMissingAnglesGuidance,
  TOTAL_SECTORS,
} from '../lib/sectors';
import { sensorTracker, type OrientationState } from '../lib/sensor-tracker';
import { analyzeVideoFrame, captureFrame, type ImageQualityReport } from '../lib/image-analyzer';
import type { AngleSector, CapturedPhoto, ScannerSettings } from '../types/scanner';

interface CameraScannerProps {
  onFinishScan: (photos: CapturedPhoto[]) => void;
  onOpenSettings: () => void;
  settings: ScannerSettings;
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

  // Sensor state
  const [orientation, setOrientation] = useState<OrientationState>({
    azimuth: 0,
    elevation: 30,
    roll: 0,
    isCalibrated: false,
    angularVelocity: 0,
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
  const [liveTip, setLiveTip] = useState<string>('Tap capture to start 360° scan');
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

  // 4. Start Sensor Tracking
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

  // 5. Real-Time Image Quality & Guidance Analysis Loop
  useEffect(() => {
    let animId: number;

    const loop = () => {
      if (videoRef.current && videoRef.current.readyState >= 2) {
        const report = analyzeVideoFrame(videoRef.current);
        setQualityReport(report);

        // Compute live guidance
        if (isScanning) {
          if (orientation.angularVelocity > 45) {
            setLiveTip('⚠️ Move slower');
          } else if (report.isTooDark) {
            setLiveTip('💡 Scene too dark — turn on lights');
          } else if (!report.isSharp) {
            setLiveTip('✋ Hold steady (blurry)');
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

  // 6. Capture Angle Frame (Manual or Auto)
  const captureCurrentAngle = useCallback(async () => {
    if (!videoRef.current || videoRef.current.readyState < 2) return;

    // Find the current sector
    const currentSector = findSectorForAngle(sectors, orientation.azimuth, orientation.elevation);
    if (!currentSector) return;

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

      // Haptic feedback
      if (settings.hapticFeedback && typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([35]);
      }

      // Visual flash pulse
      setLastCaptureFlash(true);
      setTimeout(() => setLastCaptureFlash(false), 180);
    } catch (err) {
      console.error('Frame capture failed:', err);
    }
  }, [orientation, qualityReport, sectors, settings.hapticFeedback]);

  // 7. Intelligent Auto-Capture Engine
  useEffect(() => {
    if (!isScanning || !settings.autoCapture) return;

    // Check if moving too fast
    if (orientation.angularVelocity > 40) return;

    // Check if sharp and well-lit
    if (!qualityReport.isSharp || qualityReport.isTooDark) return;

    // Check if current sector is uncovered
    const targetSector = findSectorForAngle(sectors, orientation.azimuth, orientation.elevation);
    if (!targetSector || targetSector.isCovered) return;

    // Debounce capture
    const timer = setTimeout(() => {
      captureCurrentAngle();
    }, 280);

    return () => clearTimeout(timer);
  }, [isScanning, orientation, qualityReport, sectors, settings.autoCapture, captureCurrentAngle]);

  // 8. Start / Stop Scanning Handler
  const handleToggleScan = async () => {
    if (!isScanning) {
      // Request device orientation permissions on iOS
      await sensorTracker.requestPermission();
      sensorTracker.resetCalibration();
      setIsScanning(true);
      setLiveTip('Walk slowly 360° around the product');
    } else {
      // Stop or Finish
      if (stats.covered >= 3) {
        onFinishScan(photos);
      } else {
        setIsScanning(false);
        setLiveTip('Tap capture to start 360° scan');
      }
    }
  };

  // Reset scan
  const handleResetScan = () => {
    setSectors(createInitialSectors());
    setPhotos([]);
    setIsScanning(false);
    setLiveTip('Scan reset. Tap capture to start again.');
  };

  // SVG Progress Ring circumference
  const btnRadius = 38;
  const btnCircumference = 2 * Math.PI * btnRadius;
  const strokeDashoffset = btnCircumference - (stats.percent / 100) * btnCircumference;

  return (
    <div className="relative w-full h-full overflow-hidden bg-black flex flex-col justify-between">
      {/* 1. Full-Screen Camera Video Feed */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 w-full h-full object-cover z-0"
      />

      {/* Screen flash on frame capture */}
      <div
        className={`absolute inset-0 bg-white pointer-events-none z-10 transition-opacity duration-150 ${
          lastCaptureFlash ? 'opacity-35' : 'opacity-0'
        }`}
      />

      {/* 2. Top Bar (Snapchat Style) */}
      <header className="relative z-20 flex items-center justify-between px-4 pt-3 pb-2 mt-safe">
        {/* Reset / Clear Scan button */}
        <button
          onClick={handleResetScan}
          className="glass-btn w-10 h-10 rounded-full flex items-center justify-center text-white/90"
          title="Reset scan"
        >
          <RotateCcw className="w-5 h-5" />
        </button>

        {/* Live Status Guidance Pill */}
        <div className="glass-pill px-4 py-1.5 rounded-full flex items-center gap-2 max-w-[65vw]">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              isScanning ? 'bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse' : 'bg-sky-400'
            }`}
          />
          <span className="text-xs font-semibold tracking-wide truncate text-slate-100">
            {liveTip}
          </span>
        </div>

        {/* Coverage Progress Badge */}
        <div className="glass-pill px-3 py-1.5 rounded-full flex items-center gap-1.5">
          <span className="text-xs font-bold text-emerald-400">{stats.percent}%</span>
          <span className="text-[10px] text-slate-400 font-medium">
            {stats.covered}/{TOTAL_SECTORS}
          </span>
        </div>
      </header>

      {/* 3. Center Angle Coverage Dome / Reticle HUD */}
      <main className="relative z-10 flex-1 flex items-center justify-center pointer-events-none">
        {showDome && (
          <div className="transition-all duration-300">
            <AngleCoverageRing
              sectors={sectors}
              currentAzimuth={orientation.azimuth}
              currentElevation={orientation.elevation}
              isScanning={isScanning}
              size={Math.min(window.innerWidth * 0.76, 290)}
            />
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

      {/* 5. Bottom Section: Photo Thumbnail Strip & Snapchat Capture Button */}
      <footer className="relative z-20 flex flex-col items-center gap-3 pb-5 mb-safe w-full">
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

        {/* Big Center Capture Button (Snapchat Style) */}
        <div className="relative flex items-center justify-center">
          {/* Circular SVG Progress Ring */}
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

          {/* Primary Trigger Button */}
          <button
            onClick={handleToggleScan}
            className={`absolute w-18 h-18 rounded-full flex items-center justify-center transition-all duration-300 shadow-xl ${
              stats.percent >= 100
                ? 'bg-gradient-to-tr from-emerald-500 to-teal-300 text-slate-950 scale-105 shadow-emerald-500/50 animate-bounce'
                : isScanning
                ? 'bg-rose-500 text-white scale-95 shadow-rose-500/50'
                : 'bg-white text-slate-900 active:scale-95'
            }`}
            title={
              stats.percent >= 100
                ? 'Complete! Build 3D Model'
                : isScanning
                ? 'Stop / Finish Scanning'
                : 'Start 360° Scan'
            }
          >
            {stats.percent >= 100 ? (
              <Sparkles className="w-8 h-8 fill-slate-950" />
            ) : isScanning ? (
              <div className="w-6 h-6 rounded-sm bg-white" />
            ) : (
              <Camera className="w-8 h-8 text-slate-900" />
            )}
          </button>
        </div>

        {/* Small Action Label */}
        <p className="text-[11px] font-semibold tracking-wider text-slate-300 uppercase">
          {stats.percent >= 100
            ? '✨ Tap to Build 3D Model'
            : isScanning
            ? 'Scanning · Tap to Finish'
            : 'Tap button to scan product'}
        </p>
      </footer>
    </div>
  );
};
