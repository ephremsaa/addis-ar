import React, { useEffect, useRef, useState } from 'react';
import {
  Download,
  Eye,
  RotateCcw,
  Cloud,
  Check,
  Loader2,
  Sparkles,
  Box,
  Share2,
  AlertOctagon,
  Layers,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { uploadGlbToSupabase } from '../lib/supabase-client';
import { saveModelToIndexedDB, downloadGlbReliably } from '../lib/model-storage';

interface ModelViewer3DProps {
  glbUrl: string;
  glbBlob: Blob;
  stats?: { vertices: number; triangles: number; fileSizeMb: number };
  registeredRatio?: number;
  isDraftPreview?: boolean;
  onRescan: () => void;
}

export const ModelViewer3D: React.FC<ModelViewer3DProps> = ({
  glbUrl,
  glbBlob,
  stats = { vertices: 2400, triangles: 4800, fileSizeMb: 1.8 },
  registeredRatio,
  isDraftPreview = false,
  onRescan,
}) => {
  const modelViewerRef = useRef<HTMLElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [cloudUrl, setCloudUrl] = useState<string | null>(null);
  const [isSavedLocally, setIsSavedLocally] = useState(false);

  // Quality check: Reject if mesh is degenerate (< 150 vertices) or invalid
  const isFailedModel = stats.vertices < 150 || glbBlob.size < 500;

  useEffect(() => {
    if (!isFailedModel) {
      confetti({
        particleCount: 70,
        spread: 60,
        origin: { y: 0.6 },
        colors: ['#22d3ee', '#10b981', '#38bdf8', '#f59e0b'],
      });

      // Automatically persist to IndexedDB so model survives page reloads
      saveModelToIndexedDB({
        id: `model-${Date.now()}`,
        name: 'Product Scan',
        timestamp: Date.now(),
        blob: glbBlob,
        stats,
      }).then(() => setIsSavedLocally(true));
    }
  }, [isFailedModel, glbBlob, stats]);

  // Download .GLB with phone reliability (DOM append/cleanup & Web Share fallback)
  const handleDownload = async () => {
    const filename = `addis_ar_${Date.now()}.glb`;
    await downloadGlbReliably(glbBlob, filename);
  };

  // Launch Native Phone AR (Scene Viewer / WebXR / Quick Look)
  const handleLaunchAR = () => {
    if (modelViewerRef.current) {
      const mv = modelViewerRef.current as unknown as { activateAR?: () => void };
      if (typeof mv.activateAR === 'function') {
        mv.activateAR();
      }
    }
  };

  // Upload to Supabase Cloud
  const handleSaveToCloud = async () => {
    setIsUploading(true);
    const res = await uploadGlbToSupabase(glbBlob, 'product_scan');
    setIsUploading(false);
    if (res.success && res.publicUrl) {
      setCloudUrl(res.publicUrl);
    }
  };

  if (isFailedModel) {
    return (
      <div className="relative w-full h-full bg-[#07090e] flex flex-col items-center justify-center p-6 text-center select-none font-sans">
        <div className="w-16 h-16 rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 mb-4 shadow-xl">
          <AlertOctagon className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Scan Failed</h2>
        <p className="text-sm text-slate-300 max-w-xs mb-6">
          The 3D model was empty or degenerate ({stats.vertices} vertices).
          Please ensure the object is well-lit and record slowly with 360° coverage.
        </p>
        <button
          onClick={onRescan}
          className="px-6 py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-emerald-400 text-slate-950 font-bold text-sm flex items-center gap-2 shadow-lg active:scale-95 transition-all"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Re-record Video</span>
        </button>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-[#07090e] flex flex-col justify-between overflow-hidden select-none font-sans">
      {/* Background ambient lighting */}
      <div className="absolute w-96 h-96 rounded-full bg-cyan-500/10 blur-[130px] pointer-events-none top-1/4 left-1/2 -translate-x-1/2" />
      <div className="absolute w-80 h-80 rounded-full bg-emerald-500/10 blur-[120px] pointer-events-none bottom-10 left-10" />

      {/* 1. Top HUD Bar */}
      <header className="relative z-20 flex items-center justify-between px-4 pt-3 pb-2 mt-safe">
        <button
          onClick={onRescan}
          className="glass-btn px-3.5 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-semibold text-slate-200"
        >
          <RotateCcw className="w-4 h-4 text-slate-400" />
          <span>New Scan</span>
        </button>

        {/* Engine Badge */}
        {isDraftPreview ? (
          <div className="glass-pill px-3 py-1.5 rounded-full flex items-center gap-1 text-[11px] font-bold text-amber-300 border-amber-400/40">
            <Layers className="w-3.5 h-3.5 text-amber-400" />
            <span>⚡ Draft Preview</span>
          </div>
        ) : (
          <div className="glass-pill px-3 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-bold text-emerald-400 border-emerald-400/40">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>COLMAP Surface {registeredRatio ? `(${Math.round(registeredRatio * 100)}%)` : ''}</span>
          </div>
        )}

        {/* Cloud Upload */}
        <button
          onClick={handleSaveToCloud}
          disabled={isUploading}
          className={`glass-btn px-3.5 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-semibold ${
            cloudUrl ? 'text-emerald-400 border-emerald-400/50' : 'text-sky-300'
          }`}
          title="Save to Supabase Cloud"
        >
          {isUploading ? (
            <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
          ) : cloudUrl ? (
            <Check className="w-4 h-4 text-emerald-400" />
          ) : (
            <Cloud className="w-4 h-4 text-sky-400" />
          )}
          <span>{cloudUrl ? 'Saved' : 'Cloud'}</span>
        </button>
      </header>

      {/* 2. Interactive Google <model-viewer> Viewport */}
      <main className="relative z-10 flex-1 w-full h-full flex flex-col items-center justify-center p-2">
        {React.createElement('model-viewer', {
          ref: modelViewerRef,
          src: glbUrl,
          alt: '3D Photogrammetry Product Model',
          ar: true,
          'ar-modes': 'webxr scene-viewer quick-look',
          'camera-controls': true,
          'touch-action': 'pan-y',
          'auto-rotate': true,
          'auto-rotate-delay': '800',
          'rotation-per-second': '26deg',
          'shadow-intensity': '1.3',
          'environment-image': 'neutral',
          exposure: '1.15',
          style: {
            width: '100%',
            height: '100%',
            outline: 'none',
          },
        })}

        {/* Model Specs Pill */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 glass-pill px-3 py-1 rounded-full flex items-center gap-2 text-[10px] text-slate-300 font-mono shadow-md pointer-events-none">
          <Box className="w-3 h-3 text-cyan-400" />
          <span>{stats.vertices.toLocaleString()} verts</span>
          <span className="text-slate-600">·</span>
          <span>{stats.triangles.toLocaleString()} polys</span>
          <span className="text-slate-600">·</span>
          <span className="text-emerald-400 font-semibold">{stats.fileSizeMb} MB</span>
        </div>
      </main>

      {/* 3. Bottom Action Deck: Download & Native AR */}
      <footer className="relative z-20 flex flex-col gap-2.5 px-4 pb-6 mb-safe w-full">
        <div className="flex gap-2.5 w-full">
          {/* Download .GLB Button */}
          <button
            onClick={handleDownload}
            className="flex-1 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.4)] active:scale-95 transition-all shimmer-btn"
          >
            <Download className="w-4 h-4" />
            <span>Download .GLB</span>
          </button>

          {/* Native Phone AR Button */}
          <button
            onClick={handleLaunchAR}
            className="flex-1 py-3.5 rounded-2xl bg-gradient-to-r from-sky-500 via-cyan-500 to-blue-600 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(14,165,233,0.4)] active:scale-95 transition-all"
          >
            <Eye className="w-4 h-4 text-white" />
            <span>View in AR</span>
          </button>
        </div>

        {/* Local Persistence Status */}
        <p className="text-[10px] text-center text-slate-400 font-medium">
          {isSavedLocally
            ? '✓ Model cached in local device storage (persists on reload)'
            : 'Orbit: drag · Zoom: pinch · Pan: two fingers'}
        </p>
      </footer>
    </div>
  );
};
