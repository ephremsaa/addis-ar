import React from "react";
import type { ScanPhoto } from "@/lib/scanner/types";

export interface SectorState {
  id: string;
  label: string;
  shortLabel: string;
  angleDeg: number; // 0 = Front, 90 = Right, 180 = Back, 270 = Left
  isElevation?: boolean;
  count: number;
  status: "gray" | "purple" | "green" | "orange";
}

interface SectorCoverageRadarProps {
  photos: ScanPhoto[];
  currentAzimuth?: number;
  currentElevation?: number;
  rejectedCount?: number;
  trackingStatus?: "optimal" | "limited" | "lost" | "idle";
  trackingConfidence?: number;
  currentPass?: number;
  mode?: "floating" | "panel";
  onSectorClick?: (sectorId: string) => void;
}

const SECTOR_DEFINITIONS = [
  { id: "front", label: "Front", shortLabel: "F", angleDeg: 0 },
  { id: "front-right", label: "Front-Right", shortLabel: "FR", angleDeg: 45 },
  { id: "right", label: "Right", shortLabel: "R", angleDeg: 90 },
  { id: "back-right", label: "Back-Right", shortLabel: "BR", angleDeg: 135 },
  { id: "back", label: "Back", shortLabel: "B", angleDeg: 180 },
  { id: "back-left", label: "Back-Left", shortLabel: "BL", angleDeg: 225 },
  { id: "left", label: "Left", shortLabel: "L", angleDeg: 270 },
  { id: "front-left", label: "Front-Left", shortLabel: "FL", angleDeg: 315 },
];

