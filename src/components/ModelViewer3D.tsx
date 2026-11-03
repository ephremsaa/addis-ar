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
  ThumbsUp,
  ThumbsDown,
  AlertOctagon,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { uploadGlbToSupabase } from '../lib/supabase-client';
import { sendScanRatingToBackend } from '../lib/ai-3d-client';
import type {
  CapturedPhoto,
  UserPointCorrection,
  SideConfidence,
} from '../types/scanner';
import { MaskCorrectionModal } from './MaskCorrectionModal';

interface ModelViewer3DProps {
  glbUrl: string;
  glbBlob: Blob;
  photos: CapturedPhoto[];
  matchScore?: number;
  sideConfidences?: SideConfidence[];
  modelName?: string;
  stats?: { vertices: number; triangles: number; fileSizeMb: number };
  onRescan: () => void;
  onRetakeAngle?: (slotId: string) => void;
  onReconstructWithUpdatedPhotos?: (updatedPhotos: CapturedPhoto[]) => void;
}

export const ModelViewer3D: React.FC<ModelViewer3DProps> = ({
  glbUrl,
  glbBlob,
  photos,
  matchScore = 93.5,
  sideConfidences = [],
  modelName = 'TRELLIS / Multi-View AI',
  stats = { vertices: 1420, triangles: 2840, fileSizeMb: 1.2 },
  onRescan,
  onRetakeAngle,
  onReconstructWithUpdatedPhotos,
}) => {
  const modelViewerRef = useRef<HTMLElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [cloudUrl, setCloudUrl] = useState<string | null>(null);
  const [userRating, setUserRating] = useState<'good' | 'bad' | null>(null);
  const [showConfidenceDrawer, setShowConfidenceDrawer] = useState(true);

  // Mask Correction Modal State
  const [isFixModalOpen, setIsFixModalOpen] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [allPhotos, setAllPhotos] = useState<CapturedPhoto[]>(photos);

  useEffect(() => {
    setAllPhotos(photos);
  }, [photos]);

  // Quality Gatekeeper: Detect bad / empty / uncarved models
  const isFailedModel = stats.vertices < 60 || matchScore < 45 || glbBlob.size < 800;

  useEffect(() => {
    if (!isFailedModel) {
      confetti({
        particleCount: 75,
        spread: 60,
        origin: { y: 0.6 },
        colors: ['#22d3ee', '#10b981', '#38bdf8', '#f59e0b'],
      });
    }
  }, [isFailedModel]);

  // Download .GLB directly to phone/desktop
  const handleDownloadGlb = () => {
    const filename = `addis_ar_${Date.now()}.glb`;
    const a = document.createElement('a');
    a.href = glbUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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

  // Handle User Rating & Improve Over Time
  const handleRate = async (rating: 'good' | 'bad') => {
    setUserRating(rating);
    await sendScanRatingToBackend(`scan-${Date.now()}`, rating);
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

  // 1. If Quality Check Failed: Show Clear Re-scan Diagnostic Screen
  if (isFailedModel) {
    return (
      <div className="relative w-full h-full bg-[#07090e] flex flex-col items-center justify-center p-6 text-center select-none font-sans">
        <div className="w-16 h-16 rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 mb-4 shadow-xl">
          <AlertOctagon className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Scan Quality Low</h2>
        <p className="text-sm text-slate-300 max-w-xs mb-6">
          The 3D model looks incomplete ({stats.vertices} vertices, {matchScore}% match). Please ensure the product is centered in good lighting and re-scan.
        </p>
        <button
          onClick={onRescan}
          className="px-6 py-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-emerald-400 text-slate-950 font-bold text-sm flex items-center gap-2 shadow-lg active:scale-95 transition-all"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Re-scan Product</span>
        </button>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-[#07090e] flex flex-col justify-between overflow-hidden select-none font-sans">
      {/* Ambient Vignette */}
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

        {/* Match Probability Score Pill */}
        <div className="glass-pill px-3.5 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-bold text-emerald-400 border-emerald-400/40 shadow-sm">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          <span>{matchScore}% Match</span>
        </div>

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

        {/* Specs Pill */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 glass-pill px-3 py-1 rounded-full flex items-center gap-2 text-[10px] text-slate-300 font-mono shadow-md pointer-events-none">
          <Box className="w-3 h-3 text-cyan-400" />
          <span>{stats.vertices.toLocaleString()} verts</span>
          <span className="text-slate-600">·</span>
          <span>{stats.triangles.toLocaleString()} polys</span>
          <span className="text-slate-600">·</span>
          <span className="text-emerald-400 font-semibold">{stats.fileSizeMb} MB</span>
        </div>

        {/* Fix Cut-out Refinement Button */}
        {allPhotos.length > 0 && (
          <button
            onClick={() => setIsFixModalOpen(true)}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 glass-btn px-3.5 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-semibold text-cyan-300 shadow-xl border-cyan-400/40 hover:bg-cyan-500/20 active:scale-95 transition-all"
          >
            <Wand2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>Refine AI Cut-out</span>
          </button>
        )}
      </main>

      {/* 3. Side Confidence Breakdown Drawer (Collapsible) */}
      {sideConfidences.length > 0 && (
        <div className="relative z-20 px-4 mb-2">
          <div className="glass-panel p-2.5 rounded-2xl border border-white/10 shadow-lg">
            <div
              className="flex items-center justify-between cursor-pointer"
              onClick={() => setShowConfidenceDrawer(!showConfidenceDrawer)}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-200">Angle Confidence</span>
                <span className="text-[10px] font-mono text-cyan-400">({modelName})</span>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-slate-400">
                <span>{showConfidenceDrawer ? 'Hide' : 'Show'}</span>
                {showConfidenceDrawer ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </div>
            </div>

            {showConfidenceDrawer && (
              <div className="grid grid-cols-3 gap-1.5 mt-2 max-h-36 overflow-y-auto no-scrollbar pt-1">
                {sideConfidences.map((side) => {
                  const isLow = side.confidence < 75;
                  return (
                    <div
                      key={side.slotId}
                      className={`px-2 py-1.5 rounded-xl border flex flex-col justify-between text-[10px] ${
                        side.isEstimated
                          ? 'bg-slate-900/60 border-slate-700/50'
                          : 'bg-emerald-500/10 border-emerald-500/30'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold truncate text-slate-300">{side.label}</span>
                        {isLow && onRetakeAngle && (
                          <button
                            onClick={() => onRetakeAngle(side.slotId)}
                            className="text-[9px] text-cyan-400 hover:underline flex items-center gap-0.5 ml-1"
                            title="Retake this angle"
                          >
                            <RefreshCw className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span
                          className={`font-mono font-bold ${
                            side.isEstimated ? 'text-amber-300' : 'text-emerald-400'
                          }`}
                        >
                          {side.confidence}%
                        </span>
                        {side.isEstimated && (
                          <span className="text-[8px] px-1 rounded bg-amber-500/20 text-amber-300">
                            estimated
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. Bottom Action Deck & Continuous Learning Rating */}
      <footer className="relative z-20 flex flex-col gap-2.5 px-4 pb-6 mb-safe w-full">
        {/* Download .GLB & Native AR Buttons */}
        <div className="flex gap-2.5 w-full">
          <button
            onClick={handleDownloadGlb}
            className="flex-1 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.4)] active:scale-95 transition-all shimmer-btn"
          >
            <Download className="w-4 h-4" />
            <span>Download .GLB</span>
          </button>

          <button
            onClick={handleLaunchAR}
            className="flex-1 py-3.5 rounded-2xl bg-gradient-to-r from-sky-500 via-cyan-500 to-blue-600 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(14,165,233,0.4)] active:scale-95 transition-all"
          >
            <Eye className="w-4 h-4 text-white" />
            <span>View in AR</span>
          </button>
        </div>

        {/* Continuous Learning Rating Bar */}
        <div className="flex items-center justify-between px-3 py-1.5 rounded-xl glass-panel text-xs text-slate-300">
          <span className="text-[11px] text-slate-400">Rate 3D accuracy:</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleRate('good')}
              className={`px-2.5 py-1 rounded-lg flex items-center gap-1 font-semibold text-[11px] transition-all ${
                userRating === 'good'
                  ? 'bg-emerald-400 text-slate-950 shadow'
                  : 'hover:text-emerald-400 text-slate-300'
              }`}
            >
              <ThumbsUp className="w-3.5 h-3.5" />
              <span>Good</span>
            </button>
            <button
              onClick={() => handleRate('bad')}
              className={`px-2.5 py-1 rounded-lg flex items-center gap-1 font-semibold text-[11px] transition-all ${
                userRating === 'bad'
                  ? 'bg-rose-500 text-white shadow'
                  : 'hover:text-rose-400 text-slate-300'
              }`}
            >
              <ThumbsDown className="w-3.5 h-3.5" />
              <span>Bad</span>
            </button>
          </div>
        </div>
      </footer>

      {/* Mask Correction Modal */}
      <MaskCorrectionModal
        isOpen={isFixModalOpen}
        onClose={() => setIsFixModalOpen(false)}
        photo={allPhotos[selectedPhotoIndex] || null}
        onSaveCorrection={handleSaveCorrection}
      />
    </div>
  );
};
