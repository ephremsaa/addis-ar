import React, { useState } from 'react';
import { CameraScanner } from './components/CameraScanner';
import { ProcessingScreen } from './components/ProcessingScreen';
import { ModelViewer3D } from './components/ModelViewer3D';
import { SettingsModal } from './components/SettingsModal';
import type { Ai3DGenerationResult } from './lib/ai-3d-client';
import type { CapturedPhoto, ScannerSettings, ProductShape } from './types/scanner';

const DEFAULT_SETTINGS: ScannerSettings = {
  colmapServerUrl: 'http://localhost:8000',
  aiServerUrl: 'http://localhost:8000',
  autoCapture: true,
  motionSensitivity: 2,
  hapticFeedback: true,
  minCoveragePercent: 100,
  useColmapBackend: false,
  useAi3dBackend: true,
  preferredModel: 'trellis',
  candidateCount: 4,
  supabaseUrl: '',
  supabaseAnonKey: '',
};

export const App: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<'camera' | 'processing' | 'viewer'>('camera');
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhoto[]>([]);
  const [selectedShape, setSelectedShape] = useState<ProductShape>('auto');
  const [generationResult, setGenerationResult] = useState<Ai3DGenerationResult | null>(null);

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

  const handleFinishScan = (photos: CapturedPhoto[], shape: ProductShape = 'auto') => {
    if (photos.length < 3) return;
    setCapturedPhotos(photos);
    setSelectedShape(shape);
    setCurrentScreen('processing');
  };

  const handleProcessingSuccess = (result: Ai3DGenerationResult) => {
    setGenerationResult(result);
    setCurrentScreen('viewer');
  };

  const handleRescan = () => {
    if (generationResult?.glbUrl) {
      URL.revokeObjectURL(generationResult.glbUrl);
    }
    setGenerationResult(null);
    setCapturedPhotos([]);
    setCurrentScreen('camera');
  };

  const handleRetakeAngle = (slotId: string) => {
    // Switch to camera with intent to retake specific angle
    setCurrentScreen('camera');
  };

  const handleReconstructWithUpdatedPhotos = (updatedPhotos: CapturedPhoto[]) => {
    if (generationResult?.glbUrl) {
      URL.revokeObjectURL(generationResult.glbUrl);
    }
    setGenerationResult(null);
    setCapturedPhotos(updatedPhotos);
    setCurrentScreen('processing');
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
          shape={selectedShape}
          onSuccess={handleProcessingSuccess}
          onRetry={handleRescan}
        />
      )}

      {currentScreen === 'viewer' && generationResult && (
        <ModelViewer3D
          glbUrl={generationResult.glbUrl}
          glbBlob={generationResult.glbBlob}
          photos={capturedPhotos}
          matchScore={generationResult.matchScore}
          sideConfidences={generationResult.sideConfidences}
          modelName={generationResult.modelName}
          stats={generationResult.stats}
          onRescan={handleRescan}
          onRetakeAngle={handleRetakeAngle}
          onReconstructWithUpdatedPhotos={handleReconstructWithUpdatedPhotos}
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
