import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Camera,
  Video,
  VideoOff,
  Crosshair,
  Lock,
  Unlock,
  RefreshCw,
  CameraOff,
  Move,
  RotateCw,
  Scaling,
  Maximize2,
  Box,
  Eye,
  EyeOff,
  Download,
  ArrowLeft,
  Sliders,
  Sparkles,
  Info,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  QrCode,
  X,
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ARSessionManager, type ARSessionState } from '@/lib/ar/ar-session-manager';
import { PlacementController } from '@/lib/ar/placement-controller';
import { MarkerDetector } from '@/lib/ar/vision/marker-detector';
import {
  type Project,
  type SceneObject,
  type TrackingMode,
  trackingModes,
} from '@/lib/ar/projects';

interface ARWorkspaceProps {
  project: Project;
  initialSelectedId?: string;
  onUpdateProject?: (updated: Project) => void;
  onReturnToEditor: () => void;
}

export function ARWorkspace({
  project,
  initialSelectedId = '',
  onUpdateProject,
  onReturnToEditor,
}: ARWorkspaceProps) {
  const [currentProject, setCurrentProject] = useState<Project>(project);
  const [selectedId, setSelectedId] = useState<string>(
    initialSelectedId || project.objects[0]?.id || ''
  );
  const [sessionManager] = useState(() => new ARSessionManager());
  const [sessionState, setSessionState] = useState<ARSessionState>(() =>
    sessionManager.getState()
  );

  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [uniformScale, setUniformScale] = useState(true);
  const [showMarkerDialog, setShowMarkerDialog] = useState(false);
  const [showInfoDialog, setShowInfoDialog] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string>('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Synchronize session manager state
  useEffect(() => {
    const unsub = sessionManager.subscribe((newState) => {
      setSessionState(newState);
    });
    return () => unsub();
  }, [sessionManager]);

  // Initialize renderer and camera binding
  useEffect(() => {
    let mounted = true;
    if (viewportRef.current && videoRef.current) {
      sessionManager
        .initSession(
          viewportRef.current,
          videoRef.current,
          currentProject.objects,
          selectedId
        )
        .catch(console.error);
    }

    const handleResize = () => {
      if (mounted) {
        sessionManager.handleResize();
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      mounted = false;
      window.removeEventListener('resize', handleResize);
      sessionManager.dispose();
    };
  }, [sessionManager]);

  // Synchronize objects with 3D scene renderer
  useEffect(() => {
    sessionManager.updateObjects(currentProject.objects, selectedId);
    if (onUpdateProject) {
      onUpdateProject(currentProject);
    }
  }, [currentProject, selectedId, sessionManager, onUpdateProject]);

  const selectedObject = currentProject.objects.find((o) => o.id === selectedId);

  const updateSelectedObject = useCallback(
    (modifier: (obj: SceneObject) => SceneObject) => {
      if (!selectedObject) return;
      const updated = modifier(selectedObject);
      setCurrentProject((prev) => ({
        ...prev,
        objects: prev.objects.map((o) => (o.id === updated.id ? updated : o)),
        updated: Date.now(),
      }));
    },
    [selectedObject]
  );

  const handleStartCamera = async () => {
    try {
      await sessionManager.startCamera();
      setFeedbackMessage('Camera connected. Point at your target.');
    } catch (e) {
      setFeedbackMessage(e instanceof Error ? e.message : 'Camera failed to start.');
    }
  };

  const handleStopCamera = () => {
    sessionManager.stopCamera();
    setFeedbackMessage('Camera stopped.');
  };

  const handleScanTarget = () => {
    const report = sessionManager.scanTarget();
    if (!report) {
      setFeedbackMessage('Start the camera first to scan a target.');
      return;
    }
    setFeedbackMessage(
      `Analyzed target: Score ${report.score}/100 (${report.quality}). ${report.message}`
    );
  };

  const handleConfirmTarget = () => {
    const success = sessionManager.confirmTarget('Target');
    if (success) {
      setFeedbackMessage('Target locked! Virtual content is now anchored to target.');
    } else {
      setFeedbackMessage('Cannot lock: target lacks distinct visual contrast or texture.');
    }
  };

  const handleUnlockTarget = () => {
    sessionManager.unlockTarget();
    setFeedbackMessage('Target unlocked. Realign reticle and scan another target.');
  };

  const handleModeChange = (mode: TrackingMode) => {
    sessionManager.setTrackingMode(mode);
    setCurrentProject((prev) => ({
      ...prev,
      arConfig: {
        ...(prev.arConfig || {
          trackingMode: mode,
          confidenceThreshold: 0.4,
          smoothingFactor: 0.4,
          lockedTarget: false,
        }),
        trackingMode: mode,
      },
    }));
  };

  const handleSnapToTarget = () => {
    if (selectedObject) {
      updateSelectedObject((obj) => PlacementController.snapToTarget(obj));
      setFeedbackMessage(`“${selectedObject.name}” snapped to target origin.`);
    }
  };

  const handleAlignToSurface = () => {
    if (selectedObject) {
      updateSelectedObject((obj) => PlacementController.alignToSurface(obj));
      setFeedbackMessage(`“${selectedObject.name}” aligned to surface plane.`);
    }
  };

  const handlePlaceInFront = () => {
    if (selectedObject) {
      updateSelectedObject((obj) => PlacementController.placeInFrontOfCamera(obj, 1.5));
      setFeedbackMessage(`“${selectedObject.name}” placed in front of view.`);
    }
  };

  const handleResetPlacement = () => {
    if (selectedObject) {
      updateSelectedObject((obj) => PlacementController.resetTransform(obj));
      setFeedbackMessage(`“${selectedObject.name}” transforms reset.`);
    }
  };

  const handleScreenshot = async () => {
    setFeedbackMessage('Capturing AR screenshot…');
    await sessionManager.captureScreenshot(currentProject.name);
    setFeedbackMessage('AR screenshot saved to downloads.');
  };

  const trackingReport = sessionState.trackingReport;
  const targetBounds = trackingReport.targetBounds;

  return (
    <div className="ar-workspace">
      {/* Top Header */}
      <header className="ar-topbar">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onReturnToEditor}
            className="gap-2 text-foreground"
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">Return to editor</span>
          </Button>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2 font-semibold">
            <img src="/logo.png" alt="Addis AR logo" className="w-5 h-5 object-contain rounded" />
            <span className="truncate max-w-[160px] sm:max-w-xs">{currentProject.name}</span>
            <span className="rounded bg-accent px-2 py-0.5 text-[10px] text-accent-foreground">
              AR Camera
            </span>
          </div>
        </div>

        {/* Center Tracking Pill */}
        <div className="flex items-center gap-2">
          <div
            className={`ar-tracking-badge state-${trackingReport.state}`}
            title={trackingReport.statusText}
          >
            <span className="ar-dot" />
            <span className="text-xs font-semibold uppercase tracking-wider">
              {trackingReport.state === 'reliable'
                ? 'Target Tracked'
                : trackingReport.state === 'uncertain'
                ? 'Tracking Uncertain'
                : 'Target Lost'}
            </span>
            <span className="text-[10px] opacity-75 font-mono">
              {Math.round(trackingReport.confidence * 100)}%
            </span>
          </div>
        </div>

        {/* Top Controls */}
        <div className="flex items-center gap-2">
          {sessionState.availableCameras.length > 1 && (
            <select
              aria-label="Select camera device"
              value={sessionState.selectedCameraId}
              onChange={(e) => sessionManager.camera.switchCamera(e.target.value)}
              className="text-xs max-w-[140px] truncate"
            >
              {sessionState.availableCameras.map((c) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.label || 'Camera'}
                </option>
              ))}
            </select>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => sessionManager.camera.toggleFacingMode()}
            title="Switch front/back camera"
            className="hidden sm:inline-flex"
          >
            <RefreshCw size={14} />
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleScreenshot}
            title="Capture AR screenshot"
            className="gap-1.5"
          >
            <Download size={14} />
            <span className="hidden sm:inline">Screenshot</span>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowInfoDialog(true)}
            title="About Addis AR Tracking"
          >
            <HelpCircle size={17} />
          </Button>
        </div>
      </header>

      {/* Main AR Body */}
      <div className="ar-body">
        {/* Left Panel: Scene Objects & Target Config */}
        <aside className={`ar-panel left ${leftPanelOpen ? 'open' : 'closed'}`}>
          <div className="panel-header">
            <span className="panel-title-text">Scene & Target</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setLeftPanelOpen(!leftPanelOpen)}
            >
              {leftPanelOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </Button>
          </div>

          <div className="panel-content">
            {/* Tracking Mode Selection */}
            <div className="ar-section">
              <label className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase mb-2 block">
                Tracking Mode
              </label>
              <div className="grid grid-cols-2 gap-1.5 mb-2">
                <Button
                  size="sm"
                  variant={trackingReport.mode === 'focus-target' ? 'secondary' : 'ghost'}
                  onClick={() => handleModeChange('focus-target')}
                  className="text-xs justify-start px-2.5 h-8 font-medium"
                >
                  <Crosshair size={13} className="mr-1.5 text-primary" />
                  Focus Target
                </Button>
                <Button
                  size="sm"
                  variant={trackingReport.mode === 'marker' ? 'secondary' : 'ghost'}
                  onClick={() => handleModeChange('marker')}
                  className="text-xs justify-start px-2.5 h-8 font-medium"
                >
                  <QrCode size={13} className="mr-1.5 text-primary" />
                  Marker AR
                </Button>
                <Button
                  size="sm"
                  variant={trackingReport.mode === 'device-orientation' ? 'secondary' : 'ghost'}
                  onClick={() => handleModeChange('device-orientation')}
                  className="text-xs justify-start px-2.5 h-8 font-medium"
                >
                  <Move size={13} className="mr-1.5 text-primary" />
                  Gyro Orientation
                </Button>
                <Button
                  size="sm"
                  variant={trackingReport.mode === 'webxr-plane' ? 'secondary' : 'ghost'}
                  onClick={() => handleModeChange('webxr-plane')}
                  className="text-xs justify-start px-2.5 h-8 font-medium"
                >
                  <Layers size={13} className="mr-1.5 text-primary" />
                  WebXR Plane
                </Button>
              </div>

              {trackingReport.mode === 'marker' && (
                <div className="mt-2 rounded-md bg-secondary/60 p-2.5 border border-border">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Uses high-precision optical fiducial tracking for 6DOF pose estimation.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2 h-7 text-xs gap-1.5"
                    onClick={() => setShowMarkerDialog(true)}
                  >
                    <QrCode size={13} />
                    View / Print Test Marker
                  </Button>
                </div>
              )}

              {trackingReport.mode === 'webxr-plane' && !sessionState.isWebXRSupported && (
                <div className="mt-2 rounded-md bg-destructive/15 p-2.5 border border-destructive/30 text-destructive text-[11px]">
                  WebXR Immersive-AR is not supported on this device. Use Focus Target or Marker AR
                  for compatible in-browser tracking.
                </div>
              )}
            </div>

            {/* Target Analysis & Lock Card */}
            {trackingReport.mode === 'focus-target' && (
              <div className="ar-section">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase block">
                    Target Status
                  </label>
                  {sessionState.lockedTarget ? (
                    <span className="flex items-center gap-1 text-[11px] text-success">
                      <Lock size={12} />
                      Locked
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">Uncalibrated</span>
                  )}
                </div>

                {sessionState.lockedTarget ? (
                  <div className="rounded-md border border-border bg-secondary/50 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">
                        {sessionState.lockedTarget.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        Score: {sessionState.lockedTarget.initialScore}/100
                      </span>
                    </div>
                    {sessionState.lockedTarget.snapshotUrl && (
                      <div className="h-16 w-full rounded overflow-hidden border border-border/60 bg-black/40">
                        <img
                          src={sessionState.lockedTarget.snapshotUrl}
                          alt="Locked target reference"
                          className="h-full w-full object-cover"
                        />
                      </div>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleUnlockTarget}
                      className="w-full h-7 text-xs gap-1.5 text-destructive hover:text-destructive"
                    >
                      <Unlock size={12} />
                      Unlock & Select New Target
                    </Button>
                  </div>
                ) : sessionState.targetCandidate ? (
                  <div className="rounded-md border border-border bg-secondary/50 p-3 space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-medium">Trackability</span>
                      <span
                        className={`font-semibold capitalize text-[11px] ${
                          sessionState.targetCandidate.quality === 'excellent'
                            ? 'text-success'
                            : sessionState.targetCandidate.quality === 'good'
                            ? 'text-cyan'
                            : sessionState.targetCandidate.quality === 'fair'
                            ? 'text-amber-400'
                            : 'text-destructive'
                        }`}
                      >
                        {sessionState.targetCandidate.quality} ({sessionState.targetCandidate.score}%)
                      </span>
                    </div>

                    <div className="w-full bg-border h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-primary h-full transition-all duration-300"
                        style={{ width: `${sessionState.targetCandidate.score}%` }}
                      />
                    </div>

                    <p className="text-[11px] text-muted-foreground leading-snug">
                      {sessionState.targetCandidate.message}
                    </p>

                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={handleScanTarget}
                        className="flex-1 h-7 text-xs"
                      >
                        Rescan
                      </Button>
                      <Button
                        size="sm"
                        disabled={sessionState.targetCandidate.quality === 'unsuitable'}
                        onClick={handleConfirmTarget}
                        className="flex-1 h-7 text-xs gap-1"
                      >
                        <Lock size={12} />
                        Confirm & Lock
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-border p-3 text-center space-y-2">
                    <p className="text-[11px] text-muted-foreground">
                      Point center reticle at an object, surface, or image with distinct visual contrast.
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={handleScanTarget}
                      className="w-full h-7 text-xs gap-1.5"
                    >
                      <Crosshair size={13} />
                      Scan Target Under Reticle
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Scene Objects Hierarchy */}
            <div className="ar-section">
              <label className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase mb-2 block">
                Scene Objects ({currentProject.objects.length})
              </label>
              <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                {currentProject.objects.map((obj) => (
                  <div
                    key={obj.id}
                    className={`flex items-center justify-between rounded px-2 py-1.5 text-xs transition-colors ${
                      selectedId === obj.id
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'hover:bg-secondary/60 text-muted-foreground'
                    }`}
                  >
                    <button
                      className="flex items-center gap-2 flex-1 text-left truncate mr-2"
                      onClick={() => setSelectedId(obj.id)}
                    >
                      <Box size={13} />
                      <span className="truncate">{obj.name}</span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground"
                      onClick={() =>
                        setCurrentProject((prev) => ({
                          ...prev,
                          objects: prev.objects.map((o) =>
                            o.id === obj.id ? { ...o, visible: !o.visible } : o
                          ),
                        }))
                      }
                    >
                      {obj.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* Center Viewport: Video Feed & WebGL Overlay */}
        <main className="ar-viewport" ref={viewportRef}>
          {/* Live Camera Stream Video */}
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="ar-video-feed"
          />

          {/* Central Aiming Reticle */}
          {sessionState.cameraStatus === 'running' && !sessionState.lockedTarget && (
            <div className="ar-reticle-container">
              <div className="ar-reticle">
                <div className="corner top-left" />
                <div className="corner top-right" />
                <div className="corner bottom-left" />
                <div className="corner bottom-right" />
                <div className="center-dot" />
              </div>
              <span className="ar-reticle-label">ALIGN TARGET IN RETICLE</span>
            </div>
          )}

          {/* Target Bounding Box Highlight */}
          {targetBounds && (
            <div
              className="ar-target-bounds"
              style={{
                left: `${targetBounds.x * 100}%`,
                top: `${targetBounds.y * 100}%`,
                width: `${targetBounds.width * 100}%`,
                height: `${targetBounds.height * 100}%`,
              }}
            >
              <div className="ar-bounds-tag">
                <Sparkles size={10} />
                {sessionState.lockedTarget?.label ||
                  (trackingReport.detectedMarkerId !== undefined
                    ? `Marker #${trackingReport.detectedMarkerId}`
                    : 'Tracked Target')}
              </div>
            </div>
          )}

          {/* Insecure Context or Permission Notice */}
          {sessionState.cameraStatus === 'insecure' && (
            <div className="ar-overlay-banner">
              <ShieldAlert className="text-amber-400" size={28} />
              <div>
                <h3 className="font-semibold text-sm">Secure Context (HTTPS) Required</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Browser camera security policies require HTTPS or localhost. If testing over a local
                  network, serve through an HTTPS tunnel or localhost.
                </p>
              </div>
            </div>
          )}

          {sessionState.cameraStatus === 'denied' && (
            <div className="ar-overlay-banner">
              <AlertCircle className="text-destructive" size={28} />
              <div>
                <h3 className="font-semibold text-sm">Camera Permission Denied</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Please enable camera permission in your browser URL bar or site settings to enable AR.
                </p>
                <Button size="sm" onClick={handleStartCamera} className="mt-3 text-xs">
                  Retry Camera Permission
                </Button>
              </div>
            </div>
          )}

          {sessionState.cameraStatus === 'idle' && (
            <div className="ar-idle-hero">
              <div className="rounded-full bg-secondary p-4 border border-border">
                <Camera size={36} className="text-primary" />
              </div>
              <h2 className="text-xl font-bold mt-4">Real-World AR Camera</h2>
              <p className="text-xs text-muted-foreground max-w-sm mt-1.5 leading-relaxed">
                Open your device webcam or phone rear camera to anchor your 3D creations onto real surfaces,
                posters, or markers.
              </p>
              <Button onClick={handleStartCamera} className="mt-5 gap-2 px-6">
                <Video size={16} />
                Start Camera
              </Button>
            </div>
          )}

          {/* Live Floating Status Message */}
          {feedbackMessage && (
            <div className="ar-toast-banner">
              <Info size={13} className="text-primary" />
              <span>{feedbackMessage}</span>
              <button
                onClick={() => setFeedbackMessage('')}
                className="ml-2 text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </div>
          )}
        </main>

        {/* Right Panel: Selected Object Transform Tools */}
        <aside className={`ar-panel right ${rightPanelOpen ? 'open' : 'closed'}`}>
          <div className="panel-header">
            <span className="panel-title-text">Placement & Transforms</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setRightPanelOpen(!rightPanelOpen)}
            >
              {rightPanelOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </Button>
          </div>

          <div className="panel-content">
            {selectedObject ? (
              <>
                <div className="ar-section">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold">{selectedObject.name}</span>
                    <span className="text-[10px] text-muted-foreground capitalize">
                      {selectedObject.kind}
                    </span>
                  </div>

                  {/* Quick Action Placement Buttons */}
                  <div className="grid grid-cols-2 gap-1.5 mb-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleSnapToTarget}
                      className="text-xs h-7 justify-start"
                      title="Snap object to target origin"
                    >
                      <Crosshair size={12} className="mr-1.5 text-primary" />
                      Snap to Target
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleAlignToSurface}
                      className="text-xs h-7 justify-start"
                      title="Align bottom to ground plane"
                    >
                      <Layers size={12} className="mr-1.5 text-primary" />
                      Align to Surface
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handlePlaceInFront}
                      className="text-xs h-7 justify-start"
                      title="Place 1.5m in front of camera"
                    >
                      <Box size={12} className="mr-1.5 text-primary" />
                      In Front of View
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleResetPlacement}
                      className="text-xs h-7 justify-start"
                      title="Reset position, rotation and scale"
                    >
                      <RefreshCw size={12} className="mr-1.5 text-primary" />
                      Reset Transform
                    </Button>
                  </div>
                </div>

                {/* Transform Numeric Fields */}
                <div className="ar-section">
                  {/* Position */}
                  <div className="mb-3">
                    <div className="flex justify-between items-center text-[11px] text-muted-foreground mb-1">
                      <span className="font-semibold uppercase tracking-wider flex items-center gap-1">
                        <Move size={11} /> Position (m)
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                        <div key={axis} className="flex flex-col">
                          <label className="text-[9px] text-muted-foreground mb-0.5">{axis}</label>
                          <input
                            aria-label={`Position ${axis}`}
                            type="number"
                            step="0.05"
                            className="text-xs py-1 px-1.5 text-center font-mono"
                            value={Number(selectedObject.position[idx].toFixed(2))}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              if (Number.isFinite(val)) {
                                updateSelectedObject((obj) =>
                                  PlacementController.fineStep(
                                    obj,
                                    'position',
                                    idx as 0 | 1 | 2,
                                    val - obj.position[idx]
                                  )
                                );
                              }
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Rotation */}
                  <div className="mb-3">
                    <div className="flex justify-between items-center text-[11px] text-muted-foreground mb-1">
                      <span className="font-semibold uppercase tracking-wider flex items-center gap-1">
                        <RotateCw size={11} /> Rotation (deg)
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                        <div key={axis} className="flex flex-col">
                          <label className="text-[9px] text-muted-foreground mb-0.5">{axis}</label>
                          <input
                            aria-label={`Rotation ${axis}`}
                            type="number"
                            step="15"
                            className="text-xs py-1 px-1.5 text-center font-mono"
                            value={Number(((selectedObject.rotation[idx] * 180) / Math.PI).toFixed(0))}
                            onChange={(e) => {
                              const deg = Number(e.target.value);
                              if (Number.isFinite(deg)) {
                                const rad = (deg * Math.PI) / 180;
                                updateSelectedObject((obj) => {
                                  const rot = [...obj.rotation] as [number, number, number];
                                  rot[idx] = rad;
                                  return { ...obj, rotation: rot };
                                });
                              }
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Scale */}
                  <div className="mb-2">
                    <div className="flex justify-between items-center text-[11px] text-muted-foreground mb-1">
                      <span className="font-semibold uppercase tracking-wider flex items-center gap-1">
                        <Scaling size={11} /> Scale
                      </span>
                      <button
                        onClick={() => setUniformScale(!uniformScale)}
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          uniformScale ? 'bg-primary/20 text-primary' : 'text-muted-foreground'
                        }`}
                      >
                        {uniformScale ? 'Uniform' : 'Independent'}
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                        <div key={axis} className="flex flex-col">
                          <label className="text-[9px] text-muted-foreground mb-0.5">{axis}</label>
                          <input
                            aria-label={`Scale ${axis}`}
                            type="number"
                            step="0.1"
                            min="0.05"
                            className="text-xs py-1 px-1.5 text-center font-mono"
                            value={Number(selectedObject.scale[idx].toFixed(2))}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              if (Number.isFinite(val) && val > 0) {
                                if (uniformScale) {
                                  updateSelectedObject((obj) =>
                                    PlacementController.setUniformScale(obj, val)
                                  );
                                } else {
                                  updateSelectedObject((obj) => {
                                    const sc = [...obj.scale] as [number, number, number];
                                    sc[idx] = val;
                                    return { ...obj, scale: sc };
                                  });
                                }
                              }
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground py-4 text-center">
                Select an object from the Scene list to inspect and reposition.
              </p>
            )}

            {/* Tracking Settings */}
            <div className="ar-section mt-4 pt-3 border-t border-border">
              <label className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase mb-2 block">
                Tracking Stability
              </label>
              <div className="space-y-2">
                <div>
                  <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                    <span>Smoothing Filter</span>
                    <span>Adaptive</span>
                  </div>
                  <input
                    aria-label="Smoothing filter"
                    type="range"
                    min="0.1"
                    max="0.8"
                    step="0.05"
                    defaultValue="0.4"
                    className="material-slider"
                    onChange={(e) =>
                      sessionManager.tracking.setSmoothingFactor(Number(e.target.value))
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Bottom Main Toolbar */}
      <footer className="ar-bottom-bar">
        <div className="flex items-center gap-2">
          {sessionState.cameraStatus === 'running' ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleStopCamera}
              className="gap-1.5 text-destructive border-destructive/40"
            >
              <VideoOff size={14} />
              <span>Stop Camera</span>
            </Button>
          ) : (
            <Button size="sm" onClick={handleStartCamera} className="gap-1.5">
              <Video size={14} />
              <span>Start Camera</span>
            </Button>
          )}

          {sessionState.cameraStatus === 'running' && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleScanTarget}
                className="gap-1.5"
              >
                <Crosshair size={14} />
                <span>Scan Target</span>
              </Button>

              {sessionState.targetCandidate && !sessionState.lockedTarget && (
                <Button
                  size="sm"
                  onClick={handleConfirmTarget}
                  className="gap-1.5 bg-primary text-primary-foreground"
                >
                  <Lock size={14} />
                  <span>Lock Target</span>
                </Button>
              )}

              {selectedObject && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSnapToTarget}
                  className="gap-1.5 hidden sm:inline-flex"
                >
                  <Box size={14} />
                  <span>Place Object</span>
                </Button>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResetPlacement}
            className="text-xs hidden md:inline-flex"
          >
            Reset Placement
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleScreenshot}
            className="gap-1.5"
          >
            <Download size={14} />
            <span className="hidden sm:inline">Capture</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={onReturnToEditor} className="gap-1.5">
            <ArrowLeft size={14} />
            <span>Exit AR</span>
          </Button>
        </div>
      </footer>

      {/* Printable Test Marker Modal */}
      {showMarkerDialog && (
        <div className="dialog-scrim" onClick={() => setShowMarkerDialog(false)}>
          <div className="dialog-box max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-bold">Addis AR Test Marker</h2>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setShowMarkerDialog(false)}
              >
                <X size={15} />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Print this marker or display it on your phone screen to test real optical fiducial tracking.
              Point your camera at the marker to anchor your 3D objects.
            </p>
            <div className="flex justify-center p-4 my-3 bg-white rounded-lg border border-border">
              <img
                src={MarkerDetector.generateMarkerDataURL(0, 260)}
                alt="Addis AR Test Fiducial Marker"
                className="w-48 h-48"
              />
            </div>
            <div className="dialog-actions">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const svgData = MarkerDetector.generateMarkerSVG(0, 400);
                  const blob = new Blob([svgData], { type: 'image/svg+xml' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'addis-ar-marker-0.svg';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download size={14} className="mr-1.5" />
                Download Printable SVG
              </Button>
              <Button size="sm" onClick={() => setShowMarkerDialog(false)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Technical Capabilities & Tracking Info Modal */}
      {showInfoDialog && (
        <div className="dialog-scrim" onClick={() => setShowInfoDialog(false)}>
          <div className="dialog-box max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-lg font-bold">Addis AR Tracking Capabilities</h2>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setShowInfoDialog(false)}
              >
                <X size={15} />
              </Button>
            </div>
            <div className="space-y-3 text-xs text-muted-foreground leading-relaxed max-h-96 overflow-y-auto pr-1">
              <div>
                <h4 className="font-semibold text-foreground text-xs mb-1 flex items-center gap-1.5">
                  <Crosshair size={13} className="text-primary" />
                  Focus & Place Target Tracking
                </h4>
                <p>
                  Extracts contrast gradients and corner features inside the reticle. When locked,
                  tracks the target's relative pose and distance in real time. Requires distinct visual
                  texture (books, paintings, printed logos).
                </p>
              </div>
              <div>
                <h4 className="font-semibold text-foreground text-xs mb-1 flex items-center gap-1.5">
                  <QrCode size={13} className="text-primary" />
                  Visual Fiducial Marker Tracking
                </h4>
                <p>
                  Detects high-contrast ArUco-style square markers and computes 6DOF camera pose
                  (position, pitch, roll, yaw) relative to the marker plane.
                </p>
              </div>
              <div>
                <h4 className="font-semibold text-foreground text-xs mb-1 flex items-center gap-1.5">
                  <Layers size={13} className="text-primary" />
                  WebXR Plane Hit Testing
                </h4>
                <p>
                  Available on WebXR-compatible mobile browsers (e.g. Chrome ARCore on Android). Places
                  objects directly onto real-world horizontal and vertical planes.
                </p>
              </div>
              <div>
                <h4 className="font-semibold text-foreground text-xs mb-1 flex items-center gap-1.5">
                  <Move size={13} className="text-primary" />
                  Device Orientation & Gyroscope
                </h4>
                <p>
                  Uses hardware gyroscopes on phones and tablets to estimate physical device tilt and
                  heading for fluid perspective viewing.
                </p>
              </div>
            </div>
            <div className="dialog-actions mt-4">
              <Button size="sm" onClick={() => setShowInfoDialog(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
