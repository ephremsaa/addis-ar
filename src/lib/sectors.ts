import type {
  AngleSector,
  HeightLevel,
  TargetAngleId,
  TargetAngleSlot,
} from '../types/scanner';

export type { AngleSector, HeightLevel, TargetAngleId, TargetAngleSlot };

/**
 * 8 Core Guided Angles + 1 Optional Underside Slot:
 * - 7 surrounding orbit slots around the product
 * - 1 top overhead view
 * - 1 optional underside/bottom view
 */
export const TARGET_SLOT_DEFINITIONS: Array<{
  id: TargetAngleId;
  label: string;
  shortLabel: string;
  targetAzimuth: number;
  targetElevation: number;
  isOptional: boolean;
}> = [
  { id: 'front', label: 'Front View', shortLabel: 'Front', targetAzimuth: 0, targetElevation: 25, isOptional: false },
  { id: 'front_right', label: 'Front-Right', shortLabel: 'F-Right', targetAzimuth: 45, targetElevation: 25, isOptional: false },
  { id: 'right', label: 'Right Side', shortLabel: 'Right', targetAzimuth: 90, targetElevation: 25, isOptional: false },
  { id: 'back_right', label: 'Back-Right', shortLabel: 'B-Right', targetAzimuth: 135, targetElevation: 25, isOptional: false },
  { id: 'back', label: 'Back View', shortLabel: 'Back', targetAzimuth: 180, targetElevation: 25, isOptional: false },
  { id: 'back_left', label: 'Back-Left', shortLabel: 'B-Left', targetAzimuth: 225, targetElevation: 25, isOptional: false },
  { id: 'left', label: 'Left Side', shortLabel: 'Left', targetAzimuth: 270, targetElevation: 25, isOptional: false },
  { id: 'top', label: 'Top View', shortLabel: 'Top', targetAzimuth: 0, targetElevation: 75, isOptional: false },
  { id: 'bottom', label: 'Underside (Optional)', shortLabel: 'Bottom', targetAzimuth: 0, targetElevation: -40, isOptional: true },
];

export const REQUIRED_SLOT_COUNT = 8;
export const TOTAL_SLOT_COUNT = 9;

export function createInitialTargetSlots(): TargetAngleSlot[] {
  return TARGET_SLOT_DEFINITIONS.map((def) => ({
    id: def.id,
    label: def.label,
    shortLabel: def.shortLabel,
    targetAzimuth: def.targetAzimuth,
    targetElevation: def.targetElevation,
    isOptional: def.isOptional,
    isCaptured: false,
    confidence: undefined,
  }));
}

/**
 * Maps current sensor azimuth & elevation to the closest target slot.
 */
export function findSlotForAngle(
  slots: TargetAngleSlot[],
  azimuthDeg: number,
  elevationDeg: number
): TargetAngleSlot | undefined {
  // 1. Check for Top Overhead Angle (Elevation >= 55°)
  if (elevationDeg >= 55) {
    return slots.find((s) => s.id === 'top');
  }

  // 2. Check for Bottom Underside Angle (Elevation <= -20°)
  if (elevationDeg <= -20) {
    return slots.find((s) => s.id === 'bottom');
  }

  // 3. Normalized Azimuth in 0..360°
  const normAzimuth = ((azimuthDeg % 360) + 360) % 360;

  // Horizontal surrounding orbit slots (excluding top/bottom)
  const orbitSlots = slots.filter((s) => s.id !== 'top' && s.id !== 'bottom');

  let bestSlot: TargetAngleSlot | undefined;
  let minDiff = Infinity;

  for (const slot of orbitSlots) {
    let diff = Math.abs(slot.targetAzimuth - normAzimuth);
    if (diff > 180) diff = 360 - diff;
    if (diff < minDiff) {
      minDiff = diff;
      bestSlot = slot;
    }
  }

  // Accept if within generous ±25° cone
  if (minDiff <= 25) {
    return bestSlot;
  }

  return bestSlot;
}

/**
 * Returns directional instruction guiding user to next target angle.
 */
