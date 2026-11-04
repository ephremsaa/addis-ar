import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle, RefreshCw, Layers, CheckCircle2, Cpu, Sparkles, Box, Server } from 'lucide-react';
import { runServerPhotogrammetry } from '../lib/colmap-client';
import { reconstructFromPhotosClient } from '../lib/client-reconstructor';
import type { ExtractedFrame } from '../lib/video-extractor';
import type { ScannerSettings, CapturedPhoto } from '../types/scanner';

export interface PhotogrammetryResult {
  glbBlob: Blob;
  glbUrl: string;
  stats: { vertices: number; triangles: number; fileSizeMb: number };
  registeredRatio?: number;
  isDraftPreview?: boolean;
}

interface ProcessingScreenProps {
  frames: ExtractedFrame[];
  settings: ScannerSettings;
  isTurntable?: boolean;
  onSuccess: (result: PhotogrammetryResult) => void;
  onRetry: () => void;
}

const STAGES = [
  { id: 'upload', label: '1. Uploading Frames & Sensor Poses' },
  { id: 'masking', label: '2. AI Masking & Table Plane Removal' },
  { id: 'camera_solving', label: '3. COLMAP Structure-from-Motion (Camera Solving)' },
  { id: 'meshing', label: '4. Dense Multi-View Stereo Meshing' },
  { id: 'texturing', label: '5. High-Resolution Photographic Texturing' },
  { id: 'glb', label: '6. Compressing & Validating Binary .GLB' },
];

