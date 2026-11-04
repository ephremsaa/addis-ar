import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, RotateCw, Video, AlertCircle } from 'lucide-react';

export interface ARWorkspaceProps {
  onCaptureFrame?: (canvas: HTMLCanvasElement) => void;
  children?: React.ReactNode;
}

/**
 * ARWorkspace component providing robust multi-device camera controls.
 * Implements toggleFacingMode (replacing deprecated switchFacing)
 * and switchCamera(deviceId) (replacing deprecated selectDevice).
 */
export const ARWorkspace: React.FC<ARWorkspaceProps> = ({ onCaptureFrame, children }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Enumerate all available camera videoinput devices
  const updateDeviceList = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      setAvailableDevices(videoInputs);
    } catch (err) {
      console.warn('Could not list media devices:', err);
    }
  }, []);

  // Initialize or re-initialize camera stream
  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      const constraints: MediaStreamConstraints = {
        audio: false,
        video: selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId } }
          : {
              facingMode: { ideal: facingMode },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
      };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(newStream);

      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
        await videoRef.current.play().catch(() => {});
      }

      await updateDeviceList();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to access camera';
      setCameraError(msg);
      console.error('ARWorkspace camera error:', err);
    }
  }, [facingMode, selectedDeviceId, stream, updateDeviceList]);

  useEffect(() => {
    startCamera();
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [facingMode, selectedDeviceId]);

  /**
   * Toggles between front and back camera (environment <-> user).
   * Fixed replacement for broken legacy switchFacing.
   */
  const toggleFacingMode = useCallback(() => {
    setSelectedDeviceId(null); // Clear specific device ID lock
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  }, []);

  /**
   * Switches to a specific camera device ID.
   * Fixed replacement for broken legacy selectDevice.
   */
  const switchCamera = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId);
  }, []);

  return (
    <div className="relative w-full h-full bg-black overflow-hidden font-sans">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 w-full h-full object-cover"
      />

      {cameraError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-black/85 z-50 text-center">
          <AlertCircle className="w-12 h-12 text-rose-400 mb-3" />
          <h3 className="text-base font-bold text-white mb-1">Camera Access Issue</h3>
          <p className="text-xs text-rose-300 max-w-xs mb-4">{cameraError}</p>
          <button
            onClick={() => startCamera()}
            className="px-4 py-2 rounded-xl bg-cyan-400 text-slate-950 font-bold text-xs"
          >
            Retry Camera
          </button>
        </div>
      )}

      {/* Floating Camera Device Switcher Pill */}
      {availableDevices.length > 1 && (
        <div className="absolute top-4 left-4 z-40 flex items-center gap-1.5 glass-panel px-3 py-1.5 rounded-full text-xs">
          <Video className="w-3.5 h-3.5 text-cyan-400" />
          <select
            value={selectedDeviceId || ''}
            onChange={(e) => switchCamera(e.target.value)}
            className="bg-transparent text-white text-xs outline-none cursor-pointer"
          >
            {availableDevices.map((d, idx) => (
              <option key={d.deviceId || idx} value={d.deviceId} className="bg-slate-900 text-white">
                {d.label || `Camera ${idx + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Floating Flip Camera Button */}
      <button
        onClick={toggleFacingMode}
        className="absolute top-4 right-4 z-40 glass-btn p-2.5 rounded-full text-white shadow-lg active:scale-95 transition-all"
        title="Toggle Facing Mode"
      >
        <RotateCw className="w-4 h-4 text-cyan-300" />
      </button>

      {/* Overlay Children Content */}
      <div className="relative z-30 w-full h-full pointer-events-none">{children}</div>
    </div>
  );
};

export default ARWorkspace;
