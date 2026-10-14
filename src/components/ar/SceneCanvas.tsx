import { Canvas, useFrame } from "@react-three/fiber";
import {
  OrbitControls,
  TransformControls,
  Environment,
  Lightformer,
  Grid,
} from "@react-three/drei";
import { useMemo, useRef, useState, useEffect } from "react";
import * as THREE from "three";
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
    let alive = true;
    let built: THREE.Object3D | undefined;
    buildObject({ ...object, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] })
      .then((m) => {
        built = m;
        if (alive) setModel(m);
      })
      .catch(console.error);
    return () => {
      alive = false;
      built?.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          for (const mat of Array.isArray(o.material) ? o.material : [o.material]) mat.dispose();
        }
      });
    };
  }, [object.kind, object.model, object.color, object.roughness, object.metalness]);
  const content = (
    <group
      ref={ref}
      position={object.position}
      rotation={object.rotation}
      scale={object.scale}
      visible={object.visible}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.();
      }}
    >
      {model && <primitive object={model} />}
    </group>
  );
  if (selected && !object.locked && onChange)
    return (
      <TransformControls
        mode={mode}
        onMouseUp={() => {
          const g = ref.current;
          if (g)
            onChange({
              ...object,
              position: g.position.toArray(),
              rotation: [g.rotation.x, g.rotation.y, g.rotation.z],
              scale: g.scale.toArray(),
            });
        }}
      >
        {content}
      </TransformControls>
    );
  return content;
}
function Turntable() {
  const group = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += Math.min(delta, 0.05) * 0.3;
  });
  return <group ref={group} />;
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
  return (
    <Canvas
      dpr={1}
      camera={{ position: thumbnail ? [4, 3, 5] : [5, 4, 7], fov: thumbnail ? 38 : 45 }}
      onPointerMissed={() => onSelect?.("")}
      gl={{ preserveDrawingBuffer: true }}
    >
      <color attach="background" args={[colors.background]} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[4, 7, 5]} intensity={2.5} />
      <Environment resolution={64}>
        <Lightformer position={[0, 5, 0]} scale={[10, 10, 1]} intensity={2} />
        <Lightformer
          color={colors.fill}
          position={[-5, 2, 0]}
          rotation-y={Math.PI / 2}
          scale={[10, 5, 1]}
          intensity={2}
        />
      </Environment>
      {!thumbnail && (
        <Grid
          args={[30, 30]}
          position={[0, -0.01, 0]}
          cellSize={1}
          cellThickness={0.6}
          sectionSize={5}
          sectionThickness={1}
          cellColor={colors.grid}
          sectionColor={colors.grid}
          fadeDistance={35}
          infiniteGrid
        />
      )}
      {objects.map((o) => (
        <Item
          key={o.id}
          object={o}
          selected={selected === o.id}
          mode={mode}
          onSelect={onSelect ? () => onSelect(o.id) : undefined}
          onChange={onChange}
        />
      ))}
      <OrbitControls
        makeDefault
        target={[0, 1, 0]}
        enablePan={!thumbnail}
        autoRotate={thumbnail}
        autoRotateSpeed={0.5}
      />
      <Turntable />
    </Canvas>
  );
}
