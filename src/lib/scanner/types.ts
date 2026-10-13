export interface ScanPhoto {
  id: string;
  dataUrl: string;
  thumbnailUrl: string;
  timestamp: number;
  angleGroup: AngleGroup;
  azimuth: number; // 0 - 360 degrees
  elevation: number; // -30 to 80 degrees
  maskDataUrl?: string;
  transparentDataUrl?: string;
  isSegmented: boolean;
  quality: PhotoQuality;
}

export type AngleGroup =
  | 'front'
  | 'front-left'
  | 'front-right'
  | 'left'
  | 'right'
  | 'back'
  | 'back-left'
  | 'back-right'
  | 'top-front'
  | 'top-side'
  | 'top-back'
  | 'top'
  | 'extra';

export interface PhotoQuality {
  blurScore: number; // 0-100 (higher is sharper)
  isBlurry: boolean;
  brightness: number; // 0-255
  isUnderExposed: boolean;
  isOverExposed: boolean;
  featureCount: number;
  hasSufficientFeatures: boolean;
  overallScore: number; // 0-100
  warnings: string[];
}

export interface AngleStep {
  group: AngleGroup;
  title: string;
  instruction: string;
  azimuth: number;
  elevation: number;
  stageName: 'prepare' | 'front' | 'sides' | 'top' | 'extra';
}

export type ReconstructionEngineType = 'browser-local' | 'self-hosted-colmap';

export type QualityPreset = 'draft' | 'standard' | 'high';

export interface ReconstructionStageInfo {
  stage:
    | 'idle'
    | 'validating'
    | 'segmenting'
    | 'feature-matching'
    | 'pose-estimation'
    | 'geometry-carving'
    | 'marching-cubes'
    | 'texturing'
    | 'cleanup'
    | 'optimizing'
    | 'exporting'
    | 'complete'
    | 'failed';
  progress: number; // 0 - 100
  message: string;
  stats?: {
    totalPhotos: number;
    usedPhotos: number;
    voxelResolution: number;
    vertexCount: number;
    triangleCount: number;
    textureResolution: number;
    fileSizeBytes?: number;
    elapsedSeconds: number;
  };
}

export interface ModelCleanupOptions {
  center: boolean;
  origin: 'bottom' | 'center' | 'top';
  scale: number;
  rotationX: number; // radians
  rotationY: number; // radians
  rotationZ: number; // radians
  removeDisconnectedDebris: boolean;
  decimationRatio: number; // 0.1 to 1.0 (1.0 = full detail)
}

export const SCAN_STEPS: AngleStep[] = [
  {
    group: 'front',
    title: 'Front View',
    instruction: 'Hold the camera directly at eye-level facing the front of the object.',
    azimuth: 0,
    elevation: 0,
    stageName: 'front',
  },
  {
    group: 'front-left',
    title: 'Front-Left (45°)',
    instruction: 'Step slightly to the left while keeping the object centered in the reticle.',
    azimuth: 45,
    elevation: 0,
    stageName: 'front',
  },
  {
    group: 'front-right',
    title: 'Front-Right (315°)',
    instruction: 'Step to the front-right to complete the frontal arc.',
    azimuth: 315,
    elevation: 0,
    stageName: 'front',
  },
  {
    group: 'left',
    title: 'Left Profile (90°)',
    instruction: 'Move directly to the left side of the object.',
    azimuth: 90,
    elevation: 0,
    stageName: 'sides',
  },
  {
    group: 'back-left',
    title: 'Back-Left (135°)',
    instruction: 'Orbit around to the rear-left corner.',
    azimuth: 135,
    elevation: 0,
    stageName: 'sides',
  },
  {
    group: 'back',
    title: 'Direct Back (180°)',
    instruction: 'Photograph the rear surface of the object.',
    azimuth: 180,
    elevation: 0,
    stageName: 'sides',
  },
  {
    group: 'back-right',
    title: 'Back-Right (225°)',
    instruction: 'Orbit to the rear-right corner.',
    azimuth: 225,
    elevation: 0,
    stageName: 'sides',
  },
  {
    group: 'right',
    title: 'Right Profile (270°)',
    instruction: 'Photograph the direct right side of the object.',
    azimuth: 270,
    elevation: 0,
    stageName: 'sides',
  },
  {
    group: 'top-front',
    title: 'Elevated Front (35°)',
    instruction: 'Raise your camera slightly higher and tilt down toward the front.',
    azimuth: 0,
    elevation: 35,
    stageName: 'top',
  },
  {
    group: 'top-side',
    title: 'Elevated Side (35°)',
    instruction: 'Keep elevated height and orbit around the side.',
    azimuth: 90,
    elevation: 35,
    stageName: 'top',
  },
  {
    group: 'top-back',
    title: 'Elevated Back (35°)',
    instruction: 'Capture the raised rear angle.',
    azimuth: 180,
    elevation: 35,
    stageName: 'top',
  },
  {
    group: 'top',
    title: 'Direct Top View (70°)',
    instruction: 'Position your camera looking down from above the top of the object.',
    azimuth: 0,
    elevation: 70,
    stageName: 'top',
  },
];

export type {
  QualityReport,
  OverallQualityStatus,
  ReconstructionMetrics,
} from './quality-report';
