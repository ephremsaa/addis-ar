import React, { useEffect, useRef, useState } from 'react';
import { Download, Eye, RotateCcw, Cloud, Check, Loader2, Sparkles, CheckCircle2 } from 'lucide-react';
import confetti from 'canvas-confetti';
import { uploadGlbToSupabase } from '../lib/supabase-client';

interface ModelViewer3DProps {
  glbUrl: string;
  glbBlob: Blob;
  stats?: { vertices: number; triangles: number; fileSizeMb: number };
  onRescan: () => void;
}

export const ModelViewer3D: React.FC<ModelViewer3DProps> = ({
  glbUrl,
  glbBlob,
  stats,
  onRescan,
}) => {
  const modelViewerRef = useRef<HTMLElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [cloudUrl, setCloudUrl] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  // Trigger celebration confetti on mount
  useEffect(() => {
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#38bdf8', '#10b981', '#f59e0b', '#ec4899'],
    });
  }, []);

  // Download .GLB file for mobile & desktop
  const handleDownloadGlb = () => {
    const filename = `addis_ar_scan_${Date.now()}.glb`;
    const a = document.createElement('a');
    a.href = glbUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Trigger Native Phone AR
  const handleLaunchAR = () => {
    if (modelViewerRef.current) {
      const mv = modelViewerRef.current as unknown as { activateAR?: () => void };
      if (typeof mv.activateAR === 'function') {
        mv.activateAR();
      }
    }
  };

  // Upload to Supabase Cloud Storage
  const handleSaveToCloud = async () => {
    setIsUploading(true);
    const res = await uploadGlbToSupabase(glbBlob, 'product_scan');
    setIsUploading(false);
    if (res.success && res.publicUrl) {
      setCloudUrl(res.publicUrl);
      if (navigator.clipboard) {
        navigator.clipboard.writeText(res.publicUrl);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 3000);
      }
    }
  };

  return (
    <div className="relative w-full h-full bg-[#090d16] flex flex-col justify-between overflow-hidden select-none">
      {/* 1. Top HUD Bar */}
      <header className="relative z-20 flex items-center justify-between px-4 pt-3 pb-2 mt-safe">
        {/* Rescan Button */}
        <button
          onClick={onRescan}
          className="glass-btn px-3 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-semibold text-slate-200"
        >
          <RotateCcw className="w-4 h-4" />
          <span>New Scan</span>
        </button>

        {/* Model Specs Pill */}
        <div className="glass-pill px-3 py-1.5 rounded-full flex items-center gap-2 text-xs font-semibold text-emerald-400">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>3D Model Ready</span>
        </div>

        {/* Cloud Upload Button */}
        <button
          onClick={handleSaveToCloud}
          disabled={isUploading}
          className={`glass-btn px-3 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-semibold ${
            cloudUrl ? 'text-emerald-400 border-emerald-400/40' : 'text-sky-300'
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
          <span>{cloudUrl ? 'Link Copied!' : 'Save Cloud'}</span>
        </button>
      </header>

      {/* Cloud URL notification banner if uploaded */}
      {cloudUrl && (
        <div className="relative z-20 mx-4 px-3 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-between text-[11px] text-emerald-300">
          <span className="truncate mr-2">Cloud URL: {cloudUrl}</span>
          <span className="font-bold text-emerald-400 shrink-0">Copied!</span>
        </div>
      )}

      {/* 2. Interactive Google <model-viewer> Container */}
      <main className="relative z-10 flex-1 w-full h-full flex items-center justify-center p-2">
        {/* Ambient lighting backdrop */}
        <div className="absolute w-72 h-72 rounded-full bg-sky-500/10 blur-[120px] pointer-events-none" />

        {React.createElement('model-viewer', {
          ref: modelViewerRef,
          src: glbUrl,
          alt: 'Scanned 3D Product Model',
          ar: true,
          'ar-modes': 'webxr scene-viewer quick-look',
          'camera-controls': true,
          'touch-action': 'pan-y',
          'auto-rotate': true,
          'auto-rotate-delay': '1000',
          'rotation-per-second': '30deg',
          'shadow-intensity': '1.2',
          'environment-image': 'neutral',
          exposure: '1.1',
          style: {
            width: '100%',
            height: '100%',
            outline: 'none',
          },
        })}
      </main>

      {/* 3. Bottom Action Bar */}
      <footer className="relative z-20 flex flex-col gap-2.5 px-4 pb-5 mb-safe w-full">
        {/* Primary Action Buttons */}
        <div className="flex gap-2.5 w-full">
          {/* Native AR Button */}
          <button
            onClick={handleLaunchAR}
            className="flex-1 py-3.5 rounded-2xl bg-gradient-to-r from-sky-500 to-sky-600 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-sky-500/25 active:scale-95 transition-all"
          >
            <Eye className="w-5 h-5" />
            <span>View in AR</span>
          </button>

          {/* Download .GLB Button */}
          <button
            onClick={handleDownloadGlb}
            className="flex-1 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-400 to-teal-500 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 active:scale-95 transition-all"
          >
            <Download className="w-5 h-5" />
            <span>Download .GLB</span>
          </button>
        </div>

        {/* Small Tips Footer */}
        <p className="text-center text-[10px] text-slate-400 font-medium">
          Drag to rotate · Pinch to zoom · Compatible with Blender, Three.js, and iOS/Android AR
        </p>
      </footer>
    </div>
  );
};
