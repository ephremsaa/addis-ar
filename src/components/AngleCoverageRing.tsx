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

  // Radii for the 3 height tiers:
  // Outer ring = Low elevation (0-22°)
  // Middle ring = Mid/Eye elevation (22-52°)
  // Inner ring = Top elevation (52-85°)
  const radii: Record<HeightLevel, { inner: number; outer: number }> = {
    low: { inner: size * 0.38, outer: size * 0.46 },
    mid: { inner: size * 0.27, outer: size * 0.36 },
    top: { inner: size * 0.15, outer: size * 0.25 },
  };

  const angleStep = 360 / AZIMUTH_COUNT; // 30°

  // Helper to calculate SVG annular wedge arc path
  const getArcPath = (
    startAngleDeg: number,
    endAngleDeg: number,
    innerR: number,
    outerR: number
  ) => {
    // Convert degrees to radians (offset by -90° so 0° is 12 o'clock / front)
    const toRad = (deg: number) => ((deg - 90) * Math.PI) / 180;
    const gap = 1.6; // Clean spacing between sectors
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

  // Active phone heading pointer position on the dome
  const pointerNormRadius =
    currentElevation < 22
      ? (radii.low.inner + radii.low.outer) / 2
      : currentElevation < 52
      ? (radii.mid.inner + radii.mid.outer) / 2
      : (radii.top.inner + radii.top.outer) / 2;

  const pointerRad = ((currentAzimuth - 90) * Math.PI) / 180;
  const pointerX = center + pointerNormRadius * Math.cos(pointerRad);
  const pointerY = center + pointerNormRadius * Math.sin(pointerRad);

  // Micro-degree ticks (36 ticks at 10° intervals)
  const ticks = Array.from({ length: 36 }, (_, i) => {
    const angle = (i * 10 - 90) * (Math.PI / 180);
    const isMajor = i % 3 === 0;
    const r1 = size * 0.475;
    const r2 = size * (isMajor ? 0.495 : 0.485);
    return {
      x1: center + r1 * Math.cos(angle),
      y1: center + r1 * Math.sin(angle),
      x2: center + r2 * Math.cos(angle),
      y2: center + r2 * Math.sin(angle),
      isMajor,
    };
  });

  return (
    <div
      className="relative pointer-events-none select-none flex items-center justify-center animate-float-hud"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
        <defs>
          {/* Gradient for covered sectors */}
          <linearGradient id="sector-covered-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>

          {/* Glow filter for covered sectors */}
          <filter id="hud-glow-green" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>

          {/* Glow filter for active pointer */}
          <filter id="hud-glow-pointer" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>

          {/* Radar sweep conic gradient */}
          <radialGradient id="radar-center-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(56, 189, 248, 0.25)" />
            <stop offset="70%" stopColor="rgba(56, 189, 248, 0.05)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>

        {/* Outer Circular Ring Background Shadow */}
        <circle
          cx={center}
          cy={center}
          r={size * 0.47}
          fill="rgba(8, 12, 22, 0.55)"
          stroke="rgba(255, 255, 255, 0.08)"
          strokeWidth="1"
        />

        {/* Ambient Center Glow */}
        <circle
          cx={center}
          cy={center}
          r={size * 0.14}
          fill="url(#radar-center-glow)"
        />

        {/* Precision Degree Ticks on Rim */}
        {ticks.map((t, idx) => (
          <line
            key={idx}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke={t.isMajor ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.16)'}
            strokeWidth={t.isMajor ? 1.5 : 1}
          />
        ))}

        {/* Concentric Tier Separation Guides */}
        <circle
          cx={center}
          cy={center}
          r={radii.low.outer}
          fill="none"
          stroke="rgba(255, 255, 255, 0.12)"
          strokeWidth="1"
        />
        <circle
          cx={center}
          cy={center}
          r={radii.mid.outer}
          fill="none"
          stroke="rgba(255, 255, 255, 0.1)"
          strokeWidth="1"
          strokeDasharray="3 4"
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

        {/* 36 Dome Segments (12 Azimuth x 3 Elevations) */}
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
                  ? 'url(#sector-covered-grad)'
                  : 'rgba(15, 23, 42, 0.55)'
              }
              stroke={
                sec.isCovered
                  ? '#67e8f9'
                  : 'rgba(255, 255, 255, 0.14)'
              }
              strokeWidth={sec.isCovered ? '1.5' : '0.75'}
              opacity={sec.isCovered ? 0.95 : 0.65}
              filter={sec.isCovered ? 'url(#hud-glow-green)' : undefined}
              className="transition-all duration-300"
            />
          );
        })}

        {/* Center Target Holographic Product Pedestal */}
        <g transform={`translate(${center}, ${center})`}>
          {/* Target Reticle Crosshairs */}
          <line x1="-12" y1="0" x2="-4" y2="0" stroke="rgba(56, 189, 248, 0.6)" strokeWidth="1.2" />
          <line x1="4" y1="0" x2="12" y2="0" stroke="rgba(56, 189, 248, 0.6)" strokeWidth="1.2" />
          <line x1="0" y1="-12" x2="0" y2="-4" stroke="rgba(56, 189, 248, 0.6)" strokeWidth="1.2" />
          <line x1="0" y1="4" x2="0" y2="12" stroke="rgba(56, 189, 248, 0.6)" strokeWidth="1.2" />

          {/* Micro Product Center Cube Icon */}
          <rect
            x="-5"
            y="-5"
            width="10"
            height="10"
            rx="2"
            fill="none"
            stroke="#38bdf8"
            strokeWidth="1.2"
            opacity="0.8"
          />
          <circle r="1.5" fill="#38bdf8" />
        </g>

        {/* Cardinal Heading Badges */}
        {/* FRONT */}
        <g transform={`translate(${center}, 11)`}>
          <rect x="-18" y="-7" width="36" height="13" rx="4" fill="rgba(8, 12, 22, 0.85)" stroke="rgba(255, 255, 255, 0.2)" strokeWidth="0.8" />
          <text textAnchor="middle" y="2.5" fill="#38bdf8" fontSize="8" fontWeight="800" letterSpacing="0.8">
            FRONT
          </text>
        </g>

        {/* RIGHT */}
        <g transform={`translate(${size - 10}, ${center})`}>
          <rect x="-9" y="-6" width="18" height="12" rx="3" fill="rgba(8, 12, 22, 0.85)" stroke="rgba(255, 255, 255, 0.15)" strokeWidth="0.8" />
          <text textAnchor="middle" y="2.5" fill="rgba(255, 255, 255, 0.7)" fontSize="7.5" fontWeight="700">
            90°
          </text>
        </g>

        {/* BACK */}
        <g transform={`translate(${center}, ${size - 11})`}>
          <rect x="-16" y="-6" width="32" height="12" rx="3" fill="rgba(8, 12, 22, 0.85)" stroke="rgba(255, 255, 255, 0.15)" strokeWidth="0.8" />
          <text textAnchor="middle" y="2.5" fill="rgba(255, 255, 255, 0.7)" fontSize="7.5" fontWeight="700" letterSpacing="0.5">
            BACK
          </text>
        </g>

        {/* LEFT */}
        <g transform={`translate(10, ${center})`}>
          <rect x="-9" y="-6" width="18" height="12" rx="3" fill="rgba(8, 12, 22, 0.85)" stroke="rgba(255, 255, 255, 0.15)" strokeWidth="0.8" />
          <text textAnchor="middle" y="2.5" fill="rgba(255, 255, 255, 0.7)" fontSize="7.5" fontWeight="700">
            270°
          </text>
        </g>

        {/* Live Active Phone Heading Pointer */}
        {isScanning && (
          <g transform={`translate(${pointerX}, ${pointerY})`} filter="url(#hud-glow-pointer)">
            {/* Direction line from center */}
            <line
              x1={center - pointerX}
              y1={center - pointerY}
              x2="0"
              y2="0"
              stroke="rgba(56, 189, 248, 0.35)"
              strokeWidth="1.2"
              strokeDasharray="2 3"
            />
            {/* Outer pulse wave */}
            <circle r="13" fill="rgba(56, 189, 248, 0.3)" className="animate-ping" />
            {/* Main targeting reticle */}
            <circle r="7.5" fill="#38bdf8" stroke="#ffffff" strokeWidth="2.2" />
            <circle r="2.5" fill="#030712" />
          </g>
        )}
      </svg>
    </div>
  );
};
