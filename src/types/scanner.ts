export type HeightLevel = 'low' | 'mid' | 'top';

export type ProductShape = 'box' | 'cylinder' | 'auto';

export interface AngleSector {
  id: string; // e.g. "mid-0", "top-30", "low-60"
  azimuthIndex: number; // 0..11 (each 30 degrees)
  azimuthCenter: number; // 0, 30, 60, ..., 330
  heightLevel: HeightLevel; // 'low' (0-20°), 'mid' (20-50°), 'top' (50-85°)
  label: string;
  isCovered: boolean;
  capturedAt?: number;
  photoId?: string;
}

export interface CapturedPhoto {
  id: string;
  dataUrl: string;
  thumbnailUrl: string;
  blob: Blob;
  timestamp: number;
  azimuth: number; // 0..360°
  elevation: number; // 0..90°
  sectorId: string;
  sharpness: number;
  brightness: number;
}

export interface LiveGuidance {
  tip: string;
  type: 'info' | 'warning' | 'success';
  suggestedAction: string;
}

export interface ScannerSettings {
  colmapServerUrl: string;
  autoCapture: boolean;
  motionSensitivity: number; // 1 (sensitive) to 5 (strict)
  hapticFeedback: boolean;
  minCoveragePercent: number; // default 100% (or 75% for quick scans)
  useColmapBackend: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
  productShape?: ProductShape;
}

export interface ReconstructionJob {
  id: string;
  status: 'idle' | 'uploading' | 'processing' | 'completed' | 'failed';
  progress: number;
  stage: string;
  message: string;
  glbUrl?: string;
  glbBlob?: Blob;
  vertexCount?: number;
  triangleCount?: number;
  fileSizeMb?: number;
  error?: string;
}
