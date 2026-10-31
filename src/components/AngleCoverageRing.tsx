import React from 'react';
import type { AngleSector, HeightLevel } from '../types/scanner';
import { AZIMUTH_COUNT } from '../lib/sectors';

interface AngleCoverageRingProps {
  sectors: AngleSector[];
  currentAzimuth: number; // 0..360°
  currentElevation: number; // 0..90°
  isScanning: boolean;
  size?: number;
}

export const AngleCoverageRing: React.FC<AngleCoverageRingProps> = ({
  sectors,
  currentAzimuth,
  currentElevation,
  isScanning,
  size = 280,
}) => {
  const center = size / 2;

  // Radii for the 3 height levels:
  // Outer ring = Low elevation (0-22°)
  // Middle ring = Mid/Eye elevation (22-52°)
  // Inner ring = Top elevation (52-85°)
  const radii: Record<HeightLevel, { inner: number; outer: number }> = {
    low: { inner: size * 0.38, outer: size * 0.47 },
    mid: { inner: size * 0.26, outer: size * 0.36 },
    top: { inner: size * 0.12, outer: size * 0.24 },
  };

  const angleStep = 360 / AZIMUTH_COUNT; // 30°

  // Helper to calculate SVG arc path for an annular wedge segment
  const getArcPath = (
    startAngleDeg: number,
    endAngleDeg: number,
    innerR: number,
    outerR: number
  ) => {
    // Convert degrees to radians (offset by -90° so 0° is top / 12 o'clock)
    const toRad = (deg: number) => ((deg - 90) * Math.PI) / 180;

    // Small gap between segments for visual clarity
    const gap = 1.5;
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

    const largeArc = endAngleDeg - startAngleDeg > 180 ? 1 : 0;

    return `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4} Z`;
  };

  // Current phone pointer position on the dome
  const pointerNormRadius =
    currentElevation < 22
      ? (radii.low.inner + radii.low.outer) / 2
      : currentElevation < 52
      ? (radii.mid.inner + radii.mid.outer) / 2
      : (radii.top.inner + radii.top.outer) / 2;

  const pointerRad = ((currentAzimuth - 90) * Math.PI) / 180;
  const pointerX = center + pointerNormRadius * Math.cos(pointerRad);
  const pointerY = center + pointerNormRadius * Math.sin(pointerRad);

  return (
    <div
      className="relative pointer-events-none select-none flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
        <defs>
          {/* Glowing filter for captured segments */}
          <filter id="glow-green" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <filter id="glow-pointer" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Ambient Center Target Ring */}
        <circle
          cx={center}
          cy={center}
          r={size * 0.08}
          fill="rgba(56, 189, 248, 0.08)"
          stroke="rgba(56, 189, 248, 0.25)"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />

        {/* Ring Division Dividers */}
        <circle
          cx={center}
          cy={center}
          r={radii.low.outer}
          fill="none"
          stroke="rgba(255, 255, 255, 0.15)"
          strokeWidth="1"
        />
        <circle
          cx={center}
          cy={center}
          r={radii.mid.outer}
          fill="none"
          stroke="rgba(255, 255, 255, 0.1)"
          strokeWidth="1"
          strokeDasharray="2 4"
        />
        <circle
          cx={center}
          cy={center}
          r={radii.top.outer}
          fill="none"
          stroke="rgba(255, 255, 255, 0.1)"
          strokeWidth="1"
          strokeDasharray="2 4"
        />

        {/* 36 Dome Segments */}
        {sectors.map((sec) => {
          const r = radii[sec.heightLevel];
          const startAngle = sec.azimuthIndex * angleStep;
          const endAngle = startAngle + angleStep;
          const path = getArcPath(startAngle, endAngle, r.inner, r.outer);

          return (
            <path
              key={sec.id}
              d={path}
              fill={
                sec.isCovered
                  ? '#10b981' // Vibrant Emerald Green
                  : 'rgba(15, 23, 42, 0.45)' // Translucent Dark Slate
              }
              stroke={
                sec.isCovered
                  ? '#34d399'
                  : 'rgba(255, 255, 255, 0.2)'
              }
              strokeWidth={sec.isCovered ? '1.5' : '1'}
              opacity={sec.isCovered ? 0.95 : 0.65}
              filter={sec.isCovered ? 'url(#glow-green)' : undefined}
              className="transition-all duration-300"
            />
          );
        })}

        {/* Cardinal Labels (0° Front, 90° Right, 180° Back, 270° Left) */}
        <text
          x={center}
          y={14}
          textAnchor="middle"
          fill="rgba(255, 255, 255, 0.6)"
          fontSize="10"
          fontWeight="700"
          letterSpacing="0.5"
        >
          FRONT
        </text>
        <text
          x={size - 10}
          y={center + 3}
          textAnchor="middle"
          fill="rgba(255, 255, 255, 0.4)"
          fontSize="9"
          fontWeight="600"
        >
          R
        </text>
        <text
          x={center}
          y={size - 6}
          textAnchor="middle"
          fill="rgba(255, 255, 255, 0.4)"
          fontSize="9"
          fontWeight="600"
        >
          BACK
        </text>
        <text
          x={10}
          y={center + 3}
          textAnchor="middle"
          fill="rgba(255, 255, 255, 0.4)"
          fontSize="9"
          fontWeight="600"
        >
          L
        </text>

        {/* Live Active Pointer (Phone Heading & Elevation) */}
        {isScanning && (
          <g transform={`translate(${pointerX}, ${pointerY})`} filter="url(#glow-pointer)">
            {/* Pulsing pointer halo */}
            <circle r="12" fill="rgba(56, 189, 248, 0.25)" className="animate-ping" />
            <circle r="7" fill="#38bdf8" stroke="#ffffff" strokeWidth="2" />
            <circle r="2" fill="#04101d" />
          </g>
        )}
      </svg>
    </div>
  );
};
