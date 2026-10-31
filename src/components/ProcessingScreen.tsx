import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle, RefreshCw, Layers, CheckCircle2, Cpu, Sparkles } from 'lucide-react';
import { runColmapPipeline } from '../lib/colmap-client';
import { runClientReconstruction } from '../lib/client-reconstructor';
import type { CapturedPhoto, ScannerSettings } from '../types/scanner';

interface ProcessingScreenProps {
  photos: CapturedPhoto[];
  settings: ScannerSettings;
  onSuccess: (glbUrl: string, glbBlob: Blob, stats: { vertices: number; triangles: number; fileSizeMb: number }) => void;
  onRetry: () => void;
}

const STAGES = [
  { id: 'validate', label: '1. Validating 360° Angle Coverage' },
  { id: 'match', label: '2. Detecting Keypoints & Multi-View Overlap' },
  { id: 'poses', label: '3. Estimating 6DoF Camera Poses' },
  { id: 'cloud', label: '4. Triangulating Dense 3D Point Cloud' },
  { id: 'mesh', label: '5. Generating Watertight Surface Mesh' },
  { id: 'texture', label: '6. Projecting UV Photographic Texture' },
  { id: 'glb', label: '7. Packaging Production .GLB File' },
];

export const ProcessingScreen: React.FC<ProcessingScreenProps> = ({
  photos,
  settings,
  onSuccess,
  onRetry,
}) => {
  const [progress, setProgress] = useState(5);
  const [currentStage, setCurrentStage] = useState('Initializing');
  const [message, setMessage] = useState('Starting 3D reconstruction pipeline...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function execute() {
      try {
        setError(null);

        // Try COLMAP server if enabled, else use client-side generator
        if (settings.useColmapBackend && settings.colmapServerUrl) {
          try {
            const result = await runColmapPipeline(
              photos,
              settings.colmapServerUrl,
              (prog, stage, msg) => {
                if (!isCancelled) {
                  setProgress(prog);
                  setCurrentStage(stage);
                  setMessage(msg);
                }
              }
            );

            if (!isCancelled) {
              onSuccess(result.glbUrl, result.glbBlob, result.stats);
            }
            return;
          } catch (colmapErr) {
            console.warn('COLMAP backend unavailable, falling back to local photogrammetry:', colmapErr);
            setMessage('COLMAP server unavailable — falling back to client-side photogrammetry...');
          }
        }

        // Client-side photogrammetry engine
        const result = await runClientReconstruction(photos, (prog, stage, msg) => {
          if (!isCancelled) {
            setProgress(prog);
            setCurrentStage(stage);
            setMessage(msg);
          }
        });

        if (!isCancelled) {
          onSuccess(result.glbUrl, result.glbBlob, result.stats);
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          const errMsg = err instanceof Error ? err.message : 'Reconstruction failed';
          setError(errMsg);
        }
      }
    }

    execute();

    return () => {
      isCancelled = true;
    };
  }, [photos, settings, onSuccess]);

  return (
    <div className="relative w-full h-full bg-[#090d16] flex flex-col items-center justify-center p-6 text-center select-none overflow-hidden">
      {/* Background ambient glow */}
      <div className="absolute w-80 h-80 rounded-full bg-sky-500/10 blur-[100px] pointer-events-none" />
      <div className="absolute w-72 h-72 rounded-full bg-emerald-500/10 blur-[90px] pointer-events-none -bottom-10" />

      {error ? (
        /* Error Screen */
        <div className="relative z-10 glass-panel p-6 rounded-2xl max-w-sm w-full flex flex-col items-center gap-4 border-rose-500/30">
          <div className="w-14 h-14 rounded-full bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
            <AlertCircle className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Reconstruction Failed</h2>
            <p className="text-xs text-rose-300/90 mt-1 leading-relaxed">{error}</p>
          </div>
          <p className="text-[11px] text-slate-400 leading-normal">
            Ensure the object is well lit, stationary, and scanned with smooth 360° overlap.
          </p>
          <button
            onClick={onRetry}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-sky-500 to-emerald-400 text-slate-950 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Re-scan Product</span>
          </button>
        </div>
      ) : (
        /* Progress Screen */
        <div className="relative z-10 glass-panel p-6 rounded-3xl max-w-sm w-full flex flex-col items-center gap-5 shadow-2xl">
          {/* Animated 3D Spinning Hexagon / Cube */}
          <div className="relative w-24 h-24 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border-2 border-dashed border-sky-400/40 animate-spin" style={{ animationDuration: '8s' }} />
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-sky-500/30 to-emerald-400/20 border border-sky-400/50 flex items-center justify-center backdrop-blur-md shadow-[0_0_24px_rgba(56,189,248,0.3)]">
              <Sparkles className="w-8 h-8 text-sky-300 animate-pulse" />
            </div>
          </div>

          <div>
            <h2 className="text-base font-bold text-white tracking-wide">{currentStage}</h2>
            <p className="text-xs text-slate-300 mt-1">{message}</p>
          </div>

          {/* Progress Bar */}
          <div className="w-full flex flex-col gap-1.5">
            <div className="w-full h-2 rounded-full bg-slate-800/80 overflow-hidden border border-white/10 p-[1px]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-all duration-300 shadow-[0_0_10px_#38bdf8]"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] font-semibold text-slate-400 px-1">
              <span>{photos.length} angle photos</span>
              <span className="text-emerald-400 font-bold">{progress}%</span>
            </div>
          </div>

          {/* Photogrammetry Stage Checklist */}
          <div className="w-full flex flex-col gap-1.5 text-left pt-2 border-t border-white/10">
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
                      ? 'text-sky-300 font-semibold'
                      : 'text-slate-500'
                  }`}
                >
                  {isDone ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                  ) : isCurrent ? (
                    <Loader2 className="w-3.5 h-3.5 shrink-0 text-sky-400 animate-spin" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border border-slate-600 shrink-0" />
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
