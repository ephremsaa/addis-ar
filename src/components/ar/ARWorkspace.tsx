import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Camera,
  Video,
  VideoOff,
  Crosshair,
  Lock,
  Unlock,
  RefreshCw,
  Move,
  RotateCw,
  Scaling,
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
  Settings,
  ChevronRight,
  Maximize2,
  Trash2,
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

type DrawerType = 'adjust' | 'objects' | 'tracking' | 'settings' | null;

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

  // Active drawer menu
  const [activeDrawer, setActiveDrawer] = useState<DrawerType>(null);
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
      setFeedbackMessage('Camera connected. Point at your target or surface.');
    } catch (e) {
      setFeedbackMessage(e instanceof Error ? e.message : 'Camera failed to start.');
    }
  };

  const handleStopCamera = () => {
    sessionManager.stopCamera();
    setFeedbackMessage('Camera stopped.');
  };

  const handleSwitchFacing = async () => {
    try {
      sessionManager.camera.switchFacing();
      setFeedbackMessage('Switched camera.');
    } catch {
      setFeedbackMessage('Could not switch camera.');
    }
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
    <div className="ar-workspace select-none">
      {/* 1. Full Screen Camera Viewport (Background Video + 3D Canvas) */}
      <main className="ar-viewport" ref={viewportRef}>
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="ar-video-feed"
        />

        {/* Central Aiming Reticle (when not locked) */}
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
                Camera access requires HTTPS or localhost. Serve through an HTTPS tunnel or localhost.
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
                Please enable camera permissions in site settings to run Addis AR.
              </p>
              <Button size="sm" onClick={handleStartCamera} className="mt-3 text-xs">
                Retry Camera Permission
              </Button>
            </div>
          </div>
        )}

        {/* Idle Hero (Before Camera Starts) */}
        {sessionState.cameraStatus === 'idle' && (
          <div className="ar-idle-hero">
            <div className="rounded-full bg-primary/20 p-4 border border-primary/40">
              <Camera size={38} className="text-primary" />
            </div>
            <h2 className="text-lg lg:text-xl font-bold mt-3 text-white">Full-Screen AR Camera</h2>
            <p className="text-xs text-muted-foreground max-w-sm mt-1 leading-relaxed">
              Anchor your 3D creations onto real surfaces, posters, or markers with live spatial tracking.
            </p>
            <Button onClick={handleStartCamera} className="mt-4 gap-2 px-6 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
              <Video size={16} />
              Start AR Camera
            </Button>
          </div>
        )}

        {/* Live Floating Status Message */}
        {feedbackMessage && (
          <div className="ar-toast-banner">
            <Info size={13} className="text-primary" />
            <span className="text-white">{feedbackMessage}</span>
            <button
              onClick={() => setFeedbackMessage('')}
              className="ml-2 text-muted-foreground hover:text-white"
            >
              ×
            </button>
          </div>
        )}
      </main>

      {/* 2. Floating Translucent Top Bar */}
      <header className="ar-floating-topbar">
        <div className="flex items-center gap-2.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={onReturnToEditor}
            className="h-8 px-2.5 gap-1.5 text-white/90 hover:text-white hover:bg-white/10"
            title="Exit AR mode"
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline text-xs font-semibold">Exit AR</span>
          </Button>

          <div className="h-4 w-px bg-white/20 hidden sm:block" />

          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Addis AR logo" className="w-5 h-5 object-contain rounded" />
            <span className="text-xs font-bold text-white truncate max-w-[130px] sm:max-w-xs">
              {currentProject.name}
            </span>
          </div>
        </div>

        {/* Center Tracking Status Badge */}
        <div className="flex items-center gap-2">
          <div
            className={`ar-tracking-badge state-${trackingReport.state}`}
            title={`Tracking Confidence: ${Math.round(trackingReport.confidence * 100)}%`}
          >
            <span className="ar-dot" />
            <span className="text-[10px] font-bold tracking-wider uppercase font-mono">
              {sessionState.lockedTarget
                ? 'LOCKED'
                : trackingReport.state === 'reliable'
                ? 'TRACKING'
                : trackingReport.state === 'uncertain'
                ? 'ACQUIRING'
                : 'SEARCHING'}
            </span>
            <span className="text-[9px] opacity-75 font-mono">
              {Math.round(trackingReport.confidence * 100)}%
            </span>
          </div>

          {/* Quick Header Actions */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSwitchFacing}
            title="Switch front/rear camera"
            className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/10 rounded-full"
          >
            <RefreshCw size={15} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={handleScreenshot}
            title="Take AR Screenshot"
            className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/10 rounded-full"
          >
            <Download size={15} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowInfoDialog(true)}
            title="AR Tracking Guide"
            className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/10 rounded-full hidden sm:inline-flex"
          >
            <HelpCircle size={15} />
          </Button>
        </div>
      </header>

      {/* 3. Slide-Up Glass Drawer / Bottom Sheet (When Active) */}
      {activeDrawer && (
        <>
          <div
            className="ar-drawer-backdrop"
            onClick={() => setActiveDrawer(null)}
          />

          <div className="ar-bottom-drawer">
            <div
              className="ar-drawer-handle"
              onClick={() => setActiveDrawer(null)}
            />

            {/* Drawer Header */}
            <div className="ar-drawer-header">
              <div className="flex items-center gap-2">
                {activeDrawer === 'adjust' && <Sliders className="w-4 h-4 text-primary" />}
                {activeDrawer === 'objects' && <Layers className="w-4 h-4 text-primary" />}
                {activeDrawer === 'tracking' && <Crosshair className="w-4 h-4 text-primary" />}
                {activeDrawer === 'settings' && <Settings className="w-4 h-4 text-primary" />}
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  {activeDrawer === 'adjust' && 'Adjust & Transforms'}
                  {activeDrawer === 'objects' && 'Scene Objects'}
                  {activeDrawer === 'tracking' && 'Tracking Modes & Target'}
                  {activeDrawer === 'settings' && 'Camera & Settings'}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setActiveDrawer(null)}
                className="h-7 w-7 text-white/70 hover:text-white hover:bg-white/10 rounded-full"
              >
                <X size={15} />
              </Button>
            </div>

            {/* Drawer Body */}
            <div className="ar-drawer-content space-y-4">
              {/* TAB: ADJUST / TRANSFORMS */}
              {activeDrawer === 'adjust' && (
                <>
                  {selectedObject ? (
                    <div className="space-y-3.5">
                      {/* Active Object Banner */}
                      <div className="flex items-center justify-between p-2 rounded-xl bg-purple-950/40 border border-purple-500/30">
                        <div className="flex items-center gap-2">
                          <Box className="w-4 h-4 text-purple-400" />
                          <span className="text-xs font-bold text-white truncate max-w-[180px]">
                            {selectedObject.name}
                          </span>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-purple-800/50 text-purple-200 capitalize">
                          {selectedObject.kind}
                        </span>
                      </div>

                      {/* Quick Placement Actions */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleSnapToTarget}
                          className="text-[11px] h-8 justify-start gap-1.5"
                          title="Snap object to target origin"
                        >
                          <Crosshair size={12} className="text-primary" />
                          Snap Target
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleAlignToSurface}
                          className="text-[11px] h-8 justify-start gap-1.5"
                          title="Align bottom to ground plane"
                        >
                          <Layers size={12} className="text-primary" />
                          Align Surface
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handlePlaceInFront}
                          className="text-[11px] h-8 justify-start gap-1.5"
                          title="Place 1.5m in front of camera"
                        >
                          <Box size={12} className="text-primary" />
                          In Front View
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleResetPlacement}
                          className="text-[11px] h-8 justify-start gap-1.5"
                          title="Reset position, rotation and scale"
                        >
                          <RefreshCw size={12} className="text-primary" />
                          Reset
                        </Button>
                      </div>

                      {/* Transform: Position */}
                      <div className="space-y-1.5 bg-white/5 p-3 rounded-xl border border-white/10">
                        <div className="flex justify-between items-center text-[11px] text-muted-foreground">
                          <span className="font-semibold uppercase tracking-wider text-white/80 flex items-center gap-1.5">
                            <Move size={12} /> Position (Meters)
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {(['x', 'y', 'z'] as const).map((axis, i) => (
                            <div key={axis} className="space-y-1">
                              <span className="text-[10px] uppercase font-bold text-muted-foreground block text-center">
                                {axis}
                              </span>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 text-white/70 hover:text-white"
                                  onClick={() =>
                                    updateSelectedObject((obj) => {
                                      const pos = [...obj.position] as [number, number, number];
                                      pos[i] = Number((pos[i] - 0.1).toFixed(2));
                                      return { ...obj, position: pos };
                                    })
                                  }
                                >
                                  -
                                </Button>
                                <input
                                  type="number"
                                  step="0.05"
                                  value={Number(selectedObject.position[i].toFixed(2))}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value) || 0;
                                    updateSelectedObject((obj) => {
                                      const pos = [...obj.position] as [number, number, number];
                                      pos[i] = val;
                                      return { ...obj, position: pos };
                                    });
                                  }}
                                  className="w-full text-center bg-black/50 border border-white/15 rounded px-1 py-0.5 text-xs font-mono text-white"
                                />
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 text-white/70 hover:text-white"
                                  onClick={() =>
                                    updateSelectedObject((obj) => {
                                      const pos = [...obj.position] as [number, number, number];
                                      pos[i] = Number((pos[i] + 0.1).toFixed(2));
                                      return { ...obj, position: pos };
                                    })
                                  }
                                >
                                  +
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Transform: Rotation */}
                      <div className="space-y-1.5 bg-white/5 p-3 rounded-xl border border-white/10">
                        <div className="flex justify-between items-center text-[11px] text-muted-foreground">
                          <span className="font-semibold uppercase tracking-wider text-white/80 flex items-center gap-1.5">
                            <RotateCw size={12} /> Rotation (Degrees)
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {(['x', 'y', 'z'] as const).map((axis, i) => (
                            <div key={axis} className="space-y-1">
                              <span className="text-[10px] uppercase font-bold text-muted-foreground block text-center">
                                {axis}
                              </span>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 text-white/70 hover:text-white"
                                  onClick={() =>
                                    updateSelectedObject((obj) => {
                                      const rot = [...obj.rotation] as [number, number, number];
                                      rot[i] = (rot[i] - 15 + 360) % 360;
                                      return { ...obj, rotation: rot };
                                    })
                                  }
                                >
                                  -
                                </Button>
                                <input
                                  type="number"
                                  value={Math.round(selectedObject.rotation[i])}
                                  onChange={(e) => {
                                    const val = parseInt(e.target.value) || 0;
                                    updateSelectedObject((obj) => {
                                      const rot = [...obj.rotation] as [number, number, number];
                                      rot[i] = val;
                                      return { ...obj, rotation: rot };
                                    });
                                  }}
                                  className="w-full text-center bg-black/50 border border-white/15 rounded px-1 py-0.5 text-xs font-mono text-white"
                                />
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 text-white/70 hover:text-white"
                                  onClick={() =>
                                    updateSelectedObject((obj) => {
                                      const rot = [...obj.rotation] as [number, number, number];
                                      rot[i] = (rot[i] + 15) % 360;
                                      return { ...obj, rotation: rot };
                                    })
                                  }
                                >
                                  +
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Transform: Scale */}
                      <div className="space-y-1.5 bg-white/5 p-3 rounded-xl border border-white/10">
                        <div className="flex justify-between items-center text-[11px] text-muted-foreground">
                          <span className="font-semibold uppercase tracking-wider text-white/80 flex items-center gap-1.5">
                            <Scaling size={12} /> Scale Multiplier
                          </span>
                          <button
                            onClick={() => setUniformScale(!uniformScale)}
                            className={`text-[10px] px-2 py-0.5 rounded font-semibold transition ${
                              uniformScale ? 'bg-primary text-primary-foreground' : 'bg-white/10 text-white'
                            }`}
                          >
                            {uniformScale ? 'Uniform Locked' : 'Independent'}
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {(['x', 'y', 'z'] as const).map((axis, i) => (
                            <div key={axis} className="space-y-1">
                              <span className="text-[10px] uppercase font-bold text-muted-foreground block text-center">
                                {axis}
                              </span>
                              <input
                                type="number"
                                step="0.1"
                                min="0.05"
                                value={Number(selectedObject.scale[i].toFixed(2))}
                                onChange={(e) => {
                                  const val = Math.max(0.05, parseFloat(e.target.value) || 0.1);
                                  updateSelectedObject((obj) => {
                                    if (uniformScale) {
                                      return { ...obj, scale: [val, val, val] };
                                    }
                                    const scl = [...obj.scale] as [number, number, number];
                                    scl[i] = val;
                                    return { ...obj, scale: scl };
                                  });
                                }}
                                className="w-full text-center bg-black/50 border border-white/15 rounded px-1 py-1 text-xs font-mono text-white"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-6 text-xs text-muted-foreground">
                      No object selected. Select an object from the Objects tab to adjust.
                    </div>
                  )}
                </>
              )}

              {/* TAB: SCENE OBJECTS */}
              {activeDrawer === 'objects' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span>Scene Objects ({currentProject.objects.length})</span>
                    <span>Tap to inspect & move</span>
                  </div>

                  <div className="space-y-1.5">
                    {currentProject.objects.map((obj) => (
                      <div
                        key={obj.id}
                        onClick={() => setSelectedId(obj.id)}
                        className={`flex items-center justify-between p-2.5 rounded-xl border transition cursor-pointer ${
                          selectedId === obj.id
                            ? 'bg-purple-950/60 border-purple-500/60 text-white shadow-lg'
                            : 'bg-white/5 border-white/10 text-white/80 hover:bg-white/10'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <Box
                            size={16}
                            className={selectedId === obj.id ? 'text-primary' : 'text-muted-foreground'}
                          />
                          <div>
                            <div className="text-xs font-bold text-white">{obj.name}</div>
                            <span className="text-[10px] text-muted-foreground capitalize">
                              {obj.kind}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-white/70 hover:text-white"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCurrentProject((prev) => ({
                                ...prev,
                                objects: prev.objects.map((o) =>
                                  o.id === obj.id ? { ...o, visible: !o.visible } : o
                                ),
                              }));
                            }}
                          >
                            {obj.visible ? <Eye size={14} /> : <EyeOff size={14} className="text-white/40" />}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB: TRACKING MODES & TARGETS */}
              {activeDrawer === 'tracking' && (
                <div className="space-y-3.5">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase block">
                      Active AR Tracking Mode
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        variant={trackingReport.mode === 'focus-target' ? 'secondary' : 'outline'}
                        onClick={() => handleModeChange('focus-target')}
                        className={`text-xs justify-start h-9 ${trackingReport.mode === 'focus-target' ? 'border-primary' : ''}`}
                      >
                        <Crosshair size={14} className="mr-2 text-primary" />
                        Focus Target
                      </Button>
                      <Button
                        size="sm"
                        variant={trackingReport.mode === 'marker' ? 'secondary' : 'outline'}
                        onClick={() => handleModeChange('marker')}
                        className={`text-xs justify-start h-9 ${trackingReport.mode === 'marker' ? 'border-primary' : ''}`}
                      >
                        <QrCode size={14} className="mr-2 text-primary" />
                        Marker AR
                      </Button>
                      <Button
                        size="sm"
                        variant={trackingReport.mode === 'device-orientation' ? 'secondary' : 'outline'}
                        onClick={() => handleModeChange('device-orientation')}
                        className={`text-xs justify-start h-9 ${trackingReport.mode === 'device-orientation' ? 'border-primary' : ''}`}
                      >
                        <Move size={14} className="mr-2 text-primary" />
                        Gyro Orientation
                      </Button>
                      <Button
                        size="sm"
                        variant={trackingReport.mode === 'webxr-plane' ? 'secondary' : 'outline'}
                        onClick={() => handleModeChange('webxr-plane')}
                        className={`text-xs justify-start h-9 ${trackingReport.mode === 'webxr-plane' ? 'border-primary' : ''}`}
                      >
                        <Layers size={14} className="mr-2 text-primary" />
                        WebXR Plane
                      </Button>
                    </div>
                  </div>

                  {/* Target Status Card */}
                  <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">Target Anchor Status</span>
                      {sessionState.lockedTarget ? (
                        <span className="flex items-center gap-1 text-xs text-emerald-400 font-bold">
                          <Lock size={12} />
                          Locked
                        </span>
                      ) : (
                        <span className="text-xs text-amber-400 font-bold">Uncalibrated</span>
                      )}
                    </div>

                    {sessionState.lockedTarget ? (
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>{sessionState.lockedTarget.label}</span>
                          <span className="font-mono">Score: {sessionState.lockedTarget.initialScore}/100</span>
                        </div>
                        {sessionState.lockedTarget.snapshotUrl && (
                          <div className="h-16 w-full rounded-lg overflow-hidden border border-white/15 bg-black/40">
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
                          className="w-full text-xs text-rose-400 border-rose-500/40 hover:bg-rose-950/40"
                        >
                          <Unlock size={13} className="mr-1.5" />
                          Unlock & Re-scan Target
                        </Button>
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Aim the reticle at a distinct textured surface, painting, or object and tap "Scan Target" on the bottom shutter to calibrate tracking.
                      </p>
                    )}
                  </div>

                  {trackingReport.mode === 'marker' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowMarkerDialog(true)}
                      className="w-full gap-2 text-xs"
                    >
                      <QrCode size={14} />
                      View & Print Test Marker
                    </Button>
                  )}
                </div>
              )}

              {/* TAB: SETTINGS & CALIBRATION */}
              {activeDrawer === 'settings' && (
                <div className="space-y-3.5">
                  {/* Camera Controls */}
                  <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-2.5">
                    <span className="text-xs font-semibold text-white block">Camera Controls</span>
                    <div className="flex items-center gap-2">
                      {sessionState.cameraStatus === 'running' ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={handleStopCamera}
                          className="flex-1 text-xs gap-1.5"
                        >
                          <VideoOff size={14} />
                          Stop Camera
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={handleStartCamera}
                          className="flex-1 text-xs gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground"
                        >
                          <Video size={14} />
                          Start Camera
                        </Button>
                      )}

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSwitchFacing}
                        className="text-xs gap-1.5"
                        title="Flip Front / Rear Camera"
                      >
                        <RefreshCw size={14} />
                        Flip Camera
                      </Button>
                    </div>

                    {sessionState.availableCameras.length > 1 && (
                      <div className="space-y-1 pt-1">
                        <label className="text-[11px] text-muted-foreground">Select Camera Device</label>
                        <select
                          aria-label="Select Camera Device"
                          value={sessionState.selectedCameraId}
                          onChange={(e) => sessionManager.camera.selectDevice(e.target.value)}
                          className="w-full bg-black/60 border border-white/20 rounded-lg px-2.5 py-1.5 text-xs text-white"
                        >
                          {sessionState.availableCameras.map((cam) => (
                            <option key={cam.deviceId} value={cam.deviceId}>
                              {cam.label || `Camera ${cam.deviceId.slice(0, 6)}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Tracking Stability Smoothing Slider */}
                  <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-white">Tracking Smoothing Filter</span>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        Adaptive
                      </span>
                    </div>
                    <input
                      aria-label="Tracking Smoothing Factor"
                      type="range"
                      min="0.1"
                      max="0.8"
                      step="0.05"
                      defaultValue="0.4"
                      className="w-full accent-primary"
                      onChange={(e) =>
                        sessionManager.tracking.setSmoothingFactor(Number(e.target.value))
                      }
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>Responsive (0.1)</span>
                      <span>Ultra-Smooth (0.8)</span>
                    </div>
                  </div>

                  {/* WebXR Plane Capability info */}
                  <div className="p-2.5 rounded-lg bg-white/5 border border-white/10 flex items-center justify-between text-xs text-muted-foreground">
                    <span>WebXR Native Immersive-AR:</span>
                    <span className={sessionState.isWebXRSupported ? 'text-emerald-400 font-bold' : 'text-amber-400 font-semibold'}>
                      {sessionState.isWebXRSupported ? '✓ Supported' : 'Not Supported (Using Optical AR)'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* 4. Floating Bottom Menu Bar */}
      <footer className="ar-floating-menu-bar">
        {/* Left Item: Objects */}
        <button
          onClick={() => setActiveDrawer(activeDrawer === 'objects' ? null : 'objects')}
          className={`ar-menu-item ${activeDrawer === 'objects' ? 'active' : ''}`}
          title="Scene Objects"
        >
          <div className="relative">
            <Layers size={18} />
            <span className="absolute -top-1 -right-1.5 bg-primary text-[8px] font-bold text-white px-1 rounded-full">
              {currentProject.objects.length}
            </span>
          </div>
          <span>Objects</span>
        </button>

        {/* Left Item: Adjust / Transforms */}
        <button
          onClick={() => setActiveDrawer(activeDrawer === 'adjust' ? null : 'adjust')}
          className={`ar-menu-item ${activeDrawer === 'adjust' ? 'active' : ''}`}
          title="Adjust Placement & Transforms"
        >
          <Sliders size={18} />
          <span>Adjust</span>
        </button>

        {/* Center Prominent Shutter Button */}
        {sessionState.cameraStatus === 'idle' ? (
          <button
            onClick={handleStartCamera}
            className="ar-shutter-btn"
            title="Start AR Camera"
          >
            <Camera size={24} />
          </button>
        ) : sessionState.targetCandidate && !sessionState.lockedTarget ? (
          <button
            onClick={handleConfirmTarget}
            className="ar-shutter-btn candidate"
            title="Lock Tracked Target"
          >
            <Lock size={22} />
          </button>
        ) : sessionState.lockedTarget ? (
          <button
            onClick={handleSnapToTarget}
            className="ar-shutter-btn locked"
            title="Snap to Locked Target"
          >
            <Crosshair size={22} />
          </button>
        ) : (
          <button
            onClick={handleScanTarget}
            className="ar-shutter-btn"
            title="Scan Target Under Reticle"
          >
            <Crosshair size={24} />
          </button>
        )}

        {/* Right Item: Tracking Mode */}
        <button
          onClick={() => setActiveDrawer(activeDrawer === 'tracking' ? null : 'tracking')}
          className={`ar-menu-item ${activeDrawer === 'tracking' ? 'active' : ''}`}
          title="Tracking Mode & Calibration"
        >
          <Crosshair size={18} />
          <span>Tracking</span>
        </button>

        {/* Right Item: Settings */}
        <button
          onClick={() => setActiveDrawer(activeDrawer === 'settings' ? null : 'settings')}
          className={`ar-menu-item ${activeDrawer === 'settings' ? 'active' : ''}`}
          title="Camera & App Settings"
        >
          <Settings size={18} />
          <span>Settings</span>
        </button>
      </footer>

      {/* 5. Modals (Marker Print & Help) */}
      {showMarkerDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <QrCode size={16} className="text-primary" />
                Optical Fiducial Marker
              </h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowMarkerDialog(false)}
                className="h-7 w-7 text-white/70 hover:text-white"
              >
                <X size={15} />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Addis AR uses high-contrast 3x3 square fiducial markers for high-precision 6-DoF pose estimation.
            </p>
            <div className="flex justify-center p-4 bg-white rounded-xl">
              <div
                dangerouslySetInnerHTML={{
                  __html: MarkerDetector.generateMarkerSVG(1, 160),
                }}
              />
            </div>
            <Button
              className="w-full text-xs font-semibold"
              onClick={() => {
                const svg = MarkerDetector.generateMarkerSVG(1, 400);
                const blob = new Blob([svg], { type: 'image/svg+xml' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'addis-ar-marker-1.svg';
                a.click();
              }}
            >
              <Download size={13} className="mr-1.5" />
              Download Printable Marker SVG
            </Button>
          </div>
        </div>
      )}

      {showInfoDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full space-y-3.5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <HelpCircle size={16} className="text-primary" />
                Addis AR Tracking Guide
              </h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowInfoDialog(false)}
                className="h-7 w-7 text-white/70 hover:text-white"
              >
                <X size={15} />
              </Button>
            </div>
            <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
              <p>
                <strong className="text-white">1. Full-Screen AR Viewport:</strong> The camera feed takes 100% of the screen. Tap "Adjust" on the bottom menu bar to open placement sliders while watching your 3D model in real time.
              </p>
              <p>
                <strong className="text-white">2. Focus Target:</strong> Center the reticle on any textured surface, painting, or object with contrast and tap the center shutter button to anchor.
              </p>
              <p>
                <strong className="text-white">3. Marker AR:</strong> Tracks high-precision fiducial markers for exact millimeter anchoring.
              </p>
              <p>
                <strong className="text-white">4. Gyro Orientation:</strong> Uses device motion sensors for lightweight viewing without visual targets.
              </p>
            </div>
            <Button
              className="w-full text-xs mt-2"
              onClick={() => setShowInfoDialog(false)}
            >
              Got it
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
