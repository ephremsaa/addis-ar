import { toast } from "sonner";
import { openDB } from "idb";
import { z } from "zod";
export const kinds = [
  "cube",
  "sphere",
  "cylinder",
  "cone",
  "plane",
  "torus",
  "capsule",
  "model",
] as const;
const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const objectSchema = z.object({
  id: z.string(),
  name: z.string().max(120),
  kind: z.enum(kinds),
  position: vector,
  rotation: vector,
  scale: vector,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  roughness: z.number().min(0).max(1),
  metalness: z.number().min(0).max(1),
  visible: z.boolean(),
  locked: z.boolean(),
  model: z.string().optional(),
});
export const projectSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  name: z.string().min(1).max(120),
  updated: z.number(),
  created: z.number(),
  objects: z.array(objectSchema),
});
export type SceneObject = z.infer<typeof objectSchema>;
export type Project = z.infer<typeof projectSchema>;
export const palette = ["#9682ed", "#58ced7", "#eaaf71", "#f0f0f4", "#ec7998", "#84cba1"] as const;
export function newObject(kind: SceneObject["kind"], color: string = palette[0]): SceneObject {
  return {
    id: crypto.randomUUID(),
    name: kind.charAt(0).toUpperCase() + kind.slice(1),
    kind,
    position: [0, 1, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color,
    roughness: 0.3,
    metalness: 0.2,
    visible: true,
    locked: false,
  };
}
export function newProject(name = "Untitled experience", template?: string): Project {
  const now = Date.now();
  const p: Project = {
    version: 1,
    id: crypto.randomUUID(),
    name,
    created: now,
    updated: now,
    objects: [],
  };
  if (template) {
    const a = newObject(
      template === "Sculpture studio"
        ? "torus"
        : template === "Geometric playground"
          ? "cube"
          : "sphere",
    );
    a.position = [0, 1.5, 0];
    a.scale = [1.5, 1.5, 1.5];
    a.rotation = [0.4, 0.4, 0];
    p.objects.push(a);
    if (template === "Geometric playground") {
      const b = newObject("sphere", palette[1]);
      b.position = [1.7, 0.6, 0];
      p.objects.push(b);
    }
  }
  return p;
}
const db = () =>
  openDB("addis-ar", 1, {
    upgrade(d) {
      d.createObjectStore("projects", { keyPath: "id" });
    },
  });
export async function listProjects(): Promise<Project[]> {
  return (await db()).getAll("projects");
}
export async function getProject(id: string): Promise<Project | undefined> {
  return (await db()).get("projects", id);
}
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to prepare the model for local storage."));
    reader.readAsDataURL(blob);
  });
}
export async function portableProject(p: Project): Promise<Project> {
  return {
    ...p,
    objects: await Promise.all(
      p.objects.map(async (o) => {
        if (!o.model?.startsWith("blob:")) return o;
        const response = await fetch(o.model);
        if (!response.ok)
          throw new Error(
            "The temporary model is no longer available. Import it again before saving.",
          );
        return { ...o, model: await blobToDataUrl(await response.blob()) };
      }),
    ),
  };
}
export async function saveProject(p: Project) {
  await (await db()).put("projects", projectSchema.parse(await portableProject(p)));
}
export async function deleteProject(id: string) {
  await (await db()).delete("projects", id);
}
export async function download(data: Blob, name: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  const file = new File([data], name, { type: data.type });
  const canShare =
    typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  try {
    a.click();
    if (canShare) {
      toast("Download requested", {
        description: "If the file did not download, save it through your device’s share menu.",
        action: {
          label: "Share file",
          onClick: () => {
            void navigator.share({ files: [file] }).catch((e) => {
              if (!(e instanceof DOMException && e.name === "AbortError"))
                toast.error("Unable to share this file. Try opening Addis AR in your browser.");
            });
          },
        },
      });
    }
  } catch (error) {
    if (canShare) {
      try {
        await navigator.share({ files: [file] });
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          toast.error("Download and sharing failed. Try a full browser.");
          throw e;
        }
      }
    } else {
      toast.error("Download failed. Try opening Addis AR in a full browser.");
      throw error;
    }
  } finally {
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export async function exportProject(p: Project) {
  await download(
    new Blob([JSON.stringify(await portableProject(p))], { type: "application/json" }),
    p.name + ".addisar",
  );
}
export async function importProject(file: File) {
  const p = projectSchema.parse(JSON.parse(await file.text()));
  return { ...p, id: crypto.randomUUID(), updated: Date.now() };
}
