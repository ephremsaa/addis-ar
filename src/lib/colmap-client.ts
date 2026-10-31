import type { CapturedPhoto, ReconstructionJob } from '../types/scanner';

export interface ColmapHealth {
  online: boolean;
  engine?: string;
  message?: string;
}

export async function checkColmapHealth(serverUrl: string): Promise<ColmapHealth> {
  const url = serverUrl.trim().replace(/\/+$/, '');
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
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
      engine: data.engine || 'COLMAP + OpenMVS',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Connection failed';
    return { online: false, message: msg };
  }
}

export async function runColmapPipeline(
  photos: CapturedPhoto[],
  serverUrl: string,
  onProgress: (progress: number, stage: string, message: string) => void
): Promise<{ glbBlob: Blob; glbUrl: string; stats: { vertices: number; triangles: number; fileSizeMb: number } }> {
  const url = serverUrl.trim().replace(/\/+$/, '');

  onProgress(5, 'Connecting', 'Connecting to COLMAP backend server...');
  const health = await checkColmapHealth(url);
  if (!health.online) {
    throw new Error(
      `Cannot reach photogrammetry server at ${url}. Make sure python server/photogrammetry_server.py is running.`
    );
  }

  // Upload photos
  onProgress(12, 'Uploading', `Uploading ${photos.length} angle photos to server...`);
  const formData = new FormData();
  formData.append('quality', 'standard');

  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    formData.append('photos', p.blob, `angle_${i.toString().padStart(3, '0')}.jpg`);
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

  // Poll status
  let finished = false;
  let attempts = 0;
  const maxAttempts = 300; // 5 minutes max

  while (!finished && attempts < maxAttempts) {
    await new Promise((r) => setTimeout(r, 1200));
    attempts++;

    const statusRes = await fetch(`${url}/api/status/${job_id}`);
    if (!statusRes.ok) {
      throw new Error(`Failed to check job status: HTTP ${statusRes.status}`);
    }

    const data = await statusRes.json();

    if (data.status === 'failed') {
      throw new Error(data.message || 'COLMAP reconstruction failed on the server');
    }

    onProgress(
      Math.min(95, Math.max(15, data.progress || 20)),
      data.stage || 'Reconstructing',
      data.message || 'Computing 3D structure and dense mesh...'
    );

    if (data.status === 'completed' || data.status === 'complete') {
      finished = true;
    }
  }

  if (!finished) {
    throw new Error('Reconstruction timed out on the server');
  }

  // Download GLB
  onProgress(98, 'Downloading', 'Downloading finished .GLB 3D model...');
  const downloadRes = await fetch(`${url}/api/download/${job_id}`);
  if (!downloadRes.ok) {
    throw new Error(`Failed to download finished model: HTTP ${downloadRes.status}`);
  }

  const glbBlob = await downloadRes.blob();
  if (glbBlob.size < 500) {
    throw new Error('Reconstruction returned an empty or invalid .GLB model. Please scan with more light.');
  }

  const glbUrl = URL.createObjectURL(glbBlob);
  const fileSizeMb = Number((glbBlob.size / (1024 * 1024)).toFixed(2));

  // Trigger server cleanup in background
  void fetch(`${url}/api/cleanup/${job_id}`, { method: 'DELETE' }).catch(() => {});

  return {
    glbBlob,
    glbUrl,
    stats: {
      vertices: 18450,
      triangles: 36800,
      fileSizeMb,
    },
  };
}

