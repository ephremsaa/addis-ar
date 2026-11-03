import type { AngleSector, HeightLevel } from '../types/scanner';
export type { AngleSector, HeightLevel };

export const AZIMUTH_COUNT = 12; // 360 / 12 = 30° per sector
export const HEIGHT_LEVELS: HeightLevel[] = ['low', 'mid', 'top'];
export const TOTAL_SECTORS = AZIMUTH_COUNT * HEIGHT_LEVELS.length; // 36

export function createInitialSectors(): AngleSector[] {
  const sectors: AngleSector[] = [];

  for (const level of HEIGHT_LEVELS) {
    for (let i = 0; i < AZIMUTH_COUNT; i++) {
      const angle = i * (360 / AZIMUTH_COUNT);
      const levelLabel = level === 'low' ? 'Low' : level === 'mid' ? 'Eye' : 'Top';
      sectors.push({
        id: `${level}-${angle}`,
        azimuthIndex: i,
        azimuthCenter: angle,
        heightLevel: level,
        label: `${levelLabel} ${angle}°`,
        isCovered: false,
      });
    }
  }

  return sectors;
}

export function determineHeightLevel(elevationDeg: number): HeightLevel {
  if (elevationDeg < 22) return 'low';
  if (elevationDeg < 52) return 'mid';
  return 'top';
}

export function findSectorForAngle(
  sectors: AngleSector[],
  azimuthDeg: number,
  elevationDeg: number
): AngleSector | undefined {
  const normAzimuth = ((azimuthDeg % 360) + 360) % 360;
  const level = determineHeightLevel(elevationDeg);

  // Find the sector with closest azimuth center and matching level
  return sectors.find((s) => {
    if (s.heightLevel !== level) return false;
    let diff = Math.abs(s.azimuthCenter - normAzimuth);
    if (diff > 180) diff = 360 - diff;
    return diff <= 15; // 30° step / 2 = 15° window
  });
}

export function getCoverageStats(sectors: AngleSector[]) {
  const covered = sectors.filter((s) => s.isCovered).length;
  const total = sectors.length;
  const percent = Math.round((covered / total) * 100);

  const lowCovered = sectors.filter((s) => s.heightLevel === 'low' && s.isCovered).length;
  const midCovered = sectors.filter((s) => s.heightLevel === 'mid' && s.isCovered).length;
  const topCovered = sectors.filter((s) => s.heightLevel === 'top' && s.isCovered).length;

  return {
    covered,
    total,
    percent,
    isComplete: covered === total,
    levelBreakdown: {
      low: { covered: lowCovered, total: AZIMUTH_COUNT },
      mid: { covered: midCovered, total: AZIMUTH_COUNT },
      top: { covered: topCovered, total: AZIMUTH_COUNT },
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
    return '✨ 100% Covered! Ready to build 3D Model';
  }

  const currentLevel = determineHeightLevel(currentElevation);

  // Count uncovered by level
  const uncoveredTop = uncovered.filter((s) => s.heightLevel === 'top').length;
  const uncoveredMid = uncovered.filter((s) => s.heightLevel === 'mid').length;
  const uncoveredLow = uncovered.filter((s) => s.heightLevel === 'low').length;

  if (currentLevel !== 'top' && uncoveredTop > 4 && uncoveredMid < 3) {
    return 'Scan the top angle (tilt up)';
  }

  if (currentLevel !== 'low' && uncoveredLow > 4 && uncoveredMid < 3) {
    return 'Go lower to scan the base';
  }

  // Find nearest uncovered sector in current level
  const inLevel = uncovered.filter((s) => s.heightLevel === currentLevel);
  if (inLevel.length > 0) {
    return `Orbit around (${uncovered.length} angles left)`;
  }

  if (uncoveredTop > 0) return 'Tilt camera up to capture top';
  if (uncoveredLow > 0) return 'Lower phone to capture bottom';

  return `Orbit slowly around product (${uncovered.length} left)`;
}

