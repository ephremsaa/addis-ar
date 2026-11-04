import React, { useState, useEffect } from 'react';
import { CameraScanner } from './components/CameraScanner';
import { ProcessingScreen, type PhotogrammetryResult } from './components/ProcessingScreen';
import { ModelViewer3D } from './components/ModelViewer3D';
import { SettingsModal } from './components/SettingsModal';
import { getLastStoredModel } from './lib/model-storage';
import type { ExtractedFrame } from './lib/video-extractor';
import type { ScannerSettings, ProductShape } from './types/scanner';

const DEFAULT_SETTINGS: ScannerSettings = {
  colmapServerUrl: 'http://localhost:8000',
  aiServerUrl: 'http://localhost:8000',
  autoCapture: true,
  motionSensitivity: 2,
  hapticFeedback: true,
  minCoveragePercent: 100,
  useColmapBackend: true, // Primary: Real server photogrammetry
  useAi3dBackend: false,
  isTurntableMode: false,
  usePreviewDraftOnly: false,
  preferredModel: 'trellis',
  candidateCount: 4,
  supabaseUrl: '',
  supabaseAnonKey: '',
};

export const App: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<'camera' | 'processing' | 'viewer'>('camera');
  const [recordedFrames, setRecordedFrames] = useState<ExtractedFrame[]>([]);
  const [isTurntableScan, setIsTurntableScan] = useState(false);
  const [activeModel, setActiveModel] = useState<PhotogrammetryResult | null>(null);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<ScannerSettings>(() => {
    try {
      const saved = localStorage.getItem('addis_ar_scanner_settings');
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  // On initial mount, check if there's a cached model from IndexedDB
  useEffect(() => {
    async function restoreCachedModel() {
      const last = await getLastStoredModel();
      if (last && last.blob) {
        const url = URL.createObjectURL(last.blob);
        setActiveModel({
          glbBlob: last.blob,
          glbUrl: url,
          stats: last.stats,
          isDraftPreview: false,
        });
      }
    }
    restoreCachedModel();
  }, []);

  const handleSaveSettings = (newSettings: ScannerSettings) => {
    setSettings(newSettings);
    try {
      localStorage.setItem('addis_ar_scanner_settings', JSON.stringify(newSettings));
    } catch (e) {
      console.warn('Could not save settings:', e);
    }
  };

  const handleFinishRecording = (
    frames: ExtractedFrame[],
    shape: ProductShape = 'auto',
    isTurntable: boolean = false
  ) => {
    if (frames.length < 10) return;
    setRecordedFrames(frames);
    setIsTurntableScan(isTurntable);
    setCurrentScreen('processing');
  };

  const handleProcessingSuccess = (result: PhotogrammetryResult) => {
    setActiveModel(result);
    setCurrentScreen('viewer');
  };

  const handleRescan = () => {
    setRecordedFrames([]);
    setCurrentScreen('camera');
  };

  return (
    <div className="w-full h-full bg-[#090d16] text-white overflow-hidden relative font-sans">
      {currentScreen === 'camera' && (
        <CameraScanner
          onFinishRecording={handleFinishRecording}
          onOpenSettings={() => setIsSettingsOpen(true)}
          settings={settings}
        />
      )}

      {currentScreen === 'processing' && (
        <ProcessingScreen
          frames={recordedFrames}
          settings={settings}
          isTurntable={isTurntableScan}
          onSuccess={handleProcessingSuccess}
          onRetry={handleRescan}
        />
      )}

      {currentScreen === 'viewer' && activeModel && (
        <ModelViewer3D
          glbUrl={activeModel.glbUrl}
          glbBlob={activeModel.glbBlob}
          stats={activeModel.stats}
          registeredRatio={activeModel.registeredRatio}
          isDraftPreview={activeModel.isDraftPreview}
          onRescan={handleRescan}
        />
      )}

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={handleSaveSettings}
      />
    </div>
  );
};

export default App;
