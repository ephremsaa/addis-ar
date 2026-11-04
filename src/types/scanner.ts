export type HeightLevel = 'low' | 'mid' | 'top';

export type ProductShape = 'box' | 'cylinder' | 'auto';

export type TargetAngleId =
  | 'front'
  | 'front_right'
  | 'right'
  | 'back_right'
  | 'back'
  | 'back_left'
  | 'left'
  | 'top'
  | 'bottom';

export interface PhotoQualityScore {
  overall: number; // 0..100%
  sharpness: number; // 0..100%
  lighting: number; // 0..100%
  maskQuality: number; // 0..100%
  framing: number; // 0..100%
  uniqueness: number; // 0..100%
  isAcceptable: boolean; // >= 60%
  feedback: string;
  isPrimaryFront?: boolean;
}

export interface TargetAngleSlot {
  id: TargetAngleId;
  label: string;
  shortLabel: string;
  targetAzimuth: number; // 0, 45, 90, 135, 180, 225, 270
  targetElevation: number; // 0 (mid), 70 (top), -45 (bottom)
  isOptional: boolean;
  isCaptured: boolean;
  capturedPhotoId?: string;
  qualityScore?: PhotoQualityScore;
  confidence?: number;
  isEstimated?: boolean;
}

// Retain AngleSector for backward compatibility with radial HUD metrics
export interface AngleSector {
  id: string;
  azimuthIndex: number;
  azimuthCenter: number;
  heightLevel: HeightLevel;
  label: string;
  isCovered: boolean;
  capturedAt?: number;
  photoId?: string;
  qualityScore?: PhotoQualityScore;
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
  slotId?: TargetAngleId;
  sharpness: number;
  brightness: number;
  pose?: CameraPose;
  maskDataUrl?: string;
  maskBlob?: Blob;
  segmentedDataUrl?: string;
  croppedDataUrl?: string;
  userCorrections?: UserPointCorrection[];
  qualityScore?: PhotoQualityScore;
}

export interface LiveGuidance {
  tip: string;
  type: 'info' | 'warning' | 'success';
  suggestedAction: string;
}

export interface SideConfidence {
  slotId: TargetAngleId;
  label: string;
  confidence: number; // 0..100%
  isEstimated: boolean; // true if predicted by AI
  photoQuality?: number;
}

export interface CandidateEvaluation {
  seed: number;
  matchScore: number; // 0..100%
  isSelected: boolean;
}

export interface ScannerSettings {
  colmapServerUrl: string;
  aiServerUrl: string;
  autoCapture: boolean;
  motionSensitivity: number; // 1 (sensitive) to 5 (strict)
  hapticFeedback: boolean;
  minCoveragePercent: number;
  useColmapBackend: boolean;
  useAi3dBackend: boolean;
  isTurntableMode?: boolean;
  usePreviewDraftOnly?: boolean;
  preferredModel: 'trellis' | 'hunyuan3d' | 'instantmesh' | 'sf3d' | 'auto';
  candidateCount: number;
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
  matchScore?: number; // Overall probability match %
  sideConfidences?: SideConfidence[];
  candidateEvaluations?: CandidateEvaluation[];
  modelName?: string;
  error?: string;
}
