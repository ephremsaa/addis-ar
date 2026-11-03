import React from 'react';
import type { TargetAngleSlot } from '../types/scanner';
import { Check, ArrowUp, ArrowDown } from 'lucide-react';

interface AngleCoverageRingProps {
  slots: TargetAngleSlot[];
  activeSlotId?: string;
  nextRecommendedId?: string;
  currentAzimuth: number; // 0..360°
  currentElevation: number; // -90..90°
  isScanning: boolean;
  size?: number;
  onSelectSlot?: (slotId: string) => void;
}

export const AngleCoverageRing: React.FC<AngleCoverageRingProps> = ({
  slots,
  activeSlotId,
  nextRecommendedId,
  currentAzimuth,
  currentElevation,
  isScanning,
  size = 300,
  onSelectSlot,
}) => {
  const center = size / 2;
  const orbitRadius = size * 0.40;

  // The 7 surrounding orbit slots
  const orbitAngleMap: Record<string, number> = {
    front: 0,
    front_right: 45,
    right: 90,
    back_right: 135,
    back: 180,
    back_left: 225,
    left: 270,
  };

  // Convert angle (0° = 12 o'clock) to SVG X/Y
  const getSlotCoordinates = (angleDeg: number, radius: number) => {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return {
      x: center + radius * Math.cos(rad),
      y: center + radius * Math.sin(rad),
    };
  };

  // Live gyro pointer position
  const pointerRadius =
    currentElevation >= 55
      ? size * 0.12 // near top center
      : currentElevation <= -20
      ? size * 0.12 // near bottom center
      : orbitRadius;

  const pointerRad = ((currentAzimuth - 90) * Math.PI) / 180;
  const pointerX = center + pointerRadius * Math.cos(pointerRad);
  const pointerY = center + pointerRadius * Math.sin(pointerRad);

  const topSlot = slots.find((s) => s.id === 'top');
  const bottomSlot = slots.find((s) => s.id === 'bottom');
  const orbitSlots = slots.filter((s) => s.id !== 'top' && s.id !== 'bottom');

  return (
    <div
      className="relative pointer-events-none select-none flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
        <defs>
          <filter id="glow-green-pod" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <filter id="glow-cyan-active" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <radialGradient id="ring-ambient-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(56, 189, 248, 0.12)" />
            <stop offset="65%" stopColor="rgba(56, 189, 248, 0.03)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>

        {/* Ambient Ring Glow */}
        <circle cx={center} cy={center} r={size * 0.46} fill="url(#ring-ambient-glow)" />

        {/* Outer Orbit Guide Track */}
        <circle
          cx={center}
          cy={center}
          r={orbitRadius}
          fill="none"
          stroke="rgba(255, 255, 255, 0.12)"
          strokeWidth="1.2"
          strokeDasharray="4 5"
        />

        {/* Connective Radial Spokes to Orbit Pods */}
        {orbitSlots.map((slot) => {
          const angle = orbitAngleMap[slot.id] ?? 0;
          const pos = getSlotCoordinates(angle, orbitRadius);
          return (
            <line
              key={`spoke-${slot.id}`}
              x1={center}
              y1={center}
              x2={pos.x}
              y2={pos.y}
              stroke="rgba(255, 255, 255, 0.06)"
              strokeWidth="0.8"
            />
          );
        })}

        {/* Live Aiming Vector Line */}
        {isScanning && (
          <line
            x1={center}
            y1={center}
            x2={pointerX}
            y2={pointerY}
            stroke="rgba(56, 189, 248, 0.5)"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
        )}

        {/* 7 Orbit Angle Pods */}
        {orbitSlots.map((slot) => {
          const angle = orbitAngleMap[slot.id] ?? 0;
          const pos = getSlotCoordinates(angle, orbitRadius);
          const isCaptured = slot.isCaptured;
          const isActive = activeSlotId === slot.id;
          const isNext = nextRecommendedId === slot.id;
          const score = slot.qualityScore?.overall;

          return (
            <g
              key={slot.id}
              transform={`translate(${pos.x}, ${pos.y})`}
              className="cursor-pointer pointer-events-auto"
              onClick={() => onSelectSlot && onSelectSlot(slot.id)}
            >
              {/* Pulsing Next Target Halo */}
              {isNext && !isCaptured && (
                <circle
                  r="21"
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="1.5"
                  className="animate-ping opacity-60"
                />
              )}

              {/* Main Pod Circle */}
              <circle
                r="17"
                fill={
                  isCaptured
                    ? 'rgba(16, 185, 129, 0.25)'
                    : isActive
                    ? 'rgba(56, 189, 248, 0.3)'
                    : 'rgba(15, 23, 42, 0.75)'
                }
                stroke={
                  isCaptured
                    ? '#10b981'
                    : isActive
                    ? '#38bdf8'
                    : isNext
                    ? 'rgba(56, 189, 248, 0.7)'
                    : 'rgba(255, 255, 255, 0.22)'
                }
                strokeWidth={isCaptured ? 2 : isActive ? 2.2 : isNext ? 1.5 : 1}
                filter={isCaptured ? 'url(#glow-green-pod)' : isActive ? 'url(#glow-cyan-active)' : undefined}
                className="transition-all duration-300"
              />

              {/* Icon or Score */}
              {isCaptured ? (
                <g transform="translate(-6, -6)">
                  <path
                    d="M3 7.5L5.5 10L10.5 4"
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {score !== undefined && (
                    <text
                      x="6"
                      y="17"
                      textAnchor="middle"
                      fill="#6ee7b7"
                      fontSize="7.5"
                      fontFamily="monospace"
                      fontWeight="700"
                    >
                      {score}%
                    </text>
                  )}
                </g>
              ) : (
                <text
                  textAnchor="middle"
                  y="2.5"
                  fill={isActive ? '#38bdf8' : isNext ? '#ffffff' : 'rgba(255, 255, 255, 0.75)'}
                  fontSize="7.5"
                  fontWeight="700"
                  letterSpacing="0.2"
                >
                  {slot.shortLabel}
                </text>
              )}
            </g>
          );
        })}

        {/* Center Target Core - Product Reticle */}
        <g transform={`translate(${center}, ${center})`}>
          <circle r="22" fill="rgba(8, 12, 22, 0.75)" stroke="rgba(255, 255, 255, 0.12)" strokeWidth="1" />
          <rect
            x="-7"
            y="-7"
            width="14"
            height="14"
            rx="3"
            fill="none"
            stroke="rgba(56, 189, 248, 0.8)"
            strokeWidth="1.2"
          />
          <circle r="2" fill="#38bdf8" />
        </g>

        {/* 8th Slot: TOP Pod (Inside Upper Core) */}
        {topSlot && (
          <g
            transform={`translate(${center}, ${center - 48})`}
            className="cursor-pointer pointer-events-auto"
            onClick={() => onSelectSlot && onSelectSlot(topSlot.id)}
          >
            {nextRecommendedId === 'top' && !topSlot.isCaptured && (
              <rect
                x="-24"
                y="-11"
                width="48"
                height="22"
                rx="11"
                fill="none"
                stroke="#38bdf8"
                strokeWidth="1.5"
                className="animate-ping opacity-60"
              />
            )}
            <rect
              x="-22"
              y="-10"
              width="44"
              height="20"
              rx="10"
              fill={
                topSlot.isCaptured
                  ? 'rgba(16, 185, 129, 0.25)'
                  : activeSlotId === 'top'
                  ? 'rgba(56, 189, 248, 0.35)'
                  : 'rgba(15, 23, 42, 0.8)'
              }
              stroke={
                topSlot.isCaptured
                  ? '#10b981'
                  : activeSlotId === 'top'
                  ? '#38bdf8'
                  : nextRecommendedId === 'top'
                  ? '#38bdf8'
                  : 'rgba(255, 255, 255, 0.22)'
              }
              strokeWidth={topSlot.isCaptured || activeSlotId === 'top' ? 2 : 1}
              filter={topSlot.isCaptured ? 'url(#glow-green-pod)' : undefined}
            />
            <text
              textAnchor="middle"
              y="3"
              fill={topSlot.isCaptured ? '#10b981' : activeSlotId === 'top' ? '#38bdf8' : '#ffffff'}
              fontSize="8"
              fontWeight="800"
              letterSpacing="0.4"
            >
              {topSlot.isCaptured ? `TOP ${topSlot.qualityScore?.overall || 95}%` : '▲ TOP'}
            </text>
          </g>
        )}

        {/* 9th Slot: BOTTOM (Optional Underside) Pod */}
        {bottomSlot && (
          <g
            transform={`translate(${center}, ${center + 48})`}
            className="cursor-pointer pointer-events-auto"
            onClick={() => onSelectSlot && onSelectSlot(bottomSlot.id)}
          >
            <rect
              x="-26"
              y="-10"
              width="52"
              height="20"
              rx="10"
              fill={
                bottomSlot.isCaptured
                  ? 'rgba(16, 185, 129, 0.25)'
                  : activeSlotId === 'bottom'
                  ? 'rgba(56, 189, 248, 0.35)'
                  : 'rgba(15, 23, 42, 0.65)'
              }
              stroke={
                bottomSlot.isCaptured
                  ? '#10b981'
                  : activeSlotId === 'bottom'
                  ? '#38bdf8'
                  : 'rgba(255, 255, 255, 0.18)'
              }
              strokeWidth={bottomSlot.isCaptured || activeSlotId === 'bottom' ? 2 : 0.9}
            />
            <text
              textAnchor="middle"
              y="3"
              fill={bottomSlot.isCaptured ? '#10b981' : 'rgba(255, 255, 255, 0.6)'}
              fontSize="7"
              fontWeight="700"
            >
              {bottomSlot.isCaptured ? `BASE ${bottomSlot.qualityScore?.overall || 90}%` : '▼ BASE'}
            </text>
          </g>
        )}

        {/* Live Active Phone Gyro Pointer Reticle */}
        {isScanning && (
          <g transform={`translate(${pointerX}, ${pointerY})`} filter="url(#glow-cyan-active)">
            <circle r="11" fill="rgba(56, 189, 248, 0.25)" className="animate-ping" />
            <circle r="6" fill="#38bdf8" stroke="#ffffff" strokeWidth="2" />
            <circle r="2" fill="#030712" />
          </g>
        )}
      </svg>
    </div>
  );
};
