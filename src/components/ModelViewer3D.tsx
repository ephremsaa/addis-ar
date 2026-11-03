import React, { useEffect, useRef, useState } from 'react';
import {
  Download,
  Eye,
  RotateCcw,
  Cloud,
  Check,
  Loader2,
  Sparkles,
  CheckCircle2,
  Box,
  Wand2,
  Layers,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { uploadGlbToSupabase } from '../lib/supabase-client';
import type { CapturedPhoto, UserPointCorrection } from '../types/scanner';
import { MaskCorrectionModal } from './MaskCorrectionModal';

interface ModelViewer3DProps {
  glbUrl: string;
  glbBlob: Blob;
  photos: CapturedPhoto[];
  stats?: { vertices: number; triangles: number; fileSizeMb: number };
  onRescan: () => void;
  onReconstructWithUpdatedPhotos?: (updatedPhotos: CapturedPhoto[]) => void;
}

export const ModelViewer3D: React.FC<ModelViewer3DProps> = ({
  glbUrl,
  glbBlob,
  photos,
  stats = { vertices: 1420, triangles: 2840, fileSizeMb: 1.2 },
  onRescan,
  onReconstructWithUpdatedPhotos,
}) => {
  const modelViewerRef = useRef<HTMLElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [cloudUrl, setCloudUrl] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  // Mask Correction State
  const [isFixModalOpen, setIsFixModalOpen] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [allPhotos, setAllPhotos] = useState<CapturedPhoto[]>(photos);

  useEffect(() => {
    setAllPhotos(photos);
  }, [photos]);

  // Trigger celebratory confetti burst on load
  useEffect(() => {
    confetti({
      particleCount: 70,
      spread: 60,
      origin: { y: 0.6 },
      colors: ['#22d3ee', '#10b981', '#38bdf8', '#f59e0b'],
    });
  }, []);

  // Download .GLB file directly to mobile / desktop storage
  const handleDownloadGlb = () => {
    const filename = `addis_ar_model_${Date.now()}.glb`;
    const a = document.createElement('a');
    a.href = glbUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Launch Native AR (WebXR / Google Scene Viewer / iOS Quick Look)
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

  const handleSaveCorrection = (
    photoId: string,
    updatedMaskUrl: string,
    updatedSegUrl: string,
    corrections: UserPointCorrection[]
  ) => {
    const updated = allPhotos.map((p) =>
      p.id === photoId
        ? {
            ...p,
            maskDataUrl: updatedMaskUrl,
            segmentedDataUrl: updatedSegUrl,
            userCorrections: corrections,
          }
        : p
    );
    setAllPhotos(updated);

    if (onReconstructWithUpdatedPhotos) {
      onReconstructWithUpdatedPhotos(updated);
    }
  };

  return (
    <div className="relative w-full h-full bg-[#07090e] flex flex-col justify-between overflow-hidden select-none font-sans">
      {/* Dynamic Ambient Studio Vignette */}
      <div className="absolute w-96 h-96 rounded-full bg-cyan-500/10 blur-[130px] pointer-events-none top-1/4 left-1/2 -translate-x-1/2" />
      <div className="absolute w-80 h-80 rounded-full bg-emerald-500/10 blur-[120px] pointer-events-none bottom-10 left-10" />

      {/* 1. Top HUD Bar */}
      <header className="relative z-20 flex items-center justify-between px-4 pt-3 pb-2 mt-safe">
        {/* Rescan Button */}
        <button
          onClick={onRescan}
          className="glass-btn px-3.5 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-semibold text-slate-200"
        >
          <RotateCcw className="w-4 h-4 text-slate-400" />
          <span>New Scan</span>
        </button>

        {/* Ready Badge */}
        <div className="glass-pill px-3 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>Product Reconstructed</span>
        </div>

        {/* Cloud Upload Button */}
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
          <span>{cloudUrl ? 'Copied' : 'Cloud'}</span>
        </button>
      </header>

      {/* Cloud URL notification banner if uploaded */}
      {cloudUrl && (
        <div className="relative z-20 mx-4 px-3.5 py-2 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 backdrop-blur-xl flex items-center justify-between text-xs text-emerald-300 shadow-lg">
          <span className="truncate mr-2 font-mono text-[11px]">{cloudUrl}</span>
          <span className="font-bold text-emerald-400 shrink-0 text-[11px]">Link Copied!</span>
        </div>
      )}

      {/* 2. Interactive Google <model-viewer> Viewport */}
      <main className="relative z-10 flex-1 w-full h-full flex flex-col items-center justify-center p-2">
        {React.createElement('model-viewer', {
          ref: modelViewerRef,
          src: glbUrl,
          alt: '3D Scanned Product Model',
          ar: true,
          'ar-modes': 'webxr scene-viewer quick-look',
          'camera-controls': true,
          'touch-action': 'pan-y',
          'auto-rotate': true,
          'auto-rotate-delay': '800',
          'rotation-per-second': '28deg',
          'shadow-intensity': '1.3',
          'environment-image': 'neutral',
          exposure: '1.15',
          style: {
            width: '100%',
            height: '100%',
            outline: 'none',
          },
        })}

        {/* Floating Specs Pill (Polycount & Size) */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 glass-pill px-3 py-1 rounded-full flex items-center gap-2 text-[10px] text-slate-300 font-mono shadow-md pointer-events-none">
          <Box className="w-3 h-3 text-cyan-400" />
          <span>{stats.vertices.toLocaleString()} verts</span>
          <span className="text-slate-600">·</span>
          <span>{stats.triangles.toLocaleString()} polys</span>
          <span className="text-slate-600">·</span>
          <span className="text-emerald-400 font-semibold">{stats.fileSizeMb} MB .GLB</span>
        </div>

        {/* Floating Fix Cut-Out Button */}
        {allPhotos.length > 0 && (
          <button
            onClick={() => setIsFixModalOpen(true)}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 glass-btn px-4 py-2 rounded-full flex items-center gap-2 text-xs font-semibold text-cyan-300 shadow-xl border-cyan-400/40 hover:bg-cyan-500/20 active:scale-95 transition-all"
          >
            <Wand2 className="w-4 h-4 text-cyan-400" />
            <span>Fix the Cut-out (AI Refinement)</span>
          </button>
        )}
      </main>

      {/* 3. Bottom Modern Action Deck */}
      <footer className="relative z-20 flex flex-col gap-3 px-4 pb-6 mb-safe w-full">
        {/* Primary Dual Action Buttons */}
        <div className="flex gap-3 w-full">
          {/* Download .GLB Button */}
          <button
            onClick={handleDownloadGlb}
            className="flex-1 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.4)] active:scale-95 transition-all shimmer-btn"
          >
            <Download className="w-5 h-5" />
            <span>Download .GLB</span>
          </button>

          {/* Native Phone AR Button */}
          <button
            onClick={handleLaunchAR}
            className="flex-1 py-3.5 rounded-2xl bg-gradient-to-r from-sky-500 via-cyan-500 to-blue-600 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(14,165,233,0.4)] active:scale-95 transition-all"
          >
            <Eye className="w-5 h-5 text-white" />
            <span>View in AR</span>
          </button>
        </div>

        {/* Subtle Gesture Guidance micro-bar */}
        <div className="flex items-center justify-center gap-4 text-[10px] text-slate-400 font-medium">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/80" />
            Orbit: Drag
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" />
            Zoom: Pinch
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400/80" />
            Clean AI Mesh
          </span>
        </div>
      </footer>

      {/* Mask Correction & AI Teaching Modal */}
      <MaskCorrectionModal
        isOpen={isFixModalOpen}
        onClose={() => setIsFixModalOpen(false)}
        photo={allPhotos[selectedPhotoIndex] || null}
        onSaveCorrection={handleSaveCorrection}
      />
    </div>
  );
};
