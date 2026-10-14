import React from "react";
import { SCAN_STEPS, type ScanPhoto, type AngleGroup } from "@/lib/scanner/types";

interface HemisphereDiagramProps {
  photos: ScanPhoto[];
  activeGroup?: AngleGroup;
  onSelectGroup?: (group: AngleGroup) => void;
}

export function HemisphereDiagram({ photos, activeGroup, onSelectGroup }: HemisphereDiagramProps) {
  // Count how many photos exist for each step
  const capturedMap = new Map<AngleGroup, number>();
  for (const p of photos) {
    capturedMap.set(p.angleGroup, (capturedMap.get(p.angleGroup) || 0) + 1);
  }

  const totalSteps = SCAN_STEPS.length;
  const coveredSteps = SCAN_STEPS.filter((s) => (capturedMap.get(s.group) || 0) > 0).length;
  const coveragePercent = Math.round((coveredSteps / totalSteps) * 100);

  // SVG Projection parameters (orthographic projection of upper hemisphere)
  const cx = 100;
  const cy = 100;
  const r = 75;

  return (
    <div className="flex flex-col items-center bg-card/60 backdrop-blur-md rounded-xl p-3 border border-border/40 text-xs">
      <div className="flex items-center justify-between w-full mb-1">
        <span className="font-semibold text-foreground flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          Angle Coverage
        </span>
        <span className="text-primary font-bold text-xs">{coveragePercent}%</span>
      </div>

      <div className="relative w-48 h-48 my-1">
        <svg viewBox="0 0 200 200" className="w-full h-full select-none overflow-visible">
          <defs>
            <radialGradient id="hemiGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.25" />
              <stop offset="70%" stopColor="hsl(var(--primary))" stopOpacity="0.05" />
              <stop offset="100%" stopColor="transparent" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Hemisphere Dome rings */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="url(#hemiGlow)"
            stroke="hsl(var(--border))"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
          <circle
            cx={cx}
            cy={cy}
            r={r * 0.65}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth="0.8"
            opacity="0.6"
          />
          <circle
            cx={cx}
            cy={cy}
            r={r * 0.3}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth="0.8"
            opacity="0.4"
          />

          {/* Compass Axis */}
          <line
            x1={cx - r}
            y1={cy}
            x2={cx + r}
            y2={cy}
            stroke="hsl(var(--border))"
            strokeWidth="0.7"
            opacity="0.3"
          />
          <line
            x1={cx}
            y1={cy - r}
            x2={cx}
            y2={cy + r}
            stroke="hsl(var(--border))"
            strokeWidth="0.7"
            opacity="0.3"
          />

          {/* Center object icon */}
          <rect
            x={cx - 7}
            y={cy - 7}
            width={14}
            height={14}
            rx={3}
            fill="hsl(var(--muted))"
            stroke="hsl(var(--primary))"
            strokeWidth="1.2"
          />

          {/* Step points */}
          {SCAN_STEPS.map((step) => {
            const azRad = (step.azimuth * Math.PI) / 180;
            // Elevation: 0 is on perimeter (r), 70 is near center
            const elevationFactor = Math.cos((step.elevation * Math.PI) / 180);
            const dist = r * elevationFactor;

            const px = cx + dist * Math.sin(azRad);
            const py = cy - dist * Math.cos(azRad);

            const count = capturedMap.get(step.group) || 0;
            const isCaptured = count > 0;
            const isActive = activeGroup === step.group;

            return (
              <g
                key={step.group}
                className="cursor-pointer transition-transform hover:scale-125"
                onClick={() => onSelectGroup?.(step.group)}
              >
                {isActive && (
                  <circle
                    cx={px}
                    cy={py}
                    r={9}
                    fill="none"
                    stroke="hsl(var(--primary))"
                    strokeWidth="1.5"
                    className="animate-ping"
                    opacity="0.6"
                  />
                )}
                <circle
                  cx={px}
                  cy={py}
                  r={isCaptured ? 6 : 4.5}
                  fill={
                    isCaptured ? "#10b981" : isActive ? "hsl(var(--primary))" : "hsl(var(--muted))"
                  }
                  stroke={isActive ? "#ffffff" : "hsl(var(--background))"}
                  strokeWidth="1.5"
                />
                {isCaptured && (
                  <text
                    x={px}
                    y={py + 3}
                    textAnchor="middle"
                    fontSize="7"
                    fill="#ffffff"
                    fontWeight="bold"
                  >
                    ✓
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Labels for cardinal directions */}
        <span className="absolute top-0 left-1/2 -translate-x-1/2 text-[9px] text-muted-foreground font-mono">
          FRONT
        </span>
        <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[9px] text-muted-foreground font-mono">
          BACK
        </span>
        <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground font-mono">
          LEFT
        </span>
        <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground font-mono">
          RIGHT
        </span>
      </div>

      <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Captured (
          {coveredSteps}/{totalSteps})
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-muted inline-block" /> Missing
        </span>
      </div>
    </div>
  );
}
