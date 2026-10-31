import React, { useState, useEffect } from 'react';
import { CameraScanner } from './components/CameraScanner';
import { ProcessingScreen } from './components/ProcessingScreen';
import { ModelViewer3D } from './components/ModelViewer3D';
import { SettingsModal } from './components/SettingsModal';
import type { CapturedPhoto, ScannerSettings } from './types/scanner';

const DEFAULT_SETTINGS: ScannerSettings = {
  colmapServerUrl: 'http://localhost:8000',
  autoCapture: true,
  motionSensitivity: 2,
  hapticFeedback: true,
  minCoveragePercent: 100,
  useColmapBackend: false, // In-browser by default for instant zero-setup mobile demo, toggleable to COLMAP
  supabaseUrl: '',
  supabaseAnonKey: '',
};

export const App: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<'camera' | 'processing' | 'viewer'>('camera');
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhoto[]>([]);
  const [glbResult, setGlbResult] = useState<{
    url: string;
    blob: Blob;
    stats: { vertices: number; triangles: number; fileSizeMb: number };
  } | null>(null);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<ScannerSettings>(() => {
    try {
      const saved = localStorage.getItem('addis_ar_scanner_settings');
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const handleSaveSettings = (newSettings: ScannerSettings) => {
    setSettings(newSettings);
    try {
      localStorage.setItem('addis_ar_scanner_settings', JSON.stringify(newSettings));
    } catch (e) {
      console.warn('Could not save settings:', e);
    }
  };

  const handleFinishScan = (photos: CapturedPhoto[]) => {
    if (photos.length < 3) return;
    setCapturedPhotos(photos);
    setCurrentScreen('processing');
  };

  const handleProcessingSuccess = (
    url: string,
    blob: Blob,
    stats: { vertices: number; triangles: number; fileSizeMb: number }
  ) => {
    setGlbResult({ url, blob, stats });
    setCurrentScreen('viewer');
  };

  const handleRescan = () => {
    if (glbResult?.url) {
      URL.revokeObjectURL(glbResult.url);
    }
    setGlbResult(null);
    setCapturedPhotos([]);
    setCurrentScreen('camera');
  };

  return (
    <div className="w-full h-full bg-[#090d16] text-white overflow-hidden relative font-sans">
      {currentScreen === 'camera' && (
        <CameraScanner
          onFinishScan={handleFinishScan}
          onOpenSettings={() => setIsSettingsOpen(true)}
          settings={settings}
        />
      )}

      {currentScreen === 'processing' && (
        <ProcessingScreen
          photos={capturedPhotos}
          settings={settings}
          onSuccess={handleProcessingSuccess}
          onRetry={handleRescan}
        />
      )}

      {currentScreen === 'viewer' && glbResult && (
        <ModelViewer3D
          glbUrl={glbResult.url}
          glbBlob={glbResult.blob}
          stats={glbResult.stats}
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
