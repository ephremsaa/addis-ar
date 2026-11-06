/**
 * Addis AR · Persistent Local Model Storage (IndexedDB)
 * =====================================================
 * Saves reconstructed .glb 3D models directly as binary Blobs in IndexedDB,
 * ensuring models persist across browser page reloads without ephemeral blob: URL expiration.
 */

export interface StoredModel {
  id: string;
  name: string;
  timestamp: number;
  blob: Blob;
  stats: {
    vertices: number;
    triangles: number;
    fileSizeMb: number;
  };
  serverJobId?: string;
  thumbnailUrl?: string;
}

const DB_NAME = 'addis_ar_studio_db';
const DB_VERSION = 1;
const STORE_NAME = 'scanned_models';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported in this browser.'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Persists a .glb model blob and metadata to IndexedDB.
 */
export async function saveModelToIndexedDB(model: StoredModel): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(model);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Could not save model to IndexedDB:', err);
  }
}

/**
 * Retrieves the most recent model from IndexedDB.
 */
export async function getLastStoredModel(): Promise<StoredModel | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const list: StoredModel[] = req.result || [];
        if (list.length === 0) {
          resolve(null);
          return;
        }
        list.sort((a, b) => b.timestamp - a.timestamp);
        resolve(list[0]);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/**
 * Retrieves a specific model by ID.
 */
export async function getStoredModelById(id: string): Promise<StoredModel | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/**
 * Helper to download a GLB file reliably across all iOS/Android and desktop browsers.
 * Uses Web Share API as a fallback for mobile WebViews.
 */
export async function downloadGlbReliably(blob: Blob, filename = 'scanned_model.glb'): Promise<void> {
  // 1. Try Web Share API on mobile (supports native "Save to Files" / Drive / AirDrop)
  if (typeof navigator !== 'undefined' && navigator.canShare && navigator.share) {
    try {
      const file = new File([blob], filename, { type: 'model/gltf-binary' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: filename,
        });
        return;
      }
    } catch (e: unknown) {
      // User cancelled share or share failed; proceed to direct anchor download
      if (e instanceof Error && e.name === 'AbortError') return;
    }
  }

  // 2. Standard DOM anchor click with explicit document append/cleanup
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1500);
}