export function getGuidedAngleInstruction(
  slots: TargetAngleSlot[],
  currentAzimuth: number,
  currentElevation: number
): { instruction: string; targetSlot: TargetAngleSlot | null; isReadyForModel: boolean } {
  const uncapturedRequired = slots.filter((s) => !s.isOptional && !s.isCaptured);

  if (uncapturedRequired.length === 0) {
    const uncapturedBottom = slots.find((s) => s.id === 'bottom' && !s.isCaptured);
    return {
      instruction: uncapturedBottom
        ? '✨ All 8 angles captured! Tap build, or scan underside'
        : '✨ All angles complete! Ready to generate 3D model',
      targetSlot: uncapturedBottom || null,
      isReadyForModel: true,
    };
  }

  // Next required slot in order
  const nextTarget = uncapturedRequired[0];

  if (nextTarget.id === 'top') {
    return {
      instruction: 'Tilt camera up to capture Top angle',
      targetSlot: nextTarget,
      isReadyForModel: slots.filter((s) => s.isCaptured).length >= 6,
    };
  }

  // Check if phone is close to the target
  const normAzimuth = ((currentAzimuth % 360) + 360) % 360;
  let diff = Math.abs(nextTarget.targetAzimuth - normAzimuth);
  if (diff > 180) diff = 360 - diff;

  if (diff < 15 && currentElevation < 50 && currentElevation > 10) {
    return {
      instruction: `Steady... in position for ${nextTarget.shortLabel}!`,
      targetSlot: nextTarget,
      isReadyForModel: slots.filter((s) => s.isCaptured).length >= 6,
    };
  }

  return {
    instruction: `Orbit to ${nextTarget.label} (${uncapturedRequired.length} left)`,
    targetSlot: nextTarget,
    isReadyForModel: slots.filter((s) => s.isCaptured).length >= 6,
  };
}

export function getSlotStats(slots: TargetAngleSlot[]) {
  const required = slots.filter((s) => !s.isOptional);
  const capturedRequired = required.filter((s) => s.isCaptured).length;
  const capturedTotal = slots.filter((s) => s.isCaptured).length;
  const percent = Math.round((capturedRequired / REQUIRED_SLOT_COUNT) * 100);

  return {
    capturedCount: capturedTotal,
    requiredCount: REQUIRED_SLOT_COUNT,
    capturedRequired,
    percent,
    isReady: capturedRequired >= 6, // Minimum 6 angles for AI generation
    isFull: capturedRequired === REQUIRED_SLOT_COUNT,
  };
}

// ---------------------------------------------------------------------------
// Backward-compatible Sector Helpers for Radial HUD
// ---------------------------------------------------------------------------
export const AZIMUTH_COUNT = 8;
export const HEIGHT_LEVELS: HeightLevel[] = ['low', 'mid', 'top'];
export const TOTAL_SECTORS = 8;

export function createInitialSectors(): AngleSector[] {
  return TARGET_SLOT_DEFINITIONS.filter((s) => !s.isOptional).map((def, idx) => ({
    id: def.id,
    azimuthIndex: idx,
    azimuthCenter: def.targetAzimuth,
    heightLevel: def.id === 'top' ? 'top' : 'mid',
    label: def.label,
    isCovered: false,
  }));
}

export function determineHeightLevel(elevationDeg: number): HeightLevel {
  if (elevationDeg < 22) return 'low';
  if (elevationDeg < 55) return 'mid';
  return 'top';
}

export function findSectorForAngle(
  sectors: AngleSector[],
  azimuthDeg: number,
  elevationDeg: number
): AngleSector | undefined {
  if (elevationDeg >= 55) {
    return sectors.find((s) => s.id === 'top');
  }

  const normAzimuth = ((azimuthDeg % 360) + 360) % 360;
  return sectors.find((s) => {
    let diff = Math.abs(s.azimuthCenter - normAzimuth);
    if (diff > 180) diff = 360 - diff;
    return diff <= 25;
  });
}

export function getCoverageStats(sectors: AngleSector[]) {
  const covered = sectors.filter((s) => s.isCovered).length;
  const total = sectors.length;
  const percent = Math.round((covered / total) * 100);

  return {
    covered,
    total,
    percent,
    isComplete: covered >= 6,
    levelBreakdown: {
      low: { covered: 0, total: 0 },
      mid: { covered, total },
      top: { covered: sectors.find((s) => s.id === 'top')?.isCovered ? 1 : 0, total: 1 },
    },
  };
}

export function getMissingAnglesGuidance(
  sectors: AngleSector[],
  currentAzimuth: number,
  currentElevation: number
): string {
  const uncovered = sectors.filter((s) => !s.isCovered);
  if (uncovered.length === 0) {
    return '✨ All angles complete! Ready to build 3D Model';
  }

  const next = uncovered[0];
  if (next.id === 'top') return 'Tilt camera up to capture Top angle';
  return `Orbit to ${next.label} (${uncovered.length} angles left)`;
}
