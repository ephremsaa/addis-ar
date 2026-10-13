export interface ReconstructionMetrics {
  totalPhotos: number;
  registeredCameras: number;
  registrationPercentage: number;
  sparsePointCount: number;
  densePointCount: number;
  vertexCount: number;
  triangleCount: number;
  textureResolution: number;
  meanReprojectionErrorPx: number;
  disconnectedComponentsCount: number;
  surfaceCoverageScore: number; // 0 - 100%
  exportValid: boolean;
  warnings: string[];
}

export type OverallQualityStatus = 'Good' | 'Needs improvement' | 'Reconstruction failed';

export interface QualityReport {
  status: OverallQualityStatus;
  score: number; // 0 - 100
  summary: string;
  metrics: ReconstructionMetrics;
  diagnostics: string[];
  suggestedActions: string[];
  retryRecommendation?: {
    canAutoRetry: boolean;
    reason: string;
    strategy: 'filter-blurry' | 'relax-features' | 'conservative-carving' | 'recompute-textures';
  };
}

/**
 * Computes a genuine reconstruction quality report based strictly on measured values.
 */
export function generateQualityReport(metrics: ReconstructionMetrics): QualityReport {
  const diagnostics: string[] = [];
  const suggestedActions: string[] = [];

  // Criteria 1: Camera Registration
  if (metrics.registrationPercentage < 50) {
    diagnostics.push(
      `Severe camera misalignment: only ${metrics.registeredCameras}/${metrics.totalPhotos} (${metrics.registrationPercentage}%) photographs registered.`
    );
    suggestedActions.push(
      'Capture additional overlapping views (approx 15-20° intervals) so visual features overlap reliably.'
    );
  } else if (metrics.registrationPercentage < 75) {
    diagnostics.push(
      `Moderate camera alignment: ${metrics.registrationPercentage}% cameras registered.`
    );
    suggestedActions.push(
      'Ensure the background does not change between shots and the object stays stationary.'
    );
  }

  // Criteria 2: Reprojection Error
  if (metrics.meanReprojectionErrorPx > 4.5) {
    diagnostics.push(
      `High reprojection error (${metrics.meanReprojectionErrorPx} px). Feature correspondences deviate from calibrated optical rays.`
    );
    suggestedActions.push('Ensure photos are crisp and avoid rapid motion blur during capture.');
  }

  // Criteria 3: Surface & Geometric Density
  if (metrics.triangleCount < 800) {
    diagnostics.push(
      `Sparse geometric mesh: model contains only ${metrics.triangleCount} triangles. Small details may be missing.`
    );
    suggestedActions.push(
      'Switch quality preset to "High Quality" or provide photos closer to the object.'
    );
  }

  // Criteria 4: Disconnected Components
  if (metrics.disconnectedComponentsCount > 10) {
    diagnostics.push(
      `Detected ${metrics.disconnectedComponentsCount} floating disconnected background fragments.`
    );
    suggestedActions.push(
      'Use mesh cleanup "Remove debris" to isolate the primary object or trim background shadows.'
    );
  }

  // Criteria 5: Coverage Completeness
  if (metrics.surfaceCoverageScore < 60) {
    diagnostics.push(
      `Incomplete angle coverage (${metrics.surfaceCoverageScore}%): rear or elevated surfaces lack views.`
    );
    suggestedActions.push('Capture top-down and back-side angles to fill uncovered surfaces.');
  }

  // Append any runtime warnings
  for (const w of metrics.warnings) {
    if (!diagnostics.includes(w)) {
      diagnostics.push(w);
    }
  }

  // Compute composite score (strictly derived from measurements)
  let score = 100;

  // Penalize low registration
  if (metrics.registrationPercentage < 100) {
    score -= (100 - metrics.registrationPercentage) * 0.4;
  }

  // Penalize high reprojection error
  if (metrics.meanReprojectionErrorPx > 1.5) {
    score -= Math.min(25, (metrics.meanReprojectionErrorPx - 1.5) * 5);
  }

  // Penalize low triangle count
  if (metrics.triangleCount < 1500) {
    score -= Math.min(20, ((1500 - metrics.triangleCount) / 1500) * 20);
  }

  // Penalize low coverage
  if (metrics.surfaceCoverageScore < 80) {
    score -= (80 - metrics.surfaceCoverageScore) * 0.25;
  }

  score = Math.max(10, Math.min(100, Math.round(score)));

  let status: OverallQualityStatus = 'Good';
  let summary = 'High-fidelity 3D reconstruction successfully verified.';

  if (metrics.registrationPercentage < 40 || metrics.triangleCount < 300 || !metrics.exportValid) {
    status = 'Reconstruction failed';
    summary = 'Reconstruction failed to produce a coherent 3D model due to insufficient data or alignment.';
  } else if (score < 75 || diagnostics.length >= 2) {
    status = 'Needs improvement';
    summary = 'Model reconstructed with usable geometry, but quality can be improved with additional angle coverage.';
  }

  // Determine retry recommendation
  let retryRecommendation: QualityReport['retryRecommendation'] = undefined;

  if (status !== 'Good') {
    if (metrics.meanReprojectionErrorPx > 3.8) {
      retryRecommendation = {
        canAutoRetry: true,
        reason: 'Outlier feature points distorted camera projection.',
        strategy: 'relax-features',
      };
    } else if (metrics.disconnectedComponentsCount > 5) {
      retryRecommendation = {
        canAutoRetry: true,
        reason: 'Excess background fragments attached to object.',
        strategy: 'conservative-carving',
      };
    } else {
      retryRecommendation = {
        canAutoRetry: true,
        reason: 'Lighting variance across views caused texture seam artifacts.',
        strategy: 'recompute-textures',
      };
    }
  }

  return {
    status,
    score,
    summary,
    metrics,
    diagnostics,
    suggestedActions,
    retryRecommendation,
  };
}
