import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { download, type Project, type SceneObject } from "./projects";
export function geometry(kind: SceneObject["kind"]): THREE.BufferGeometry {
  switch (kind) {
    case "sphere":
      return new THREE.SphereGeometry(0.7, 32, 24);
    case "cylinder":
      return new THREE.CylinderGeometry(0.6, 0.6, 1.3, 32);
    case "cone":
      return new THREE.ConeGeometry(0.7, 1.5, 32);
    case "plane":
      return new THREE.PlaneGeometry(2, 2);
    case "torus":
      return new THREE.TorusGeometry(0.8, 0.25, 24, 64);
    case "capsule":
      return new THREE.CapsuleGeometry(0.5, 0.7, 8, 24);
    default:
      return new THREE.BoxGeometry(1.2, 1.2, 1.2);
  }
}
export async function buildObject(o: SceneObject): Promise<THREE.Object3D> {
  let obj: THREE.Object3D;
  if (o.kind === "model" && o.model) {
    obj = clone((await new GLTFLoader().loadAsync(o.model)).scene);
  } else {
    obj = new THREE.Mesh(
      geometry(o.kind),
      new THREE.MeshStandardMaterial({
        color: o.color,
        roughness: o.roughness,
        metalness: o.metalness,
        side: THREE.DoubleSide,
      }),
    );
  }
  obj.name = o.name;
  obj.position.fromArray(o.position);
  obj.rotation.set(...o.rotation);
  obj.scale.fromArray(o.scale);
  obj.visible = o.visible;
  return obj;
}
export async function exportGLB(p: Project) {
  const scene = new THREE.Scene();
  try {
    for (const o of p.objects) scene.add(await buildObject(o));
    scene.updateMatrixWorld(true);
    const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
    if (!(glb instanceof ArrayBuffer)) throw Error("GLB export failed");
    download(new Blob([glb], { type: "model/gltf-binary" }), p.name + ".glb");
  } finally {
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
    });
  }
}
export async function readModel(file: File) {
  if (!/\.(glb|gltf)$/i.test(file.name)) throw Error("Choose a GLB or self-contained glTF file.");
  const data = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(Error("Unable to read model"));
    r.readAsDataURL(file);
  });
  const loaded = await new GLTFLoader().loadAsync(data);
  const bounds = new THREE.Box3().setFromObject(loaded.scene);
  const size = bounds.getSize(new THREE.Vector3());
  let meshes = 0;
  loaded.scene.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes++;
  });
  return { data, meshes, size: size.toArray(), bytes: file.size };
}
