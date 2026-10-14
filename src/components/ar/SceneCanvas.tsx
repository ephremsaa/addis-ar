import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
  TransformControls,
  Environment,
  Lightformer,
  Grid,
} from "@react-three/drei";
import { createElement, useMemo, useRef, useState, useEffect } from "react";
import * as THREE from "three";
import { toast } from "sonner";
import { buildObject } from "@/lib/ar/scene";
import type { SceneObject } from "@/lib/ar/projects";
function Item({
  object,
  selected,
  mode,
  onSelect,
  onChange,
}: {
  object: SceneObject;
  selected: boolean;
  mode: "translate" | "rotate" | "scale";
  onSelect?: (() => void) | undefined;
  onChange?: ((o: SceneObject) => void) | undefined;
}) {
  const [model, setModel] = useState<THREE.Object3D>();
  const ref = useRef<THREE.Group>(null);
  useEffect(() => {
    const source = {
      ...object,
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    };
    let alive = true;
    let built: THREE.Object3D | undefined;
    buildObject(source)
      .then((m) => {
        built = m;
        if (alive) setModel(m);
      })
      .catch(() =>
        toast.error(
          "This model could not be loaded. Import a valid GLB or restore a project backup.",
        ),
      );
    return () => {
      alive = false;
      built?.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          for (const mat of Array.isArray(o.material) ? o.material : [o.material]) mat.dispose();
        }
      });
    };
  }, [object]);
  useEffect(() => {
    const group = ref.current;
    if (!group || !model) return;
    group.add(model);
    return () => {
      group.remove(model);
    };
  }, [model, selected, object.locked]);
  // Preview JSX annotations are DOM attributes, not Three.js properties.
  // Construct the scene without JSX so metadata cannot reach R3F's reconciler,
  // including through Drei components that forward their props.
  const content = createElement("group", {
      ref,
      position: object.position,
      rotation: object.rotation,
      scale: object.scale,
      visible: object.visible,
      onClick: (e: { stopPropagation: () => void }) => {
        e.stopPropagation();
        onSelect?.();
      },
  });
  if (selected && !object.locked && onChange)
    return createElement(TransformControls, {
        mode,
        onMouseUp: () => {
          const g = ref.current;
          if (g)
            onChange({
              ...object,
              position: g.position.toArray(),
              rotation: [g.rotation.x, g.rotation.y, g.rotation.z],
              scale: g.scale.toArray(),
            });
        },
      }, content);
  return content;
}
export function SceneCanvas({
  objects,
  selected,
  mode = "translate",
  onSelect,
  onChange,
  thumbnail = false,
}: {
  objects: SceneObject[];
  selected?: string;
  mode?: "translate" | "rotate" | "scale";
  onSelect?: (id: string) => void;
  onChange?: (o: SceneObject) => void;
  thumbnail?: boolean;
}) {
  const colors = useMemo(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      background: s.getPropertyValue("--scene-bg").trim(),
      grid: s.getPropertyValue("--scene-grid").trim(),
      light: s.getPropertyValue("--scene-light").trim(),
      fill: s.getPropertyValue("--scene-fill").trim(),
    };
  }, []);
  return createElement(Canvas, {
    dpr: 1,
    camera: { position: thumbnail ? [4, 3, 5] : [7, 6, 11], fov: thumbnail ? 38 : 60 },
    gl: { preserveDrawingBuffer: true },
  },
    createElement("color", { attach: "background", args: [colors.background] }),
    createElement("ambientLight", { intensity: 0.8 }),
    createElement("directionalLight", { position: [4, 7, 5], intensity: 2.5 }),
    createElement(Environment, { resolution: 64 },
      createElement(Lightformer, { position: [0, 5, 0], scale: [10, 10, 1], intensity: 2 }),
      createElement(Lightformer, {
        color: colors.fill, position: [-5, 2, 0], rotation: [0, Math.PI / 2, 0],
        scale: [10, 5, 1], intensity: 2,
      }),
    ),
    !thumbnail && createElement(Grid, {
      args: [30, 30], position: [0, -0.01, 0], cellSize: 1, cellThickness: 0.6,
      sectionSize: 5, sectionThickness: 1, cellColor: colors.grid,
      sectionColor: colors.grid, fadeDistance: 35, infiniteGrid: true,
    }),
    ...objects.map((o) => createElement(Item, {
      key: o.id, object: o, selected: selected === o.id, mode,
      onSelect: onSelect ? () => onSelect(o.id) : undefined, onChange,
    })),
    createElement(OrbitControls, {
      makeDefault: true, target: [0, 1, 0], enablePan: !thumbnail,
      autoRotate: thumbnail, autoRotateSpeed: 0.5,
    }),
  );
}
