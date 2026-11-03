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

export interface CameraPose {
  position: [number, number, number]; // [x, y, z] in meters relative to product
  rotation: [number, number, number]; // [pitch, roll, yaw] in degrees
  quaternion: [number, number, number, number]; // [qx, qy, qz, qw]
  source: 'webxr' | 'sensor_fusion' | 'visual_odometry' | 'optical';
  distanceToProduct: number; // estimated distance in meters
}

export interface UserPointCorrection {
  x: number; // 0..1
  y: number; // 0..1
  isPositive: boolean; // true = keep, false = cut
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
  pose?: CameraPose;
  maskDataUrl?: string;
  maskBlob?: Blob;
  segmentedDataUrl?: string;
  userCorrections?: UserPointCorrection[];
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
  showLiveSegmentation?: boolean;
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
