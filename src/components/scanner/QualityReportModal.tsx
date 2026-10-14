import React from "react";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Camera,
  Layers,
  Sparkles,
  ShieldCheck,
  ArrowRight,
  Sliders,
  ChevronRight,
  Info,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { QualityReport } from "@/lib/scanner/types";

interface QualityReportModalProps {
  report: QualityReport;
  isOpen: boolean;
  onClose: () => void;
  onRetry?: (
    strategy: "filter-blurry" | "relax-features" | "conservative-carving" | "recompute-textures",
  ) => void;
  onContinue: () => void;
}

export function QualityReportModal({
  report,
  isOpen,
  onClose,
  onRetry,
  onContinue,
}: QualityReportModalProps) {
  if (!isOpen) return null;

  const { status, score, summary, metrics, diagnostics, suggestedActions, retryRecommendation } =
    report;

  const statusBadge = {
    Good: {
      bg: "bg-emerald-500/15 border-emerald-500/30 text-emerald-400",
      icon: <CheckCircle2 className="w-5 h-5 text-emerald-400" />,
      label: "Good Reconstruction",
    },
    "Needs improvement": {
      bg: "bg-amber-500/15 border-amber-500/30 text-amber-400",
      icon: <AlertTriangle className="w-5 h-5 text-amber-400" />,
      label: "Needs Improvement",
    },
    "Reconstruction failed": {
      bg: "bg-rose-500/15 border-rose-500/30 text-rose-400",
      icon: <XCircle className="w-5 h-5 text-rose-400" />,
      label: "Reconstruction Failed",
    },
  }[status];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 lg:p-6 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl max-h-[92vh] flex flex-col bg-card/95 border border-border/80 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 lg:p-5 border-b border-border/60 bg-muted/20">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl border ${statusBadge.bg}`}>{statusBadge.icon}</div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base lg:text-lg font-bold text-foreground">
                  Reconstruction Quality Report
                </h2>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-semibold border ${statusBadge.bg}`}
                >
                  {statusBadge.label}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{summary}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-5">
          {/* Note on Camera Poses */}
          <div className="p-3.5 rounded-xl bg-blue-950/30 border border-blue-500/30 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <div className="text-xs text-blue-200/90 leading-relaxed">
              <span className="font-semibold text-blue-300">Camera Pose Note: </span>
              In browser scanning mode, camera poses are computed from guided-capture orbit angles
              and optical baseline fine-tuning rather than full Structure-from-Motion (SfM) bundle
              adjustment. Reprojection error and inlier rates are estimated from epipolar feature
              matching. For full SfM camera solving, switch to the Self-Hosted COLMAP engine in
              Settings.
            </div>
          </div>

          {/* Composite Quality Score */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-purple-950/40 via-background to-background border border-purple-500/20 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider">
                Reconstruction Fidelity Score
              </span>
              <p className="text-xs text-muted-foreground">
                Derived directly from camera registration, estimated reprojection error, and mesh
                surface density.
              </p>
            </div>
            <div className="flex items-baseline gap-1 bg-purple-900/40 px-3 py-1.5 rounded-xl border border-purple-500/30">
              <span className="text-2xl font-black text-purple-200">{score}</span>
              <span className="text-xs text-purple-400">/ 100</span>
            </div>
          </div>

          {/* Measured Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <div className="p-3 rounded-xl bg-muted/30 border border-border/50">
              <span className="text-[11px] text-muted-foreground block">Camera Registration</span>
              <div className="text-sm font-bold text-foreground mt-0.5">
                {metrics.registeredCameras} / {metrics.totalPhotos} (
                {metrics.registrationPercentage}%)
              </div>
              <span className="text-[10px] text-emerald-400">
                {metrics.registrationPercentage >= 80 ? "✓ High alignment" : "⚠ Partial alignment"}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-muted/30 border border-border/50">
              <span className="text-[11px] text-muted-foreground block">
                Reprojection Error (Est.)
              </span>
              <div className="text-sm font-bold text-foreground mt-0.5">
                ~{metrics.meanReprojectionErrorPx} px
              </div>
              <span className="text-[10px] text-muted-foreground">
                {metrics.meanReprojectionErrorPx <= 3.0
                  ? "✓ Estimated sharp rays"
                  : "⚠ High deviation (est.)"}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-muted/30 border border-border/50">
              <span className="text-[11px] text-muted-foreground block">Sparse Points</span>
              <div className="text-sm font-bold text-foreground mt-0.5">
                {metrics.sparsePointCount.toLocaleString()} pts
              </div>
              <span className="text-[10px] text-muted-foreground">Optical inliers</span>
            </div>

            <div className="p-3 rounded-xl bg-muted/30 border border-border/50">
              <span className="text-[11px] text-muted-foreground block">Mesh Triangles</span>
              <div className="text-sm font-bold text-foreground mt-0.5">
                {metrics.triangleCount.toLocaleString()} tris
              </div>
              <span className="text-[10px] text-muted-foreground">
                {metrics.vertexCount.toLocaleString()} vertices
              </span>
            </div>

            <div className="p-3 rounded-xl bg-muted/30 border border-border/50">
              <span className="text-[11px] text-muted-foreground block">Texture Map Atlas</span>
              <div className="text-sm font-bold text-foreground mt-0.5">
                {metrics.textureResolution} × {metrics.textureResolution}
              </div>
              <span className="text-[10px] text-muted-foreground">sRGB PBR Baked</span>
            </div>

            <div className="p-3 rounded-xl bg-muted/30 border border-border/50">
              <span className="text-[11px] text-muted-foreground block">GLB 2.0 Export</span>
              <div className="text-sm font-bold text-emerald-400 mt-0.5 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                {metrics.exportValid ? "Verified Valid" : "Invalid"}
              </div>
              <span className="text-[10px] text-muted-foreground">Standard binary glTF</span>
            </div>
          </div>

          {/* Diagnostics Section */}
          {diagnostics.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                Detected Reconstruction Diagnostics
              </h3>
              <div className="space-y-1.5">
                {diagnostics.map((diag, i) => (
                  <div
                    key={i}
                    className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200 flex items-start gap-2"
                  >
                    <span className="text-amber-400 font-bold">•</span>
                    <span>{diag}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommended Corrective Actions */}
          {suggestedActions.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-primary" />
                Recommended Actions
              </h3>
              <div className="space-y-1.5">
                {suggestedActions.map((action, i) => (
                  <div
                    key={i}
                    className="p-2.5 rounded-lg bg-muted/40 border border-border/50 text-xs text-muted-foreground flex items-start gap-2"
                  >
                    <ChevronRight className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                    <span>{action}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Automatic Retry Suggestion */}
          {retryRecommendation && onRetry && (
            <div className="p-3.5 rounded-xl bg-purple-950/30 border border-purple-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-purple-200 flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 text-purple-400" />
                  Auto-Retry with Optimized Parameters
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {retryRecommendation.reason} ({retryRecommendation.strategy})
                </p>
              </div>
              <Button
                variant="default"
                size="sm"
                onClick={() => onRetry(retryRecommendation.strategy)}
                className="gap-1.5 text-xs bg-purple-600 hover:bg-purple-700 shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry Reconstruction
              </Button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-border/60 bg-muted/20">
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs">
            Review Details
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={onContinue}
            className="text-xs gap-1.5 bg-primary hover:bg-primary/90"
          >
            <span>Inspect 3D Model</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
