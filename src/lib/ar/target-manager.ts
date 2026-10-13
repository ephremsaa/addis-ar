import {
  TargetAnalyzer,
  type ROI,
  type TrackabilityReport,
} from './vision/target-analyzer';

export interface LockedTargetData {
  id: string;
  label: string;
  templateData: Uint8Array;
  templateWidth: number;
  templateHeight: number;
  snapshotUrl: string;
  initialScore: number;
  roi: ROI;
  lockedAt: number;
}

export type TargetEventCallback = (
  candidate: TrackabilityReport | null,
  locked: LockedTargetData | null
) => void;

export class TargetManager {
  private candidate: TrackabilityReport | null = null;
  private currentROI: ROI = { x: 0.35, y: 0.35, width: 0.3, height: 0.3 };
  private lockedTarget: LockedTargetData | null = null;
  private listeners: Set<TargetEventCallback> = new Set();

  public subscribe(cb: TargetEventCallback): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify() {
    for (const cb of this.listeners) {
      cb(this.candidate, this.lockedTarget);
    }
  }

  public getCandidate(): TrackabilityReport | null {
    return this.candidate;
  }

  public getLockedTarget(): LockedTargetData | null {
    return this.lockedTarget;
  }

  public getROI(): ROI {
    return this.currentROI;
  }

  public setROI(roi: ROI) {
    this.currentROI = roi;
  }

  /**
   * Scans the camera video image at the current reticle ROI and analyzes trackability.
   */
  public scanTarget(video: HTMLVideoElement, roi?: ROI): TrackabilityReport {
    if (roi) {
      this.currentROI = roi;
    }
    const report = TargetAnalyzer.analyzeRegion(video, this.currentROI);
    this.candidate = report;
    this.notify();
    return report;
  }

  /**
   * Confirms the scanned candidate and locks it as the active tracking target.
   */
  public confirmCandidate(video: HTMLVideoElement, label = 'Focused Target'): boolean {
    if (!this.candidate || this.candidate.quality === 'unsuitable') {
      return false;
    }

    const template = TargetAnalyzer.extractTemplate(video, this.currentROI, 40, 40);

    this.lockedTarget = {
      id: crypto.randomUUID(),
      label,
      templateData: template.data,
      templateWidth: template.width,
      templateHeight: template.height,
      snapshotUrl: template.snapshotUrl || this.candidate.snapshotUrl || '',
      initialScore: this.candidate.score,
      roi: { ...this.currentROI },
      lockedAt: Date.now(),
    };

    this.notify();
    return true;
  }

  /**
   * Unlocks the current target, allowing the user to select another target.
   */
  public unlockTarget(): void {
    this.lockedTarget = null;
    this.notify();
  }

  /**
   * Clears candidate analysis and resets reticle state.
   */
  public clear(): void {
    this.candidate = null;
    this.lockedTarget = null;
    this.notify();
  }
}
