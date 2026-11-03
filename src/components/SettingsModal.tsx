import React, { useState } from 'react';
import {
  X,
  Server,
  Sparkles,
  SlidersHorizontal,
  Database,
  Smartphone,
  Cpu,
  CheckCircle2,
} from 'lucide-react';
import { checkAiServerHealth } from '../lib/ai-3d-client';
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

  const handleTestAiServer = async () => {
    setIsTesting(true);
    setTestResult(null);
    const ok = await checkAiServerHealth(formData.aiServerUrl);
    setIsTesting(false);
    if (ok) {
      setTestResult({ ok: true, message: 'Connected to GPU AI 3D Server! (Online)' });
    } else {
      setTestResult({
        ok: false,
        message: 'Cannot reach server · Will use On-Device Neural Engine',
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
            <h2 className="text-sm font-bold text-white tracking-tight">Studio & AI Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full glass-btn flex items-center justify-center text-slate-300 active:scale-90"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 1. Multi-View AI 3D Model Selection */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-slate-300">Multi-View 3D Model</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setFormData({ ...formData, preferredModel: 'trellis' })}
              className={`p-2.5 rounded-2xl border text-left text-xs transition-all ${
                formData.preferredModel === 'trellis'
                  ? 'border-cyan-400/80 bg-cyan-500/20 text-cyan-200 font-bold shadow-[0_0_12px_rgba(34,211,238,0.25)]'
                  : 'border-white/10 bg-slate-900/60 text-slate-400'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                <span>TRELLIS</span>
              </div>
              <span className="text-[10px] text-slate-400 block mt-0.5">High Fidelity · MIT</span>
            </button>

            <button
              type="button"
              onClick={() => setFormData({ ...formData, preferredModel: 'hunyuan3d' })}
              className={`p-2.5 rounded-2xl border text-left text-xs transition-all ${
                formData.preferredModel === 'hunyuan3d'
                  ? 'border-emerald-400/80 bg-emerald-500/20 text-emerald-200 font-bold shadow-[0_0_12px_rgba(16,185,129,0.25)]'
                  : 'border-white/10 bg-slate-900/60 text-slate-400'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                <span>Hunyuan3D-2</span>
              </div>
              <span className="text-[10px] text-slate-400 block mt-0.5">Texture Synthesis</span>
            </button>
          </div>
        </div>

        {/* 2. Python FastAPI GPU Server URL */}
        <div className="flex flex-col gap-1.5 bg-slate-900/60 p-3.5 rounded-2xl border border-white/10">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold text-slate-300">GPU AI Server URL</label>
            <span className="text-[9px] text-cyan-400">Modal / RunPod / Local</span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={formData.aiServerUrl}
              onChange={(e) => {
                setFormData({ ...formData, aiServerUrl: e.target.value });
                setTestResult(null);
              }}
              placeholder="http://localhost:8000"
              className="flex-1 bg-black/50 border border-white/15 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-400 font-mono"
            />
            <button
              type="button"
              onClick={handleTestAiServer}
              disabled={isTesting}
              className="px-3.5 py-1.5 rounded-xl bg-cyan-400 text-slate-950 text-xs font-bold shrink-0 disabled:opacity-50"
            >
              {isTesting ? 'Testing…' : 'Test'}
            </button>
          </div>
          {testResult && (
            <p
              className={`text-[10px] font-medium mt-1 ${
                testResult.ok ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {testResult.message}
            </p>
          )}
        </div>

        {/* 3. Number of Candidate Generations */}
        <div className="flex items-center justify-between py-1">
          <div>
            <span className="text-xs font-semibold text-slate-200 block">Candidate Predictions</span>
            <span className="text-[10px] text-slate-400">Runs multiple seeds & picks highest match</span>
          </div>
          <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/10">
            {[3, 4].map((cnt) => (
              <button
                key={cnt}
                type="button"
                onClick={() => setFormData({ ...formData, candidateCount: cnt })}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                  formData.candidateCount === cnt
                    ? 'bg-cyan-400 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {cnt}x
              </button>
            ))}
          </div>
        </div>

        {/* 4. Auto-Capture & Haptic Switches */}
        <div className="flex flex-col gap-3 py-1 border-t border-white/10 pt-3">
          <div
            onClick={() => setFormData({ ...formData, autoCapture: !formData.autoCapture })}
            className="flex items-center justify-between cursor-pointer"
          >
            <div>
              <span className="text-xs font-semibold text-slate-200 block">Auto-Capture Steady Angles</span>
              <span className="text-[10px] text-slate-400">Captures when phone matches angle</span>
            </div>
            <div
              className={`w-11 h-6 rounded-full transition-colors relative p-0.5 ${
                formData.autoCapture ? 'bg-emerald-500' : 'bg-slate-700'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white transition-transform ${
                  formData.autoCapture ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </div>
          </div>

          <div
            onClick={() => setFormData({ ...formData, hapticFeedback: !formData.hapticFeedback })}
            className="flex items-center justify-between cursor-pointer"
          >
            <div>
              <span className="text-xs font-semibold text-slate-200 block">Haptic Vibration on Angle</span>
              <span className="text-[10px] text-slate-400">Tactile pulse for each captured angle</span>
            </div>
            <div
              className={`w-11 h-6 rounded-full transition-colors relative p-0.5 ${
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
