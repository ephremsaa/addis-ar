import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://pjqaitndlbifszcmbskj.supabase.co';

const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqcWFpdG5kbGJpZnN6Y21ic2tqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4NjcxODYsImV4cCI6MjEwNzQ0MzE4Nn0.gjBxMXVDDfyNi-1_7BdA6oDFuUy06dMf39sMBIORbwA';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export interface UploadGlbResult {
  success: boolean;
  publicUrl?: string;
  error?: string;
}

/**
 * Uploads a reconstructed .glb 3D model to the public 'models' Supabase Storage bucket.
 */
export async function uploadGlbToSupabase(
  glbBlob: Blob,
  modelName = 'scanned_product'
): Promise<UploadGlbResult> {
  try {
    const timestamp = Date.now();
    const cleanName = modelName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${cleanName}_${timestamp}.glb`;
    const filePath = `scans/${filename}`;

    const { error: uploadError } = await supabase.storage
      .from('models')
      .upload(filePath, glbBlob, {
        contentType: 'model/gltf-binary',
        upsert: true,
      });

    if (uploadError) {
      console.warn('Supabase storage upload error:', uploadError);
      return { success: false, error: uploadError.message };
    }

    const { data } = supabase.storage.from('models').getPublicUrl(filePath);

    return {
      success: true,
      publicUrl: data.publicUrl,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Upload failed';
    return { success: false, error: msg };
  }
}
