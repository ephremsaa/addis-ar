import React, { useState } from 'react';
import {
  X,
  Server,
  Sparkles,
  SlidersHorizontal,
  Disc3,
  Layers,
  Database,
  Smartphone,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { checkColmapHealth } from '../lib/colmap-client';
import type { ScannerSettings } from '../types/scanner';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ScannerSettings;
  onSave: (newSettings: ScannerSettings) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSave,
}) => {
  const [formData, setFormData] = useState<ScannerSettings>(settings);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  if (!isOpen) return null;

  const handleTestServer = async () => {
    setIsTesting(true);
    setTestResult(null);
    const health = await checkColmapHealth(formData.colmapServerUrl);
    setIsTesting(false);
    if (health.online) {
      setTestResult({
        ok: true,
        message: `Connected! Engine: ${health.engine}`,
      });
    } else {
      setTestResult({
        ok: false,
        message: health.message || 'Cannot reach server',
      });
    }
  };

  const handleSave = () => {
    onSave(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl select-none font-sans">
      <div className="glass-panel w-full max-w-sm rounded-3xl p-5 flex flex-col gap-4 shadow-2xl border-white/15 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-cyan-400" />
            <h2 className="text-sm font-bold text-white tracking-tight">Studio & Photogrammetry</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full glass-btn flex items-center justify-center text-slate-300 active:scale-90"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 1. Photogrammetry Server URL */}
        <div className="flex flex-col gap-1.5 bg-slate-900/60 p-3.5 rounded-2xl border border-white/10">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold text-slate-300">COLMAP Server URL</label>
            <span className="text-[9px] text-cyan-400 font-mono">Modal / RunPod / Local</span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={formData.colmapServerUrl}
              onChange={(e) => {
                setFormData({ ...formData, colmapServerUrl: e.target.value });
                setTestResult(null);
              }}
              placeholder="http://localhost:8000"
              className="flex-1 bg-black/50 border border-white/15 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-400 font-mono"
            />
            <button
              type="button"
              onClick={handleTestServer}
              disabled={isTesting}
              className="px-3.5 py-1.5 rounded-xl bg-cyan-400 text-slate-950 text-xs font-bold shrink-0 disabled:opacity-50"
            >
              {isTesting ? 'Testing…' : 'Test'}
            </button>
          </div>
          {testResult && (
            <p
              className={`text-[10px] font-medium mt-1 ${
                testResult.ok ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {testResult.message}
            </p>
          )}
        </div>

        {/* 2. Turntable Mode Toggle */}
        <div
          onClick={() => setFormData({ ...formData, isTurntableMode: !formData.isTurntableMode })}
          className="flex items-center justify-between cursor-pointer p-3 rounded-2xl bg-slate-900/40 border border-white/10"
        >
          <div className="flex items-center gap-2.5">
            <Disc3 className={`w-5 h-5 ${formData.isTurntableMode ? 'text-amber-400' : 'text-slate-400'}`} />
            <div>
              <span className="text-xs font-semibold text-slate-200 block">Turntable Mode</span>
              <span className="text-[10px] text-slate-400">Rotating plate with fixed phone stand</span>
            </div>
          </div>
          <div
            className={`w-11 h-6 rounded-full transition-colors relative p-0.5 ${
              formData.isTurntableMode ? 'bg-amber-500' : 'bg-slate-700'
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full bg-white transition-transform ${
                formData.isTurntableMode ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </div>
        </div>

        {/* 3. On-Device Draft Preview Mode (Kept clearly labeled) */}
        <div
          onClick={() =>
            setFormData({ ...formData, usePreviewDraftOnly: !formData.usePreviewDraftOnly })
          }
          className="flex items-center justify-between cursor-pointer p-3 rounded-2xl bg-slate-900/40 border border-white/10"
        >
          <div className="flex items-center gap-2.5">
            <Layers
              className={`w-5 h-5 ${formData.usePreviewDraftOnly ? 'text-cyan-400' : 'text-slate-400'}`}
            />
            <div>
              <span className="text-xs font-semibold text-slate-200 block">
                ⚡ On-Device Draft Preview
              </span>
              <span className="text-[10px] text-slate-400">
                Fast low-quality preview without server
              </span>
            </div>
          </div>
          <div
            className={`w-11 h-6 rounded-full transition-colors relative p-0.5 ${
              formData.usePreviewDraftOnly ? 'bg-cyan-500' : 'bg-slate-700'
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full bg-white transition-transform ${
                formData.usePreviewDraftOnly ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </div>
        </div>

        {/* 4. Haptic Feedback */}
        <div className="flex items-center justify-between py-1 border-t border-white/10 pt-3">
          <div>
            <span className="text-xs font-semibold text-slate-200 block">Haptic Vibration</span>
            <span className="text-[10px] text-slate-400">Tactile buzz on angle sector coverage</span>
          </div>
          <div
            onClick={() => setFormData({ ...formData, hapticFeedback: !formData.hapticFeedback })}
            className={`w-11 h-6 rounded-full transition-colors relative p-0.5 cursor-pointer ${
              formData.hapticFeedback ? 'bg-emerald-500' : 'bg-slate-700'
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full bg-white transition-transform ${
                formData.hapticFeedback ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </div>
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400 text-slate-950 font-bold text-xs uppercase tracking-wider shadow-lg active:scale-95 transition-all shimmer-btn mt-1"
        >
          Save & Apply
        </button>
      </div>
    </div>
  );
};
