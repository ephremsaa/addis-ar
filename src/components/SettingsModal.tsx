import React, { useState } from 'react';
import { X, Server, Check, AlertCircle, Sparkles, Sliders, Database, Smartphone } from 'lucide-react';
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
    const res = await checkColmapHealth(formData.colmapServerUrl);
    setIsTesting(false);
    if (res.online) {
      setTestResult({ ok: true, message: `Connected! Engine: ${res.engine}` });
    } else {
      setTestResult({ ok: false, message: res.message || 'Cannot reach server' });
    }
  };

  const handleSave = () => {
    onSave(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md select-none">
      <div className="glass-panel w-full max-w-sm rounded-3xl p-5 flex flex-col gap-4 shadow-2xl border-white/15 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-sky-400" />
            <h2 className="text-sm font-bold text-white tracking-wide">Scanner Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full glass-btn flex items-center justify-center text-slate-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 1. Photogrammetry Engine Selection */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-slate-300">Reconstruction Engine</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setFormData({ ...formData, useColmapBackend: false })}
              className={`p-2.5 rounded-xl border text-left text-xs transition-all ${
                !formData.useColmapBackend
                  ? 'border-sky-400 bg-sky-500/20 text-sky-300 font-bold'
                  : 'border-white/10 bg-slate-900/60 text-slate-400'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5" />
                <span>In-Browser</span>
              </div>
              <span className="text-[10px] text-slate-400 block mt-0.5">Offline · Instant</span>
            </button>

            <button
              type="button"
              onClick={() => setFormData({ ...formData, useColmapBackend: true })}
              className={`p-2.5 rounded-xl border text-left text-xs transition-all ${
                formData.useColmapBackend
                  ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300 font-bold'
                  : 'border-white/10 bg-slate-900/60 text-slate-400'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5" />
                <span>COLMAP Server</span>
              </div>
              <span className="text-[10px] text-slate-400 block mt-0.5">High-Res · Python</span>
            </button>
          </div>
        </div>

        {/* 2. COLMAP Server Endpoint Input */}
        {formData.useColmapBackend && (
          <div className="flex flex-col gap-1.5 bg-slate-900/60 p-3 rounded-2xl border border-white/10">
            <label className="text-[11px] font-semibold text-slate-300">COLMAP Server URL</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={formData.colmapServerUrl}
                onChange={(e) => {
                  setFormData({ ...formData, colmapServerUrl: e.target.value });
                  setTestResult(null);
                }}
                placeholder="http://localhost:8000"
                className="flex-1 bg-black/50 border border-white/15 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-400"
              />
              <button
                type="button"
                onClick={handleTestServer}
                disabled={isTesting}
                className="px-3 py-1.5 rounded-xl bg-sky-500 text-slate-950 text-xs font-bold shrink-0 disabled:opacity-50"
              >
                {isTesting ? 'Testing…' : 'Test'}
              </button>
            </div>
            {testResult && (
              <p
                className={`text-[11px] font-medium mt-1 ${
                  testResult.ok ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {testResult.message}
              </p>
            )}
            <p className="text-[10px] text-slate-400 leading-normal mt-0.5">
              Start with: <code className="text-sky-300">python server/photogrammetry_server.py</code>
            </p>
          </div>
        )}

        {/* 3. Auto-Capture & Haptic Switches */}
        <div className="flex flex-col gap-3 py-1 border-t border-white/10 pt-3">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs font-medium text-slate-200">Auto-Capture when Angle is Sharp</span>
            <input
              type="checkbox"
              checked={formData.autoCapture}
              onChange={(e) => setFormData({ ...formData, autoCapture: e.target.checked })}
              className="w-4 h-4 accent-sky-400"
            />
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs font-medium text-slate-200">Haptic Vibration on Angle Scanned</span>
            <input
              type="checkbox"
              checked={formData.hapticFeedback}
              onChange={(e) => setFormData({ ...formData, hapticFeedback: e.target.checked })}
              className="w-4 h-4 accent-sky-400"
            />
          </label>
        </div>

        {/* 4. Supabase Cloud Storage (Optional) */}
        <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
            <Database className="w-3.5 h-3.5 text-emerald-400" />
            <span>Supabase Cloud Storage (Optional)</span>
          </div>
          <input
            type="text"
            value={formData.supabaseUrl}
            onChange={(e) => setFormData({ ...formData, supabaseUrl: e.target.value })}
            placeholder="Supabase URL (https://xyz.supabase.co)"
            className="w-full bg-black/50 border border-white/15 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-400"
          />
          <input
            type="password"
            value={formData.supabaseAnonKey}
            onChange={(e) => setFormData({ ...formData, supabaseAnonKey: e.target.value })}
            placeholder="Supabase Anon Key"
            className="w-full bg-black/50 border border-white/15 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-400"
          />
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          className="w-full py-3 rounded-2xl bg-gradient-to-r from-sky-400 to-emerald-400 text-slate-950 font-bold text-xs uppercase tracking-wider shadow-lg active:scale-95 transition-all mt-1"
        >
          Save & Apply
        </button>
      </div>
    </div>
  );
};

