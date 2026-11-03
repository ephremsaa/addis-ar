import React, { useState, useRef, useEffect } from 'react';
import { X, Check, Undo, PlusCircle, MinusCircle, Sparkles, RefreshCw, Layers } from 'lucide-react';
import type { CapturedPhoto, UserPointCorrection } from '../types/scanner';
import { aiSegmenter } from '../lib/ai-segmenter';
import { saveCorrectionToDataset } from '../lib/scan-history';

interface MaskCorrectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  photo: CapturedPhoto | null;
  onSaveCorrection: (photoId: string, updatedMaskUrl: string, updatedSegUrl: string, corrections: UserPointCorrection[]) => void;
}

export const MaskCorrectionModal: React.FC<MaskCorrectionModalProps> = ({
  isOpen,
  onClose,
  photo,
  onSaveCorrection,
}) => {
  const [prompts, setPrompts] = useState<UserPointCorrection[]>([]);
  const [promptMode, setPromptMode] = useState<'positive' | 'negative'>('positive');
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewSegUrl, setPreviewSegUrl] = useState<string | null>(null);
  const [previewMaskUrl, setPreviewMaskUrl] = useState<string | null>(null);
  const [showMaskOnly, setShowMaskOnly] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (photo) {
      setPrompts(photo.userCorrections || []);
      setPreviewSegUrl(photo.segmentedDataUrl || photo.dataUrl);
      setPreviewMaskUrl(photo.maskDataUrl || null);
    }
  }, [photo]);

  if (!isOpen || !photo) return null;

  // Handle tap on image
  const handleImageClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || isProcessing) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    const newPrompt: UserPointCorrection = {
      x,
      y,
      isPositive: promptMode === 'positive',
    };

    const updatedPrompts = [...prompts, newPrompt];
    setPrompts(updatedPrompts);

    // Live re-segmentation with user correction prompt
    setIsProcessing(true);
    try {
      const res = await aiSegmenter.segmentPhoto(photo.dataUrl, updatedPrompts);
      setPreviewSegUrl(res.segmentedDataUrl);
      setPreviewMaskUrl(res.maskDataUrl);
    } catch (err) {
      console.error('Correction re-segmentation failed:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUndo = async () => {
    if (prompts.length === 0) return;
    const updated = prompts.slice(0, -1);
    setPrompts(updated);

    setIsProcessing(true);
    try {
      const res = await aiSegmenter.segmentPhoto(photo.dataUrl, updated);
      setPreviewSegUrl(res.segmentedDataUrl);
      setPreviewMaskUrl(res.maskDataUrl);
    } catch (err) {
      console.error('Undo re-segmentation failed:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApply = async () => {
    if (previewSegUrl && previewMaskUrl) {
      onSaveCorrection(photo.id, previewMaskUrl, previewSegUrl, prompts);
      // Asynchronously upload to Supabase dataset for AI fine-tuning
      saveCorrectionToDataset(photo.dataUrl, previewMaskUrl, prompts).catch(() => {});
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/85 backdrop-blur-xl select-none font-sans">
      <div className="glass-panel w-full max-w-md rounded-3xl p-4 flex flex-col gap-3.5 shadow-2xl border-white/15 max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">Fix Cut-out Mask</h2>
              <p className="text-[10px] text-slate-400">Tap image to teach the AI what to keep or remove</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full glass-btn flex items-center justify-center text-slate-300 active:scale-90"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Selector (Positive Keep vs Negative Remove) */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPromptMode('positive')}
            className={`flex-1 py-2 px-3 rounded-xl border flex items-center justify-center gap-1.5 text-xs font-semibold transition-all ${
              promptMode === 'positive'
                ? 'bg-emerald-500/25 border-emerald-400 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
                : 'border-white/10 bg-slate-900/60 text-slate-400'
            }`}
          >
            <PlusCircle className="w-4 h-4 text-emerald-400" />
            <span>Keep as Product</span>
          </button>

          <button
            onClick={() => setPromptMode('negative')}
            className={`flex-1 py-2 px-3 rounded-xl border flex items-center justify-center gap-1.5 text-xs font-semibold transition-all ${
              promptMode === 'negative'
                ? 'bg-rose-500/25 border-rose-400 text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.3)]'
                : 'border-white/10 bg-slate-900/60 text-slate-400'
            }`}
          >
            <MinusCircle className="w-4 h-4 text-rose-400" />
            <span>Remove as Background</span>
          </button>
        </div>

        {/* Interactive Canvas Viewport */}
        <div
          ref={containerRef}
          onClick={handleImageClick}
          className="relative w-full aspect-square rounded-2xl overflow-hidden bg-slate-950 border border-white/15 cursor-crosshair flex items-center justify-center shadow-inner"
        >
          {/* Base Image / Cutout Preview */}
          {showMaskOnly ? (
            <img
              src={previewMaskUrl || photo.dataUrl}
              alt="Binary Mask"
              className="w-full h-full object-contain pointer-events-none"
            />
          ) : (
            <img
              src={previewSegUrl || photo.dataUrl}
              alt="Segmented Product"
              className="w-full h-full object-contain pointer-events-none"
            />
          )}

          {/* User Prompt Pins */}
          {prompts.map((p, idx) => (
            <div
              key={idx}
              className={`absolute w-5 h-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-bold text-white shadow-lg pointer-events-none ${
                p.isPositive ? 'bg-emerald-500' : 'bg-rose-500'
              }`}
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
            >
              {p.isPositive ? '+' : '-'}
            </div>
          ))}

          {/* Processing Overlay */}
          {isProcessing && (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center gap-2 text-cyan-300 text-xs font-semibold">
              <RefreshCw className="w-5 h-5 animate-spin" />
              <span>Applying AI Correction...</span>
            </div>
          )}
        </div>

        {/* Tools bar: Toggle Mask View & Undo */}
        <div className="flex items-center justify-between text-xs text-slate-300">
          <button
            onClick={() => setShowMaskOnly((v) => !v)}
            className="flex items-center gap-1.5 glass-btn px-3 py-1.5 rounded-xl text-[11px]"
          >
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span>{showMaskOnly ? 'Show Full Color' : 'Show Binary Mask'}</span>
          </button>

          {prompts.length > 0 && (
            <button
              onClick={handleUndo}
              className="flex items-center gap-1 glass-btn px-3 py-1.5 rounded-xl text-[11px] text-amber-300"
            >
              <Undo className="w-3.5 h-3.5" />
              <span>Undo Point ({prompts.length})</span>
            </button>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex gap-2.5 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-2xl glass-btn text-slate-300 font-semibold text-xs active:scale-95"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 font-bold text-xs uppercase tracking-wider shadow-lg active:scale-95 shimmer-btn flex items-center justify-center gap-1.5"
          >
            <Check className="w-4 h-4 text-slate-950" />
            <span>Apply Fix</span>
          </button>
        </div>
      </div>
    </div>
  );
};

