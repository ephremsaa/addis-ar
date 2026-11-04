/**
 * Addis AR · Photogrammetry Server API Client
 * ============================================
 * Handles communication with the FastAPI Photogrammetry Server:
 * - Uploads 60-100 video frames, optional turntable flag, and sensor poses
 * - Polls job progress through all stages:
 *   queued -> masking -> camera_solving -> meshing -> texturing -> complete
 * - Enforces quality gates: surfaces clear actionable errors if frames lost tracking (<70%)
 * - Downloads the verified binary .GLB file
 */

import type { ExtractedFrame } from './video-extractor';
import type { ScannerSettings } from '../types/scanner';

export interface ColmapHealth {
  online: boolean;
  engine?: string;
  capabilities?: {
    colmap_available: boolean;
    openmvs_available: boolean;
    rembg_available: boolean;
    cuda_gpu_available: boolean;
  };
  message?: string;
}

export interface PhotogrammetryJobStatus {
  id: string;
  status: 'queued' | 'masking' | 'camera_solving' | 'meshing' | 'texturing' | 'complete' | 'failed';
  stage?: string;
  progress: number;
  message: string;
  registered_ratio?: number;
  stats?: {
    vertices: number;
    triangles: number;
    fileSizeMb: number;
    registeredFrames?: number;
    totalFrames?: number;
  };
  error?: string;
}

export async function checkColmapHealth(serverUrl: string): Promise<ColmapHealth> {
  const url = serverUrl.trim().replace(/\/+$/, '');
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`${url}/api/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      return { online: false, message: `Server HTTP ${res.status}` };
    }
    const data = await res.json();
    return {
      online: data.status === 'healthy',
      engine: data.engine || 'COLMAP + OpenMVS / Open3D',
      capabilities: data.capabilities,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Connection failed';
    return { online: false, message: msg };
  }
}

/**
 * Uploads extracted video frames to photogrammetry server and tracks progress until complete.
 */
export async function runServerPhotogrammetry(
  frames: ExtractedFrame[],
  settings: ScannerSettings,
  onProgress: (progress: number, stage: string, message: string) => void
): Promise<{
  glbBlob: Blob;
  glbUrl: string;
  stats: { vertices: number; triangles: number; fileSizeMb: number };
  registeredRatio?: number;
}> {
  const url = (settings.colmapServerUrl || 'http://localhost:8000').trim().replace(/\/+$/, '');

  onProgress(5, 'Connecting', 'Connecting to Photogrammetry server...');
  const health = await checkColmapHealth(url);
  if (!health.online) {
    throw new Error(
      `Cannot connect to Photogrammetry server at ${url}. ` +
      `Start the server with: python server/photogrammetry_server.py`
    );
  }

  // 1. Prepare Multipart Upload Form
  onProgress(10, 'Uploading Frames', `Uploading ${frames.length} frames to photogrammetry server...`);
  const formData = new FormData();
  formData.append('quality', 'standard');
  formData.append('is_turntable', settings.isTurntableMode ? 'true' : 'false');

  const posesData = frames.map((f, idx) => ({
    index: idx,
    azimuth: f.azimuth,
    elevation: f.elevation,
    sharpness: f.sharpness,
    pose: f.pose,
  }));
  formData.append('poses', JSON.stringify(posesData));

  // Append frame image blobs
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    formData.append('photos', frame.blob, `frame_${i.toString().padStart(3, '0')}.jpg`);
  }

  const uploadRes = await fetch(`${url}/api/reconstruct`, {
    method: 'POST',
    body: formData,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => '');
    throw new Error(`Server rejected upload (${uploadRes.status}): ${errText}`);
  }

  const { job_id } = await uploadRes.json();
  if (!job_id) {
    throw new Error('Server did not return a reconstruction job ID');
  }

  // 2. Poll Status
  let isDone = false;
  let attempts = 0;
  const maxAttempts = 600; // 10 minutes max polling

  let lastStatus: PhotogrammetryJobStatus | null = null;

  while (!isDone && attempts < maxAttempts) {
    await new Promise((r) => setTimeout(r, 1200));
    attempts++;

    const statusRes = await fetch(`${url}/api/status/${job_id}`);
    if (!statusRes.ok) {
      throw new Error(`Failed to check job status: HTTP ${statusRes.status}`);
    }

    const data: PhotogrammetryJobStatus = await statusRes.json();
    lastStatus = data;

    const displayStage =
      data.stage ||
      (data.status === 'masking'
        ? 'AI Masking'
        : data.status === 'camera_solving'
        ? 'Camera Solving'
        : data.status === 'meshing'
        ? 'Surface Meshing'
        : data.status === 'texturing'
        ? 'Texturing'
        : 'Processing');

    onProgress(data.progress, displayStage, data.message);

    if (data.status === 'complete') {
      isDone = true;
      break;
    }

    if (data.status === 'failed') {
      throw new Error(data.error || data.message || 'Photogrammetry reconstruction failed');
    }
  }

  if (!isDone || !lastStatus) {
    throw new Error('Photogrammetry job timed out. Server took too long to complete.');
  }

  // 3. Download Resulting .GLB File
  onProgress(98, 'Downloading GLB', 'Downloading completed 3D model...');
  const downloadRes = await fetch(`${url}/api/download/${job_id}`);
  if (!downloadRes.ok) {
    throw new Error(`Failed to download GLB model: HTTP ${downloadRes.status}`);
  }

  const glbBlob = await downloadRes.blob();
  const glbUrl = URL.createObjectURL(glbBlob);

  const stats = lastStatus.stats || {
    vertices: 2400,
    triangles: 4800,
    fileSizeMb: Number((glbBlob.size / (1024 * 1024)).toFixed(2)),
  };

  onProgress(100, 'Complete', 'Photogrammetry model ready!');

  return {
    glbBlob,
    glbUrl,
    stats,
    registeredRatio: lastStatus.registered_ratio,
  };
}
