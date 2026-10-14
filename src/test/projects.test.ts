import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { newProject, newObject, saveProject, getProject, deleteProject, projectSchema, download, blobToDataUrl } from '@/lib/ar/projects';

describe('Local-first projects', () => {
  it('persists edited objects and restores transforms and color', async () => {
    const p = newProject('Acceptance project');
    const cube = newObject('cube');
    cube.position = [2, 3, 1];
    cube.color = '#58ced7';
    p.objects.push(cube);
    await saveProject(p);
    const restored = await getProject(p.id);
    expect(restored?.objects[0]?.position).toEqual([2, 3, 1]);
    expect(restored?.objects[0]?.color).toBe('#58ced7');
    await deleteProject(p.id);
    expect(await getProject(p.id)).toBeUndefined();
  });

  it('validates backups and rejects invalid transforms', () => {
    const p = newProject();
    p.objects.push(newObject('cube'));
    expect(projectSchema.parse(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(() => projectSchema.parse({ ...p, objects: [{ ...p.objects[0], position: [NaN, 0, 0] }] })).toThrow();
  });

  it('converts blobs to data URLs accurately with blobToDataUrl', async () => {
    const blob = new Blob(['sample-glb-binary-content'], { type: 'model/gltf-binary' });
    const dataUrl = await blobToDataUrl(blob);
    expect(dataUrl.startsWith('data:model/gltf-binary;base64,')).toBe(true);
  });

  it('appends and cleans up download anchor correctly in download()', () => {
    const blob = new Blob(['test'], { type: 'text/plain' });
    const appendChildSpy = vi.spyOn(document.body, 'appendChild');
    const removeChildSpy = vi.spyOn(document.body, 'removeChild');

    download(blob, 'test.txt');

    expect(appendChildSpy).toHaveBeenCalled();
    expect(removeChildSpy).toHaveBeenCalled();

    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
  });
});