export function SectorCoverageRadar({
  photos,
  currentAzimuth = 0,
  currentElevation = 20,
  rejectedCount = 0,
  trackingStatus = "optimal",
  trackingConfidence = 0.9,
  currentPass = 1,
  mode = "floating",
  onSectorClick,
}: SectorCoverageRadarProps) {
  // Aggregate photos into sectors
  const sectorCounts: Record<string, number> = {
    front: 0,
    "front-right": 0,
    right: 0,
    "back-right": 0,
    back: 0,
    "back-left": 0,
    left: 0,
    "front-left": 0,
    upper: 0,
    lower: 0,
  };

  for (const p of photos) {
    const az = ((p.azimuth % 360) + 360) % 360;
    const el = p.elevation ?? 20;

    if (el >= 35) {
      sectorCounts["upper"] = (sectorCounts["upper"] ?? 0) + 1;
    } else {
      sectorCounts["lower"] = (sectorCounts["lower"] ?? 0) + 1;
    }

    if (az >= 337.5 || az < 22.5) sectorCounts["front"] = (sectorCounts["front"] ?? 0) + 1;
    else if (az >= 22.5 && az < 67.5)
      sectorCounts["front-right"] = (sectorCounts["front-right"] ?? 0) + 1;
    else if (az >= 67.5 && az < 112.5) sectorCounts["right"] = (sectorCounts["right"] ?? 0) + 1;
    else if (az >= 112.5 && az < 157.5)
      sectorCounts["back-right"] = (sectorCounts["back-right"] ?? 0) + 1;
    else if (az >= 157.5 && az < 202.5) sectorCounts["back"] = (sectorCounts["back"] ?? 0) + 1;
    else if (az >= 202.5 && az < 247.5)
      sectorCounts["back-left"] = (sectorCounts["back-left"] ?? 0) + 1;
    else if (az >= 247.5 && az < 292.5) sectorCounts["left"] = (sectorCounts["left"] ?? 0) + 1;
    else if (az >= 292.5 && az < 337.5)
      sectorCounts["front-left"] = (sectorCounts["front-left"] ?? 0) + 1;
  }

  // Calculate sector states
  const totalSectors = SECTOR_DEFINITIONS.length;
  let sufficientSectors = 0;
  let partialSectors = 0;
  const missingSectorsList: string[] = [];

  const sectors: SectorState[] = SECTOR_DEFINITIONS.map((def) => {
    const count = sectorCounts[def.id] ?? 0;
    let status: "gray" | "purple" | "green" | "orange" = "gray";

    if (count === 0) {
      status = "gray";
      missingSectorsList.push(def.label);
    } else if (count === 1) {
      // 1 frame is captured but needs more for solid triangulation
      status = currentPass > 1 ? "orange" : "purple";
      partialSectors++;
    } else {
      status = "green";
      sufficientSectors++;
    }

    return {
      id: def.id,
      label: def.label,
      shortLabel: def.shortLabel,
      angleDeg: def.angleDeg,
      count,
      status,
    };
  });

  const upperCount = sectorCounts["upper"] ?? 0;
  if (upperCount === 0) {
    missingSectorsList.push("Upper views");
  }

  // Coverage percentage based on azimuth & elevation
  const azCoverage = (sufficientSectors * 1.0 + partialSectors * 0.5) / totalSectors;
  const elCoverage = Math.min(1.0, upperCount / 4);
  const overallCoverage = Math.min(100, Math.round((azCoverage * 0.8 + elCoverage * 0.2) * 100));

  // Determine current pass label
  const passLabel =
    currentPass === 1
      ? "Pass 1 · Eye-Level"
      : currentPass === 2
        ? "Pass 2 · Upper 45°"
        : "Pass 3 · Missing Detail";

  // SVG dimensions
  const size = mode === "floating" ? 140 : 180;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.44;
  const innerR = size * 0.22;

  // Tracking color
  const trackingBadge =
    trackingStatus === "optimal"
      ? { text: "TRACKING", color: "bg-emerald-500/90 text-white" }
      : trackingStatus === "limited"
        ? { text: "LIMITED", color: "bg-amber-500/90 text-amber-950" }
        : trackingStatus === "lost"
          ? { text: "TRACKING LOST", color: "bg-red-500/90 text-white" }
          : { text: "READY", color: "bg-neutral-800 text-white/80" };

  return (
    <div
      className={`rounded-2xl border transition-all select-none ${
        mode === "floating"
          ? "bg-black/80 backdrop-blur-xl border-white/10 p-3 shadow-2xl text-white"
          : "bg-card border-border/60 p-4 text-foreground"
      }`}
    >
      {/* Header bar with coverage percentage and tracking status */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              trackingStatus === "optimal"
                ? "bg-emerald-400 animate-pulse"
                : trackingStatus === "limited"
                  ? "bg-amber-400"
                  : trackingStatus === "lost"
                    ? "bg-red-500 animate-ping"
                    : "bg-muted"
            }`}
          />
          <span className="text-[11px] font-bold font-mono tracking-wide">
            {overallCoverage}% COVERAGE
          </span>
        </div>

        <span
          className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${trackingBadge.color}`}
        >
          {trackingBadge.text}
        </span>
      </div>

      {/* Main Radar SVG with 8 directional wedges and central elevation dome */}
      <div className="relative flex justify-center my-1">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="overflow-visible"
        >
          <defs>
            <radialGradient id="radarCenterGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#9333ea" stopOpacity="0.3" />
              <stop offset="100%" stopColor="transparent" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Background circle */}
          <circle
            cx={cx}
            cy={cy}
            r={outerR}
            fill="rgba(255,255,255,0.03)"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="1"
          />

          {/* 8 Angular Sectors */}
          {sectors.map((sec, i) => {
            const startAngle = (sec.angleDeg - 22.5) * (Math.PI / 180) - Math.PI / 2;
            const endAngle = (sec.angleDeg + 22.5) * (Math.PI / 180) - Math.PI / 2;

            const x1 = cx + outerR * Math.cos(startAngle);
            const y1 = cy + outerR * Math.sin(startAngle);
            const x2 = cx + outerR * Math.cos(endAngle);
            const y2 = cy + outerR * Math.sin(endAngle);

            const ix1 = cx + innerR * Math.cos(startAngle);
            const iy1 = cy + innerR * Math.sin(startAngle);
            const ix2 = cx + innerR * Math.cos(endAngle);
            const iy2 = cy + innerR * Math.sin(endAngle);

            const pathD = `M ${ix1} ${iy1} L ${x1} ${y1} A ${outerR} ${outerR} 0 0 1 ${x2} ${y2} L ${ix2} ${iy2} A ${innerR} ${innerR} 0 0 0 ${ix1} ${iy1} Z`;

            // Sector Color: Gray, Purple, Green, Orange
            const fillColor =
              sec.status === "green"
                ? "rgba(16, 185, 129, 0.75)" // Green = sufficient
                : sec.status === "purple"
                  ? "rgba(147, 51, 234, 0.75)" // Purple = captured, needs more
                  : sec.status === "orange"
                    ? "rgba(245, 158, 11, 0.85)" // Orange = additional recommended
                    : "rgba(75, 85, 99, 0.25)"; // Gray = not captured

            const strokeColor =
              sec.status === "green"
                ? "#10b981"
                : sec.status === "purple"
                  ? "#a855f7"
                  : sec.status === "orange"
                    ? "#f59e0b"
                    : "rgba(255, 255, 255, 0.1)";

            return (
              <path
                key={sec.id}
                d={pathD}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth="1.2"
                className="cursor-pointer transition-colors duration-200 hover:opacity-90"
                onClick={() => onSectorClick?.(sec.id)}
              />
            );
          })}

          {/* Center Upper-Elevation Dome */}
          <circle
            cx={cx}
            cy={cy}
            r={innerR}
            fill={
              upperCount >= 4
                ? "rgba(16, 185, 129, 0.8)"
                : upperCount >= 1
                  ? "rgba(147, 51, 234, 0.7)"
                  : "rgba(75, 85, 99, 0.3)"
            }
            stroke={
              upperCount >= 4 ? "#10b981" : upperCount >= 1 ? "#a855f7" : "rgba(255,255,255,0.15)"
            }
            strokeWidth="1.5"
          />

          {/* Central Object Marker */}
          <rect
            x={cx - 5}
            y={cy - 5}
            width={10}
            height={10}
            rx={2.5}
            fill="#ffffff"
            opacity="0.9"
          />

          {/* Current Camera Azimuth Pointer Needle */}
          {(() => {
            const needleAngle = (currentAzimuth * Math.PI) / 180 - Math.PI / 2;
            const nx = cx + (outerR + 5) * Math.cos(needleAngle);
            const ny = cy + (outerR + 5) * Math.sin(needleAngle);
            return (
              <g>
                <line
                  x1={cx}
                  y1={cy}
                  x2={nx}
                  y2={ny}
                  stroke="#ef4444"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle cx={nx} cy={ny} r={3.5} fill="#ef4444" stroke="#ffffff" strokeWidth="1" />
              </g>
            );
          })()}

          {/* Cardinal Directions */}
          <text
            x={cx}
            y={cy - outerR - 4}
            textAnchor="middle"
            fontSize="8"
            fill="rgba(255,255,255,0.6)"
            fontWeight="bold"
          >
            F
          </text>
          <text
            x={cx + outerR + 6}
            y={cy + 3}
            textAnchor="middle"
            fontSize="8"
            fill="rgba(255,255,255,0.6)"
            fontWeight="bold"
          >
            R
          </text>
          <text
            x={cx}
            y={cy + outerR + 10}
            textAnchor="middle"
            fontSize="8"
            fill="rgba(255,255,255,0.6)"
            fontWeight="bold"
          >
            B
          </text>
          <text
            x={cx - outerR - 6}
            y={cy + 3}
            textAnchor="middle"
            fontSize="8"
            fill="rgba(255,255,255,0.6)"
            fontWeight="bold"
          >
            L
          </text>
        </svg>
      </div>

      {/* Orbit Pass & Keyframe Metrics */}
      <div className="space-y-1.5 mt-2 text-[10px]">
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="font-semibold text-foreground/90">{passLabel}</span>
          <span className="font-mono">
            {photos.length} selected ({rejectedCount} rejected)
          </span>
        </div>

        {/* Legend: Gray, Purple, Green, Orange */}
        <div className="grid grid-cols-2 gap-1 pt-1 border-t border-white/10 text-[9px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" />
            <span>Sufficient</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-purple-500 inline-block" />
            <span>Needs more</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-amber-500 inline-block" />
            <span>Recommended</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-neutral-600 inline-block" />
            <span>Missing</span>
          </div>
        </div>

        {/* Next recommended movement guidance */}
        {missingSectorsList.length > 0 && (
          <div className="text-[10px] text-amber-300/90 font-medium pt-1">
            Tip: Rotate to cover {missingSectorsList.slice(0, 2).join(" & ")}
          </div>
        )}
      </div>
    </div>
  );
}
