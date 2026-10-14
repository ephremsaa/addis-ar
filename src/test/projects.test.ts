import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import {
  newProject,
  newObject,
  saveProject,
  getProject,
  deleteProject,
  projectSchema,
  portableProject,
  download,
} from "@/lib/ar/projects";
describe("Local-first projects", () => {
  it("converts temporary models before persistence", async () => {
    const p = newProject();
    const object = newObject("model");
    object.model = "blob:temporary-model";
    p.objects.push(object);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["glTF"], { type: "model/gltf-binary" }),
    } as Response);
    try {
      const portable = await portableProject(p);
      expect(portable.objects[0]?.model).toBe("data:model/gltf-binary;base64,Z2xURg==");
      await saveProject(portable);
      expect((await getProject(p.id))?.objects[0]?.model).toBe(portable.objects[0]?.model);
      await deleteProject(p.id);
    } finally {
      fetchMock.mockRestore();
    }
  });
  it("attaches download anchors and delays URL cleanup", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:download"), revokeObjectURL: vi.fn() });
    let attached = false;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      attached = document.body.contains(this);
    });
    try {
      await download(new Blob(["backup"]), "backup.addisar");
      expect(attached).toBe(true);
      expect(document.querySelector('a[download="backup.addisar"]')).toBeNull();
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:download");
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
  it("persists edited objects and restores transforms and color", async () => {
    const p = newProject("Acceptance project");
    const cube = newObject("cube");
    cube.position = [2, 3, 1];
    cube.color = "#58ced7";
    p.objects.push(cube);
    await saveProject(p);
    const restored = await getProject(p.id);
    expect(restored?.objects[0]?.position).toEqual([2, 3, 1]);
    expect(restored?.objects[0]?.color).toBe("#58ced7");
    await deleteProject(p.id);
    expect(await getProject(p.id)).toBeUndefined();
  });
  it("validates backups and rejects invalid transforms", () => {
    const p = newProject();
    p.objects.push(newObject("cube"));
    expect(projectSchema.parse(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(() =>
      projectSchema.parse({ ...p, objects: [{ ...p.objects[0], position: [NaN, 0, 0] }] }),
    ).toThrow();
  });
});