export const ProcessingScreen: React.FC<ProcessingScreenProps> = ({
  frames,
  settings,
  isTurntable = false,
  onSuccess,
  onRetry,
}) => {
  const [progress, setProgress] = useState(5);
  const [currentStage, setCurrentStage] = useState('Connecting to Server');
  const [message, setMessage] = useState('Initializing COLMAP photogrammetry engine...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function execute() {
      try {
        setError(null);

        // Check if user specifically requested fast on-device preview draft
        if (settings.usePreviewDraftOnly) {
          setCurrentStage('⚡ On-Device Draft Preview');
          setMessage('Generating fast low-quality preview on device...');

          const dummyPhotos: CapturedPhoto[] = frames.slice(0, 16).map((f) => ({
            id: f.id,
            dataUrl: f.dataUrl,
            thumbnailUrl: f.thumbnailUrl,
            blob: f.blob,
            timestamp: f.timestamp,
            azimuth: f.azimuth,
            elevation: f.elevation,
            sectorId: `frame-${f.id}`,
            sharpness: f.sharpness,
            brightness: f.brightness,
            pose: f.pose,
          }));

          const clientRes = await reconstructFromPhotosClient(dummyPhotos, (p, msg) => {
            if (!isCancelled) {
              setProgress(p);
              setMessage(msg);
            }
          });

          if (!isCancelled) {
            onSuccess({
              glbBlob: clientRes.glbBlob,
              glbUrl: clientRes.glbUrl,
              stats: {
                vertices: clientRes.vertices,
                triangles: clientRes.triangles,
                fileSizeMb: clientRes.fileSizeMb,
              },
              isDraftPreview: true,
            });
          }
          return;
        }

        // Primary: Real Server Photogrammetry Pipeline (COLMAP + OpenMVS / Open3D)
        const result = await runServerPhotogrammetry(
          frames,
          settings,
          (prog, stage, msg) => {
            if (!isCancelled) {
              setProgress(prog);
              setCurrentStage(stage);
              setMessage(msg);
            }
          }
        );

        if (!isCancelled) {
          onSuccess(result);
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          const errMsg = err instanceof Error ? err.message : 'Photogrammetry failed';
          setError(errMsg);
        }
      }
    }

    execute();

    return () => {
      isCancelled = true;
    };
  }, [frames, settings, isTurntable, onSuccess]);

  return (
    <div className="relative w-full h-full bg-[#07090e] flex flex-col items-center justify-center p-5 text-center select-none overflow-hidden font-sans">
      {/* Background glow */}
      <div className="absolute w-96 h-96 rounded-full bg-cyan-500/10 blur-[130px] pointer-events-none" />
      <div className="absolute w-80 h-80 rounded-full bg-emerald-500/10 blur-[110px] pointer-events-none -bottom-10" />

      {error ? (
        /* Error Screen with Clear Instructions */
        <div className="relative z-10 glass-panel p-6 rounded-3xl max-w-sm w-full flex flex-col items-center gap-4 border-rose-500/40 shadow-2xl">
          <div className="w-14 h-14 rounded-full bg-rose-500/20 border border-rose-500/50 flex items-center justify-center text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.3)]">
            <AlertCircle className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Reconstruction Alert</h2>
            <p className="text-xs text-rose-300/90 mt-1.5 leading-relaxed font-mono">{error}</p>
          </div>
          <div className="text-[11px] text-slate-300 bg-slate-900/60 p-3 rounded-xl border border-white/10 text-left">
            <p className="font-bold text-white mb-1">To get a perfect 3D scan:</p>
            <ul className="list-disc list-inside space-y-0.5 text-slate-400">
              <li>Walk slowly around the product (20-40s)</li>
              <li>Keep the product centered at all times</li>
              <li>Ensure good, non-glaring lighting</li>
              <li>Cover low, eye level, and top passes</li>
            </ul>
          </div>
          <button
            onClick={onRetry}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-sky-500 via-teal-400 to-emerald-400 text-slate-950 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all shimmer-btn"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Re-record Video</span>
          </button>
        </div>
      ) : (
        /* Real Photogrammetry Progress Screen */
        <div className="relative z-10 glass-panel p-6 rounded-3xl max-w-sm w-full flex flex-col items-center gap-4.5 shadow-2xl border-white/15">
          <div className="relative w-24 h-24 flex items-center justify-center my-1">
            <div className="absolute inset-0 rounded-full border border-dashed border-cyan-400/50 animate-spin-slow" />
            <div
              className="absolute inset-2 rounded-full border border-emerald-400/40 animate-spin"
              style={{ animationDirection: 'reverse', animationDuration: '6s' }}
            />
            <div className="w-13 h-13 rounded-2xl bg-gradient-to-tr from-cyan-500/25 to-emerald-400/25 border border-cyan-400/60 flex items-center justify-center backdrop-blur-xl shadow-[0_0_24px_rgba(34,211,238,0.35)]">
              <Server className="w-6 h-6 text-cyan-300 animate-pulse" />
            </div>
          </div>

          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-mono font-bold tracking-wider uppercase mb-1">
              <Sparkles className="w-3 h-3" />
              <span>COLMAP Photogrammetry Server</span>
            </div>
            <h2 className="text-base font-bold text-white tracking-tight">{currentStage}</h2>
            <p className="text-xs text-slate-400 mt-1 font-mono text-[11px] truncate max-w-[280px]">
              {message}
            </p>
          </div>

          {/* Progress Bar */}
          <div className="w-full flex flex-col gap-1.5">
            <div className="w-full h-2 rounded-full bg-slate-900/90 overflow-hidden border border-white/10 p-[1px]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400 transition-all duration-300 shadow-[0_0_12px_#22d3ee]"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] font-semibold text-slate-400 px-1 font-mono">
              <span>{frames.length} frames</span>
              <span className="text-emerald-400 font-bold">{progress}%</span>
            </div>
          </div>

          {/* Pipeline Step Tracker */}
          <div className="w-full flex flex-col gap-1.5 text-left pt-2.5 border-t border-white/10">
            {STAGES.map((st, idx) => {
              const stageNum = idx + 1;
              const isDone = progress >= (stageNum / STAGES.length) * 100;
              const isCurrent = !isDone && progress >= ((stageNum - 1) / STAGES.length) * 100;

              return (
                <div
                  key={st.id}
                  className={`flex items-center gap-2 text-[11px] font-medium transition-colors ${
                    isDone
                      ? 'text-emerald-400'
                      : isCurrent
                      ? 'text-cyan-300 font-bold'
                      : 'text-slate-600'
                  }`}
                >
                  {isDone ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                  ) : isCurrent ? (
                    <Loader2 className="w-3.5 h-3.5 shrink-0 text-cyan-400 animate-spin" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border border-slate-700 shrink-0" />
                  )}
                  <span className="truncate">{st.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
