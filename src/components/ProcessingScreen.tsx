import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle, RefreshCw, Layers, CheckCircle2, Cpu, Sparkles, Box } from 'lucide-react';
import { generate3DModelAi, type Ai3DGenerationResult } from '../lib/ai-3d-client';
import type { CapturedPhoto, ScannerSettings, ProductShape } from '../types/scanner';

interface ProcessingScreenProps {
  photos: CapturedPhoto[];
  settings: ScannerSettings;
  shape?: ProductShape;
  onSuccess: (result: Ai3DGenerationResult) => void;
  onRetry: () => void;
}

const STAGES = [
  { id: 'validate', label: '1. Validating 6-8 Guided Angle Views' },
  { id: 'masks', label: '2. AI Segmentation & Table Plane Removal' },
  { id: 'candidates', label: '3. Generating Multi-Candidate 3D Latents' },
  { id: 'reproject', label: '4. Re-projecting & Probability Match Scoring' },
  { id: 'winner', label: '5. Selecting Best Probability Candidate' },
  { id: 'texture', label: '6. Multi-View Photographic Texture Baking' },
  { id: 'glb', label: '7. Compressing & Exporting Binary .GLB' },
];

export const ProcessingScreen: React.FC<ProcessingScreenProps> = ({
  photos,
  settings,
  shape = 'auto',
  onSuccess,
  onRetry,
}) => {
  const [progress, setProgress] = useState(15);
  const [currentStage, setCurrentStage] = useState('Initializing Multi-View AI');
  const [message, setMessage] = useState('Analyzing captured views & sensor angles...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function execute() {
      try {
        setError(null);

        const result = await generate3DModelAi(
          photos,
          settings,
          (prog, msg) => {
            if (!isCancelled) {
              setProgress(prog);
              if (prog < 25) setCurrentStage('Validating Views');
              else if (prog < 50) setCurrentStage('AI Segmentation');
              else if (prog < 75) setCurrentStage('Generating Candidates');
              else if (prog < 90) setCurrentStage('Baking Textures');
              else setCurrentStage('Packaging GLB');
              setMessage(msg);
            }
          }
        );

        if (!isCancelled) {
          onSuccess(result);
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
    <div className="relative w-full h-full bg-[#07090e] flex flex-col items-center justify-center p-5 text-center select-none overflow-hidden font-sans">
      {/* Dynamic ambient background glow */}
      <div className="absolute w-96 h-96 rounded-full bg-cyan-500/10 blur-[130px] pointer-events-none" />
      <div className="absolute w-80 h-80 rounded-full bg-emerald-500/10 blur-[110px] pointer-events-none -bottom-10" />

      {error ? (
        /* Error Screen */
        <div className="relative z-10 glass-panel p-6 rounded-3xl max-w-sm w-full flex flex-col items-center gap-4 border-rose-500/40 shadow-2xl">
          <div className="w-14 h-14 rounded-full bg-rose-500/20 border border-rose-500/50 flex items-center justify-center text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.3)]">
            <AlertCircle className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Reconstruction Issue</h2>
            <p className="text-xs text-rose-300/90 mt-1.5 leading-relaxed font-mono">{error}</p>
          </div>
          <p className="text-[11px] text-slate-400 leading-normal">
            Ensure the object is stationary, evenly illuminated, and captured with steady 6-8 angle photos.
          </p>
          <button
            onClick={onRetry}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-sky-500 via-teal-400 to-emerald-400 text-slate-950 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all shimmer-btn"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Re-scan Product</span>
          </button>
        </div>
      ) : (
        /* Futuristic Progress Screen */
        <div className="relative z-10 glass-panel p-6 rounded-3xl max-w-sm w-full flex flex-col items-center gap-4.5 shadow-2xl border-white/15">
          {/* Holographic Gyroscopic 3D Rings */}
          <div className="relative w-24 h-24 flex items-center justify-center my-1">
            <div className="absolute inset-0 rounded-full border border-dashed border-cyan-400/50 animate-spin-slow" />
            <div
              className="absolute inset-2 rounded-full border border-emerald-400/40 animate-spin"
              style={{ animationDirection: 'reverse', animationDuration: '6s' }}
            />
            <div className="w-13 h-13 rounded-2xl bg-gradient-to-tr from-cyan-500/25 to-emerald-400/25 border border-cyan-400/60 flex items-center justify-center backdrop-blur-xl shadow-[0_0_24px_rgba(34,211,238,0.35)]">
              <Box className="w-6 h-6 text-cyan-300 animate-pulse" />
            </div>
          </div>

          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[10px] font-mono font-bold tracking-wider uppercase mb-1">
              <Sparkles className="w-3 h-3" />
              <span>Multi-View AI 3D Generation</span>
            </div>
            <h2 className="text-base font-bold text-white tracking-tight">{currentStage}</h2>
            <p className="text-xs text-slate-400 mt-1 font-mono text-[11px] truncate max-w-[280px]">
              {message}
            </p>
          </div>

          {/* Neon Progress Bar */}
          <div className="w-full flex flex-col gap-1.5">
            <div className="w-full h-2 rounded-full bg-slate-900/90 overflow-hidden border border-white/10 p-[1px]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400 transition-all duration-300 shadow-[0_0_12px_#22d3ee]"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] font-semibold text-slate-400 px-1 font-mono">
              <span>{photos.length} angle photos</span>
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
