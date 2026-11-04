import React from 'react';

export interface CoverageSector {
  id: string;
  tier: 'low' | 'high' | 'top';
  azimuthIndex: number; // 0..11 (each 30°)
  isCovered: boolean;
}

interface AngleCoverageRingProps {
  coveredSectorIds: Set<string>;
  currentAzimuth: number; // 0..360°
  currentElevation: number; // 0..90°
  isRecording: boolean;
  size?: number;
}

export const AngleCoverageRing: React.FC<AngleCoverageRingProps> = ({
  coveredSectorIds,
  currentAzimuth,
  currentElevation,
  isRecording,
  size = 280,
}) => {
  const center = size / 2;
  const numSectors = 12; // 30° per sector
  const stepAngle = 360 / numSectors;

  // Outer ring = Low height tier (15°-30°)
  const lowRadiusOuter = size * 0.46;
  const lowRadiusInner = size * 0.36;

  // Inner ring = High height tier (35°-55°)
  const highRadiusOuter = size * 0.34;
  const highRadiusInner = size * 0.24;

  // Arc path generator
  const getArcPath = (
    startAngleDeg: number,
    endAngleDeg: number,
    innerR: number,
    outerR: number
  ) => {
    const toRad = (deg: number) => ((deg - 90) * Math.PI) / 180;
    const gap = 2.0;
    const startRad = toRad(startAngleDeg + gap);
    const endRad = toRad(endAngleDeg - gap);

    const x1 = center + outerR * Math.cos(startRad);
    const y1 = center + outerR * Math.sin(startRad);
    const x2 = center + outerR * Math.cos(endRad);
    const y2 = center + outerR * Math.sin(endRad);

    const x3 = center + innerR * Math.cos(endRad);
    const y3 = center + innerR * Math.sin(endRad);
    const x4 = center + innerR * Math.cos(startRad);
    const y4 = center + innerR * Math.sin(startRad);

    return `M ${x1} ${y1} A ${outerR} ${outerR} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 0 0 ${x4} ${y4} Z`;
  };

  // Pointer position based on current elevation and azimuth
  const pointerRadius =
    currentElevation >= 60
      ? size * 0.12
      : currentElevation >= 35
      ? (highRadiusInner + highRadiusOuter) / 2
      : (lowRadiusInner + lowRadiusOuter) / 2;

  const pointerRad = ((currentAzimuth - 90) * Math.PI) / 180;
  const pointerX = center + pointerRadius * Math.cos(pointerRad);
  const pointerY = center + pointerRadius * Math.sin(pointerRad);

  const isTopCovered = coveredSectorIds.has('top-overhead');

  return (
    <div
      className="relative pointer-events-none select-none flex items-center justify-center animate-float-hud"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
        <defs>
          <linearGradient id="sector-covered-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
          <filter id="hud-glow-green" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <filter id="hud-glow-pointer" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Ambient Ring Glow */}
        <circle
          cx={center}
          cy={center}
          r={size * 0.47}
          fill="rgba(8, 12, 22, 0.6)"
          stroke="rgba(255, 255, 255, 0.1)"
          strokeWidth="1"
        />

        {/* Low Tier (Outer 12 Segments) */}
        {Array.from({ length: numSectors }).map((_, i) => {
          const id = `low-${i}`;
          const isCovered = coveredSectorIds.has(id);
          const startAngle = i * stepAngle;
          const endAngle = startAngle + stepAngle;
          const path = getArcPath(startAngle, endAngle, lowRadiusInner, lowRadiusOuter);

          return (
            <path
              key={id}
              d={path}
              fill={isCovered ? 'url(#sector-covered-grad)' : 'rgba(15, 23, 42, 0.6)'}
              stroke={isCovered ? '#67e8f9' : 'rgba(255, 255, 255, 0.15)'}
              strokeWidth={isCovered ? '1.5' : '0.8'}
              opacity={isCovered ? 0.95 : 0.65}
              filter={isCovered ? 'url(#hud-glow-green)' : undefined}
              className="transition-all duration-200"
            />
          );
        })}

        {/* High Tier (Inner 12 Segments) */}
        {Array.from({ length: numSectors }).map((_, i) => {
          const id = `high-${i}`;
          const isCovered = coveredSectorIds.has(id);
          const startAngle = i * stepAngle;
          const endAngle = startAngle + stepAngle;
          const path = getArcPath(startAngle, endAngle, highRadiusInner, highRadiusOuter);

          return (
            <path
              key={id}
              d={path}
              fill={isCovered ? 'url(#sector-covered-grad)' : 'rgba(15, 23, 42, 0.6)'}
              stroke={isCovered ? '#67e8f9' : 'rgba(255, 255, 255, 0.15)'}
              strokeWidth={isCovered ? '1.5' : '0.8'}
              opacity={isCovered ? 0.95 : 0.65}
              filter={isCovered ? 'url(#hud-glow-green)' : undefined}
              className="transition-all duration-200"
            />
          );
        })}

        {/* Top Overhead Pass (Center Core) */}
        <circle
          cx={center}
          cy={center}
          r={size * 0.18}
          fill={isTopCovered ? 'url(#sector-covered-grad)' : 'rgba(15, 23, 42, 0.8)'}
          stroke={isTopCovered ? '#67e8f9' : 'rgba(255, 255, 255, 0.2)'}
          strokeWidth={isTopCovered ? '2' : '1'}
          filter={isTopCovered ? 'url(#hud-glow-green)' : undefined}
          className="transition-all duration-200"
        />
        <text
          x={center}
          y={center + 3}
          textAnchor="middle"
          fill={isTopCovered ? '#10b981' : 'rgba(255, 255, 255, 0.7)'}
          fontSize="8.5"
          fontWeight="800"
          letterSpacing="0.4"
        >
          {isTopCovered ? '✓ TOP' : '▲ TOP'}
        </text>

        {/* Cardinal Direction Badges */}
        <g transform={`translate(${center}, 11)`}>
          <text textAnchor="middle" fill="#38bdf8" fontSize="8" fontWeight="800">
            FRONT
          </text>
        </g>
        <g transform={`translate(${size - 14}, ${center + 2.5})`}>
          <text textAnchor="middle" fill="rgba(255, 255, 255, 0.6)" fontSize="7" fontWeight="700">
            90°
          </text>
        </g>
        <g transform={`translate(${center}, ${size - 7})`}>
          <text textAnchor="middle" fill="rgba(255, 255, 255, 0.6)" fontSize="7" fontWeight="700">
            BACK
          </text>
        </g>
        <g transform={`translate(14, ${center + 2.5})`}>
          <text textAnchor="middle" fill="rgba(255, 255, 255, 0.6)" fontSize="7" fontWeight="700">
            270°
          </text>
        </g>

        {/* Active Gyro Heading Pointer */}
        {isRecording && (
          <g transform={`translate(${pointerX}, ${pointerY})`} filter="url(#hud-glow-pointer)">
            <circle r="12" fill="rgba(56, 189, 248, 0.25)" className="animate-ping" />
            <circle r="6.5" fill="#38bdf8" stroke="#ffffff" strokeWidth="2" />
            <circle r="2" fill="#030712" />
          </g>
        )}
      </svg>
    </div>
  );
};
