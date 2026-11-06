import React, { useEffect, useRef, useState } from 'react';
import {
  RotateCw,
  Zap,
  ZapOff,
  Sliders,
  Sparkles,
  RotateCcw,
  Wand2,
  Disc3,
  Square,
  ArrowRight,
} from 'lucide-react';
import { AngleCoverageRing } from './AngleCoverageRing';
import { sensorTracker, type OrientationState } from '../lib/sensor-tracker';
import { productTracker, type ProductTrackingResult } from '../lib/product-tracker';
import { aiSegmenter } from '../lib/ai-segmenter';
import { analyzeVideoFrame, type ImageQualityReport } from '../lib/image-analyzer';
import {
  extractFramesFromVideo,
  type ExtractedFrame,
  type SensorSample,
} from '../lib/video-extractor';
import type { ScannerSettings, ProductShape } from '../types/scanner';

interface CameraScannerProps {
  onFinishRecording: (frames: ExtractedFrame[], shape: ProductShape, isTurntable: boolean) => void;
  onOpenSettings: () => void;
  settings: ScannerSettings;
}

export const CameraScanner: React.FC<CameraScannerProps> = ({
  onFinishRecording,
  onOpenSettings,
  settings,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const liveOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const sensorLogRef = useRef<SensorSample[]>([]);
  const recordStartTimeRef = useRef<number>(0);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasTorch, setHasTorch] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);

  // Recording & Orbit State
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [coveredSectorIds, setCoveredSectorIds] = useState<Set<string>>(new Set());
  const [isExtractingFrames, setIsExtractingFrames] = useState(false);
  const [extractProgress, setExtractProgress] = useState(0);
  const [extractMessage, setExtractMessage] = useState('');
  const [extractedFrames, setExtractedFrames] = useState<ExtractedFrame[]>([]);
  const [showFrameReview, setShowFrameReview] = useState(false);

  // Turntable mode override
  const [isTurntable, setIsTurntable] = useState(Boolean(settings.isTurntableMode));
  const [showLiveHighlight, setShowLiveHighlight] = useState(true);

  // Sensors
  const [orientation, setOrientation] = useState<OrientationState>(() => sensorTracker.getState());

  // Product Tracker
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

  const [_qualityReport, setQualityReport] = useState<ImageQualityReport>({
    isSharp: true,
    sharpness: 50,
    isTooDark: false,
    brightness: 120,
  });

  const [liveTip, setLiveTip] = useState<string>('Walk around product for 20-40s');

  // Total coverage calculation (12 low + 12 high + 1 top = 25 sectors)
  const TOTAL_COVERAGE_SECTORS = 25;
  const coveragePercent = Math.min(
    100,
    Math.round((coveredSectorIds.size / TOTAL_COVERAGE_SECTORS) * 100)
  );

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
        console.warn('Camera stream error:', err);
      }
    }

    initCamera();

    return () => {
      if (currentStream) {
        currentStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [facingMode]);

  // 2. Camera Controls (toggleFacingMode replaces legacy switchFacing)
  const toggleFacingMode = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

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

  // 3. Sensor Tracking
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

  // 4. Live Camera Frame Analysis & Guidance Loop
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

        // Render AI preview highlight
        if (showLiveHighlight && liveOverlayRef.current) {
          const cvs = liveOverlayRef.current;
          if (cvs.width !== 320 || cvs.height !== 240) {
            cvs.width = 320;
            cvs.height = 240;
          }
          aiSegmenter.renderLivePreview(videoRef.current, cvs);
        }

        const report = analyzeVideoFrame(videoRef.current);
        setQualityReport(report);

        // Map current sensor angle to sector and mark covered
        if (isRecording) {
          const azBin = Math.floor((((orientation.azimuth % 360) + 360) % 360) / 30); // 0..11
          let activeSectorId: string;

          if (orientation.elevation >= 60) {
            activeSectorId = 'top-overhead';
          } else if (orientation.elevation >= 32) {
            activeSectorId = `high-${azBin}`;
          } else {
            activeSectorId = `low-${azBin}`;
          }

          setCoveredSectorIds((prev) => {
            if (!prev.has(activeSectorId)) {
              const updated = new Set(prev);
              updated.add(activeSectorId);
              // Haptic buzz on new sector coverage
              if (settings.hapticFeedback && typeof navigator !== 'undefined' && navigator.vibrate) {
                navigator.vibrate(30);
              }
              return updated;
            }
            return prev;
          });

          // Log sensor state for accurate timestamp matching
          sensorLogRef.current.push({
            timestamp: Date.now() - recordStartTimeRef.current,
            azimuth: orientation.azimuth,
            elevation: orientation.elevation,
            roll: orientation.roll,
            pose: sensorTracker.getCurrentPose(),
          });

          // Live Guidance Tips
          if (orientation.angularVelocity > 35) {
            setLiveTip('Move slower');
          } else if (report.isTooDark) {
            setLiveTip('Too dark · Turn on lights');
          } else if (trackRes.distanceFeedback === 'too_far') {
            setLiveTip('Move closer to product');
          } else if (trackRes.distanceFeedback === 'too_close') {
            setLiveTip('Step back slightly');
          } else if (trackRes.bounds.x < 0.35 || trackRes.bounds.x > 0.65) {
            setLiveTip('Keep the product centered');
          } else {
            // Check missing heights
            let hasLowCount = 0;
            let hasHighCount = 0;
            coveredSectorIds.forEach((id) => {
              if (id.startsWith('low-')) hasLowCount++;
              if (id.startsWith('high-')) hasHighCount++;
            });

            if (hasLowCount < 10) {
              setLiveTip('Walk around at eye level');
            } else if (hasHighCount < 10) {
              setLiveTip('Go higher · Raise camera');
            } else if (!coveredSectorIds.has('top-overhead')) {
              setLiveTip('Scan from above · Tilt down');
            } else {
              setLiveTip('✨ Complete! Tap red button to finish');
            }
          }
        }
      }
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isRecording, orientation, coveredSectorIds, showLiveHighlight, settings.hapticFeedback]);

  // 5. Timer for Recording Duration (20-40s)
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isRecording) {
      interval = setInterval(() => {
        setRecordSeconds((prev) => {
          const next = prev + 1;
          if (next >= 40) {
            // Auto-stop at 40 seconds
            stopRecording();
          }
          return next;
        });
      }, 1000);
    } else {
      setRecordSeconds(0);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  // 6. Start / Stop Orbit Video Recording
  const startRecording = () => {
    if (!stream) return;
    recordedChunksRef.current = [];
    sensorLogRef.current = [];
    recordStartTimeRef.current = Date.now();
    setCoveredSectorIds(new Set());
    setExtractedFrames([]);
    setShowFrameReview(false);

    try {
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/mp4')
        ? 'video/mp4'
        : 'video/webm';

      const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6000000 });
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };
      mr.onstop = handleVideoRecorded;
      mr.start(100);
      mediaRecorderRef.current = mr;
      setIsRecording(true);

      if (settings.hapticFeedback && typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([60]);
      }
    } catch (err) {
      console.error('Could not start MediaRecorder:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (settings.hapticFeedback && typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([50, 50, 50]);
      }
    }
  };

  // 7. Extract 60-100 Frames from Video and Show Review Tray
  const handleVideoRecorded = async () => {
    const blob = new Blob(recordedChunksRef.current, { type: 'video/mp4' });
    setIsExtractingFrames(true);
    setExtractProgress(10);
    setExtractMessage('Processing orbit video & filtering motion blur...');

    try {
      const frames = await extractFramesFromVideo(
        blob,
        sensorLogRef.current,
        80,
        (prog, msg) => {
          setExtractProgress(prog);
          setExtractMessage(msg);
        }
      );

      setExtractedFrames(frames);
      setIsExtractingFrames(false);
      setShowFrameReview(true);
    } catch (err: unknown) {
      console.error('Frame extraction failed:', err);
      setIsExtractingFrames(false);
      alert('Frame extraction error: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  // 8. Confirm Frames and Send to Photogrammetry Pipeline
  const handleProceedToReconstruction = () => {
    if (extractedFrames.length < 15) return;
    onFinishRecording(extractedFrames, 'auto', isTurntable);
  };

  const handleReset = () => {
    setCoveredSectorIds(new Set());
    setExtractedFrames([]);
    setShowFrameReview(false);
    setIsRecording(false);
    setRecordSeconds(0);
    setLiveTip('Walk around product for 20-40s');
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

      {/* AI Live Segmentation Mask Shader */}
      {showLiveHighlight && (
        <canvas
          ref={liveOverlayRef}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-200"
          style={{ opacity: 0.90 }}
        />
      )}

      {/* 2. Top VisionOS Glass Bar */}
      <header className="relative z-20 flex items-center justify-between px-4 pt-3 pb-2 mt-safe">
        <button
          onClick={handleReset}
          className="glass-btn p-2.5 rounded-full text-slate-300 hover:text-white"
          title="Reset"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* Live Status Guidance Pill */}
        <div className="glass-pill px-3.5 py-1.5 rounded-full flex items-center gap-2 max-w-[58vw]">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              isRecording
                ? 'bg-rose-500 shadow-[0_0_12px_#f43f5e] animate-pulse'
                : 'bg-emerald-400'
            }`}
          />
          <span className="text-xs font-semibold tracking-tight truncate text-slate-100">
            {isRecording ? `${recordSeconds}s · ${liveTip}` : liveTip}
          </span>
        </div>

        {/* Coverage Percentage */}
        <div className="glass-pill px-3 py-1.5 rounded-full flex items-center gap-1.5 shrink-0 font-mono">
          <span className="text-xs font-bold text-emerald-400">{coveragePercent}%</span>
          <span className="text-[10px] text-slate-400 font-medium">covered</span>
        </div>
      </header>

      {/* 3. Center AR HUD & Coverage Ring */}
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

          <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-slate-950/80 border border-cyan-400/60 text-[9px] font-mono font-bold text-cyan-300 flex items-center gap-1 shadow-md whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>AI OBJECT LOCK · {Math.round(orientation.azimuth)}°</span>
          </div>
        </div>

        {/* 2-Tier + Top Pass Coverage Ring */}
        <div className="transition-all duration-300">
          <AngleCoverageRing
            coveredSectorIds={coveredSectorIds}
            currentAzimuth={orientation.azimuth}
            currentElevation={orientation.elevation}
            isRecording={isRecording}
            size={Math.min(window.innerWidth * 0.78, 280)}
          />
        </div>
      </main>

      {/* 4. Right Utility Dock */}
      <aside className="absolute right-4 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-3">
        <button
          onClick={toggleFacingMode}
          className="glass-btn p-3 rounded-full text-slate-200 active:scale-95 transition-all shadow-lg"
          title="Toggle Camera (Front/Back)"
        >
          <RotateCw className="w-5 h-5" />
        </button>

        {hasTorch && (
          <button
            onClick={toggleTorch}
            className={`glass-btn p-3 rounded-full active:scale-95 transition-all shadow-lg ${
              isTorchOn ? 'text-amber-300 border-amber-400/60' : 'text-slate-200'
            }`}
            title="Flashlight"
          >
            {isTorchOn ? <Zap className="w-5 h-5" /> : <ZapOff className="w-5 h-5" />}
          </button>
        )}

        {/* Turntable Mode Toggle */}
        <button
          onClick={() => setIsTurntable(!isTurntable)}
          className={`glass-btn p-3 rounded-full active:scale-95 transition-all shadow-lg ${
            isTurntable ? 'text-amber-300 border-amber-400/60' : 'text-slate-400'
          }`}
          title="Turntable / Rotating Plate Mode"
        >
          <Disc3 className="w-5 h-5" />
        </button>

        {/* AI Highlight Toggle */}
        <button
          onClick={() => setShowLiveHighlight(!showLiveHighlight)}
          className={`glass-btn p-3 rounded-full active:scale-95 transition-all shadow-lg ${
            showLiveHighlight ? 'text-cyan-300 border-cyan-400/60' : 'text-slate-400'
          }`}
          title="Toggle AI Cutout Highlight"
        >
          <Wand2 className="w-5 h-5" />
        </button>

        <button
          onClick={onOpenSettings}
          className="glass-btn p-3 rounded-full text-slate-200 active:scale-95 transition-all shadow-lg"
          title="Settings"
        >
          <Sliders className="w-5 h-5" />
        </button>
      </aside>

      {/* 5. Bottom Controls: Snapchat-Style Record Button */}
      <footer className="relative z-20 flex flex-col items-center gap-3 px-4 pb-7 mb-safe w-full">
        {/* Record Button with Progress Ring */}
        <div className="relative flex items-center justify-center">
          {/* Circular Progress Ring */}
          <svg className="w-24 h-24 -rotate-90 pointer-events-none absolute">
            <circle
              cx="48"
              cy="48"
              r="43"
              fill="none"
              stroke="rgba(255, 255, 255, 0.15)"
              strokeWidth="4"
            />
            {isRecording && (
              <circle
                cx="48"
                cy="48"
                r="43"
                fill="none"
                stroke="#10b981"
                strokeWidth="4"
                strokeDasharray="270"
                strokeDashoffset={270 - (270 * coveragePercent) / 100}
                className="transition-all duration-300"
              />
            )}
          </svg>

          {/* Big Record Button */}
          <button
            onClick={() => (isRecording ? stopRecording() : startRecording())}
            className={`w-20 h-20 rounded-full flex items-center justify-center transition-all active:scale-95 shadow-2xl z-10 ${
              isRecording
                ? 'bg-rose-500 ring-4 ring-rose-500/40 animate-pulse'
                : 'bg-white ring-4 ring-white/30 hover:scale-105'
            }`}
          >
            {isRecording ? (
              <Square className="w-7 h-7 text-white fill-current" />
            ) : (
              <div className="w-6 h-6 rounded-full bg-rose-500" />
            )}
          </button>
        </div>

        <p className="text-[11px] font-medium text-slate-400">
          {isRecording
            ? `${recordSeconds}s / 40s · Walk around low & high, then scan top`
            : isTurntable
            ? 'Turntable Mode Active · Fixed Phone Stand'
            : 'Tap record · Walk around product in 20-40 seconds'}
        </p>
      </footer>

      {/* 6. Frame Extraction Progress Overlay */}
      {isExtractingFrames && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 rounded-full border-4 border-cyan-400/30 border-t-cyan-400 animate-spin mb-4" />
          <h3 className="text-base font-bold text-white mb-1">Extracting High-Quality Frames</h3>
          <p className="text-xs text-slate-300 font-mono mb-4">{extractMessage}</p>
          <div className="w-64 h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-300"
              style={{ width: `${extractProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* 7. Extracted Frames Review Tray Modal */}
      {showFrameReview && extractedFrames.length > 0 && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-2xl flex flex-col justify-between p-4 font-sans animate-in fade-in duration-200">
          <div className="flex items-center justify-between pt-2 px-2 border-b border-white/10 pb-3">
            <div>
              <h2 className="text-sm font-bold text-white">Extracted Photogrammetry Frames</h2>
              <p className="text-[11px] text-emerald-400 font-mono">
                {extractedFrames.length} sharp frames selected (blur rejected)
              </p>
            </div>
            <button
              onClick={() => setShowFrameReview(false)}
              className="glass-btn px-3 py-1 rounded-full text-xs text-slate-300"
            >
              Back
            </button>
          </div>

          {/* Grid of selected frames */}
          <div className="flex-1 overflow-y-auto my-3 grid grid-cols-4 gap-2 pr-1 no-scrollbar">
            {extractedFrames.map((f, i) => (
              <div key={f.id} className="relative rounded-xl overflow-hidden glass-panel border border-white/10">
                <img src={f.thumbnailUrl} alt={`Frame ${i}`} className="w-full h-20 object-cover" />
                <span className="absolute bottom-0 inset-x-0 bg-slate-950/80 text-[8px] font-mono text-center text-cyan-300">
                  {Math.round(f.azimuth)}°
                </span>
              </div>
            ))}
          </div>

          {/* Action button */}
          <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
            <button
              onClick={handleProceedToReconstruction}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 text-slate-950 font-extrabold text-sm flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.4)] active:scale-95 transition-all shimmer-btn"
            >
              <Sparkles className="w-4 h-4" />
              <span>Send {extractedFrames.length} Frames to COLMAP Server</span>
              <ArrowRight className="w-4 h-4 ml-1" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
