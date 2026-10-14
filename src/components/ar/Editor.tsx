import { useState, useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Save,
  Undo2,
  Redo2,
  Upload,
  Download,
  Play,
  X,
  Move,
  RotateCw,
  Scaling,
  Box,
  Circle,
  Triangle,
  Cylinder,
  Square,
  CircleDashed,
  RectangleVertical,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Copy,
  Trash2,
  Check,
  FolderDown,
  Camera,
  Scan,
  MoreHorizontal,
  Layers,
  Sliders,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SceneCanvas } from "./SceneCanvas";
import { ARWorkspace } from "./ARWorkspace";
import { ScannerWorkspace } from "@/components/scanner/ScannerWorkspace";
import {
  getProject,
  saveProject,
  newObject,
  exportProject,
  type Project,
  type SceneObject,
} from "@/lib/ar/projects";
import { readModel, exportGLB } from "@/lib/ar/scene";

const primitiveIcons = {
  cube: Box,
  sphere: Circle,
  cylinder: Cylinder,
  cone: Triangle,
  plane: Square,
  torus: CircleDashed,
  capsule: RectangleVertical,
};

export function Editor({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project>();
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState<"translate" | "rotate" | "scale">("translate");
  const [past, setPast] = useState<Project[]>([]);
  const [future, setFuture] = useState<Project[]>([]);
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState(false);
  const [arMode, setArMode] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<{ object: SceneObject; info: string }>();

  // Mobile drawer states
  const [mobileTab, setMobileTab] = useState<"none" | "add" | "scene" | "properties">("none");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const file = useRef<HTMLInputElement>(null);
  const dirty = useRef(false);

  useEffect(() => {
    getProject(projectId)
      .then((p) => {
        setProject(p);
        setSelected(p?.objects[0]?.id || "");
        setLoading(false);
      })
      .catch(() => {
        setStatus("Local storage could not be opened.");
        setLoading(false);
      });
  }, [projectId]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const change = (p: Project) => {
    if (!project) return;
    setPast((s) => [...s, project]);
    setFuture([]);
    setProject({ ...p, updated: Date.now() });
    setStatus("Unsaved changes");
    dirty.current = true;
  };

  const update = (o: SceneObject) => {
    if (project) {
      change({
        ...project,
        objects: project.objects.map((x) => (x.id === o.id ? o : x)),
      });
    }
  };

  const add = (kind: SceneObject["kind"]) => {
    if (!project) return;
    const o = newObject(kind);
    o.position[0] = project.objects.length * 0.3;
    change({ ...project, objects: [...project.objects, o] });
    setSelected(o.id);
  };

  const save = async () => {
    if (!project) return;
    try {
      await saveProject(project);
      setStatus("Saved on this device");
      dirty.current = false;
    } catch {
      setStatus("Save failed: browser storage is full or unavailable. Export a backup.");
    }
  };

  const undo = () => {
    if (!project || !past.length) return;
    const previous = past.at(-1);
    if (!previous) return;
    setFuture((s) => [project, ...s]);
    setPast((s) => s.slice(0, -1));
    setProject(previous);
    dirty.current = true;
    setStatus("Unsaved changes");
  };

  const redo = () => {
    if (!project || !future.length) return;
    setPast((s) => [...s, project]);
    setProject(future[0]);
    setFuture((s) => s.slice(1));
    dirty.current = true;
    setStatus("Unsaved changes");
  };

  const loadFile = async (f: File) => {
    setStatus("Reading model…");
    try {
      const m = await readModel(f);
      const o = newObject("model");
      o.name = f.name;
      o.model = m.data;
      setPending({
        object: o,
        info: `${m.meshes} meshes · ${(m.bytes / 1024).toFixed(0)} KB · ${m.size.map((v) => v.toFixed(2)).join(" × ")} units`,
      });
      setStatus("Model ready");
    } catch (e) {
      setStatus(
        e instanceof Error
          ? e.message
          : "Invalid model. Use a valid GLB or self-contained glTF file.",
      );
    }
  };

  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground text-sm">
        Opening your workspace…
      </div>
    );

  if (!project)
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 p-4 text-center">
        <h1 className="text-base font-semibold">Project not found on this device.</h1>
        <Button asChild>
          <Link to="/">My projects</Link>
        </Button>
      </div>
    );

  const object = project.objects.find((o) => o.id === selected);

  return (
    <div className="editor">
      {/* Top Bar */}
      <header className="editor-top">
        <div className="editor-title">
          <Button variant="ghost" size="icon" asChild title="Back to projects" className="h-8 w-8">
            <Link
              to="/"
              onClick={(e) => {
                if (dirty.current && !window.confirm("Leave without saving your changes?"))
                  e.preventDefault();
              }}
            >
              <ArrowLeft size={16} />
            </Link>
          </Button>

          <img src="/logo.png" alt="Addis AR logo" className="w-5 h-5 object-contain rounded" />

          <input
            aria-label="Project name"
            value={project.name}
            maxLength={120}
            onChange={(e) => change({ ...project, name: e.target.value || "Untitled" })}
            className="font-semibold text-xs sm:text-sm text-foreground bg-transparent border-0 max-w-[140px] sm:max-w-[220px]"
          />
        </div>

        {/* Desktop Header Actions */}
        <div className="editor-desktop-actions hidden md:flex items-center gap-1.5 flex-wrap">
          <Button
            title="Undo"
            aria-label="Undo"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={!past.length}
            onClick={undo}
          >
            <Undo2 size={15} />
          </Button>
          <Button
            title="Redo"
            aria-label="Redo"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={!future.length}
            onClick={redo}
          >
            <Redo2 size={15} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportProject(project)}
            title="Export project backup"
            className="h-8 text-xs gap-1.5"
          >
            <FolderDown size={14} />
            Backup
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={async () => {
              setStatus("Exporting GLB…");
              try {
                await exportGLB(project);
                setStatus("GLB exported");
              } catch (e) {
                setStatus(
                  `Export failed: ${e instanceof Error ? e.message : "Try a project backup instead."}`,
                );
              }
            }}
          >
            <Download size={14} />
            GLB
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setPreview(true)}
          >
            <Play size={14} />
            Preview
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => setArMode(true)}
            className="h-8 text-xs gap-1.5 font-semibold bg-primary text-primary-foreground"
          >
            <Camera size={14} />
            Open AR Camera
          </Button>
          <Button size="sm" onClick={save} className="h-8 text-xs gap-1.5 font-semibold">
            <Save size={14} />
            Save
          </Button>
        </div>

        {/* Mobile Header Quick Actions */}
        <div className="flex md:hidden items-center gap-1">
          <Button
            size="sm"
            onClick={save}
            className="h-8 px-2.5 text-xs font-semibold gap-1 bg-primary text-primary-foreground"
          >
            <Save size={13} />
            Save
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="More actions"
          >
            <MoreHorizontal size={18} />
          </Button>
        </div>
      </header>

      {/* Editor Main Body */}
      <div className="editor-body">
        {/* Left Panel: Add to scene & Hierarchy (visible on desktop) */}
        <aside className="editor-panel desktop-panel">
          <div className="panel-title">Add to scene</div>
          <div className="primitive-grid">
            {Object.entries(primitiveIcons).map(([kind, Icon]) => (
              <Button
                key={kind}
                variant="ghost"
                aria-label={`Add ${kind}`}
                onClick={() => add(kind as SceneObject["kind"])}
              >
                <Icon size={16} />
                <span>{kind.charAt(0).toUpperCase() + kind.slice(1)}</span>
              </Button>
            ))}
          </div>

          <Button
            className="mt-3 w-full text-xs gap-1.5"
            size="sm"
            variant="outline"
            onClick={() => file.current?.click()}
          >
            <Upload size={13} />
            Import model
          </Button>

          <Button
            className="mt-2 w-full text-xs gap-1.5"
            size="sm"
            variant="secondary"
            onClick={() => setScannerOpen(true)}
          >
            <Scan size={13} className="text-primary" />
            Scan a real object
          </Button>

          <input
            ref={file}
            hidden
            type="file"
            accept=".glb,.gltf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadFile(f);
              e.target.value = "";
            }}
          />

          <div className="hierarchy">
            <div className="panel-title">
              <span>Scene Objects</span>
              <span className="text-muted-foreground">{project.objects.length}</span>
            </div>
            {project.objects.map((o) => (
              <div key={o.id} className="hierarchy-row">
                <Button
                  variant="ghost"
                  className={selected === o.id ? "active" : ""}
                  onClick={() => setSelected(o.id)}
                >
                  <Box size={12} />
                  <span className="truncate">{o.name}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title={o.visible ? "Hide object" : "Show object"}
                  aria-label={o.visible ? "Hide object" : "Show object"}
                  onClick={() => update({ ...o, visible: !o.visible })}
                >
                  {o.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </Button>
              </div>
            ))}
          </div>
        </aside>

        {/* Center 3D Stage (Full viewport on mobile) */}
        <div
          className="editor-stage"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) loadFile(f);
          }}
        >
          {/* Gizmo Tools (Move / Rotate / Scale) */}
          <div className="stage-tools">
            {(
              [
                ["translate", Move, "Move"],
                ["rotate", RotateCw, "Rotate"],
                ["scale", Scaling, "Scale"],
              ] as const
            ).map(([value, Icon, label]) => (
              <Button
                key={value}
                variant="ghost"
                size="icon"
                title={label}
                aria-label={label}
                className={mode === value ? "active" : ""}
                onClick={() => setMode(value)}
              >
                <Icon size={14} />
              </Button>
            ))}
          </div>

          <SceneCanvas
            objects={project.objects}
            selected={selected}
            mode={mode}
            onSelect={setSelected}
            onChange={update}
          />

          <div className="stage-caption hidden sm:block">Perspective · 3D scene</div>
        </div>

        {/* Right Panel: Properties (visible on desktop) */}
        <aside className="editor-panel right desktop-panel">
          <div className="panel-title">
            Properties
            {object && (
              <div className="flex">
                <Button
                  size="icon"
                  variant="ghost"
                  title="Duplicate object"
                  aria-label="Duplicate object"
                  onClick={() => {
                    const o = {
                      ...object,
                      id: crypto.randomUUID(),
                      name: object.name + " copy",
                      position: [object.position[0] + 1, ...object.position.slice(1)] as [
                        number,
                        number,
                        number,
                      ],
                    };
                    change({ ...project, objects: [...project.objects, o] });
                    setSelected(o.id);
                  }}
                >
                  <Copy size={13} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Delete object"
                  aria-label="Delete object"
                  onClick={() => {
                    change({
                      ...project,
                      objects: project.objects.filter((o) => o.id !== selected),
                    });
                    setSelected("");
                  }}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            )}
          </div>

          {object ? (
            <>
              <div className="properties-group">
                <h3>OBJECT</h3>
                <input
                  aria-label="Object name"
                  className="w-full text-xs"
                  value={object.name}
                  onChange={(e) => update({ ...object, name: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 text-xs"
                  onClick={() => update({ ...object, locked: !object.locked })}
                >
                  {object.locked ? <Lock size={12} /> : <Unlock size={12} />}
                  {object.locked ? "Locked" : "Unlocked"}
                </Button>

                <h3 className="mt-5">TRANSFORM</h3>
                {(["position", "rotation", "scale"] as const).map((field) => (
                  <div key={field}>
                    <label className="property-label">
                      {field.charAt(0).toUpperCase() + field.slice(1)}
                      {field === "rotation" ? " (degrees)" : ""}
                    </label>
                    <div className="vector-row">
                      {["X", "Y", "Z"].map((axis, index) => (
                        <label key={axis}>
                          {axis}
                          <input
                            aria-label={`${field} ${axis}`}
                            type="number"
                            step={field === "rotation" ? 5 : 0.1}
                            disabled={object.locked}
                            value={Number(
                              (
                                (object[field][index] ?? 0) *
                                (field === "rotation" ? 180 / Math.PI : 1)
                              ).toFixed(3),
                            )}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              if (!Number.isFinite(v)) return;
                              const vec = [...object[field]] as [number, number, number];
                              vec[index] = v * (field === "rotation" ? Math.PI / 180 : 1);
                              update({ ...object, [field]: vec });
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {object.kind !== "model" && (
                <div className="properties-group">
                  <h3>MATERIAL</h3>
                  <label className="property-label">Base color</label>
                  <div className="color-control">
                    <input
                      aria-label="Object color"
                      type="color"
                      value={object.color}
                      onChange={(e) => update({ ...object, color: e.target.value })}
                    />
                    <input
                      aria-label="Color hex"
                      type="text"
                      value={object.color}
                      onChange={(e) => {
                        if (/^#[0-9a-fA-F]{6}$/.test(e.target.value))
                          update({ ...object, color: e.target.value });
                      }}
                    />
                  </div>
                  {(["roughness", "metalness"] as const).map((prop) => (
                    <div key={prop}>
                      <label className="property-label flex justify-between">
                        <span>{prop.charAt(0).toUpperCase() + prop.slice(1)}</span>
                        <span>{object[prop].toFixed(2)}</span>
                      </label>
                      <input
                        aria-label={prop}
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        className="material-slider"
                        value={object[prop]}
                        onChange={(e) => update({ ...object, [prop]: Number(e.target.value) })}
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">No object selected</p>
          )}

          <div className="properties-group">
            <h3>EXPERIENCE</h3>
            <p className="text-xs text-muted-foreground">3D preview & Camera AR</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3 w-full gap-1.5 text-xs"
              onClick={() => setArMode(true)}
            >
              <Camera size={14} />
              Open AR Camera
            </Button>
          </div>
        </aside>
      </div>

      {/* Mobile Bottom Dock (visible on mobile only) */}
      <div className="editor-mobile-dock flex md:hidden">
        <button
          onClick={() => setMobileTab(mobileTab === "add" ? "none" : "add")}
          className={`dock-btn ${mobileTab === "add" ? "active" : ""}`}
        >
          <Plus size={16} />
          <span>Add</span>
        </button>

        <button
          onClick={() => setMobileTab(mobileTab === "scene" ? "none" : "scene")}
          className={`dock-btn ${mobileTab === "scene" ? "active" : ""}`}
        >
          <Layers size={16} />
          <span>Scene ({project.objects.length})</span>
        </button>

        <button
          onClick={() => setMobileTab(mobileTab === "properties" ? "none" : "properties")}
          className={`dock-btn ${mobileTab === "properties" ? "active" : ""}`}
        >
          <Sliders size={16} />
          <span>Properties</span>
        </button>
      </div>

      {/* Mobile Slide-Up Drawers */}
      {mobileTab !== "none" && (
        <div className="mobile-sheet-overlay md:hidden" onClick={() => setMobileTab("none")}>
          <div className="mobile-sheet-content" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-border mb-3">
              <span className="font-semibold text-xs text-foreground uppercase tracking-wider">
                {mobileTab === "add"
                  ? "Add to Scene"
                  : mobileTab === "scene"
                    ? `Scene Objects (${project.objects.length})`
                    : `Properties: ${object?.name || "None"}`}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setMobileTab("none")}
              >
                <X size={15} />
              </Button>
            </div>

            {/* Content for 'add' */}
            {mobileTab === "add" && (
              <div className="space-y-4">
                <div className="grid grid-cols-4 gap-2">
                  {Object.entries(primitiveIcons).map(([kind, Icon]) => (
                    <Button
                      key={kind}
                      variant="ghost"
                      className="h-16 flex-col gap-1.5 p-1 bg-card border border-border text-[10px]"
                      onClick={() => {
                        add(kind as SceneObject["kind"]);
                        setMobileTab("none");
                      }}
                    >
                      <Icon size={16} />
                      <span className="truncate">
                        {kind.charAt(0).toUpperCase() + kind.slice(1)}
                      </span>
                    </Button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1.5"
                    onClick={() => {
                      file.current?.click();
                      setMobileTab("none");
                    }}
                  >
                    <Upload size={13} /> Import GLB
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="text-xs gap-1.5"
                    onClick={() => {
                      setScannerOpen(true);
                      setMobileTab("none");
                    }}
                  >
                    <Scan size={13} className="text-primary" /> Scan Object
                  </Button>
                </div>
              </div>
            )}

            {/* Content for 'scene' */}
            {mobileTab === "scene" && (
              <div className="space-y-2 max-h-[48vh] overflow-y-auto">
                {project.objects.map((o) => (
                  <div
                    key={o.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-card border border-border"
                  >
                    <button
                      onClick={() => {
                        setSelected(o.id);
                        setMobileTab("properties");
                      }}
                      className={`flex items-center gap-2 text-xs truncate flex-1 text-left ${
                        selected === o.id ? "text-primary font-semibold" : "text-foreground"
                      }`}
                    >
                      <Box size={13} />
                      <span className="truncate">{o.name}</span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => update({ ...o, visible: !o.visible })}
                    >
                      {o.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Content for 'properties' */}
            {mobileTab === "properties" && (
              <div className="max-h-[55vh] overflow-y-auto space-y-4">
                {object ? (
                  <>
                    <div className="flex items-center justify-between">
                      <input
                        className="text-xs font-semibold bg-secondary border border-border rounded px-2 py-1 flex-1 mr-2"
                        value={object.name}
                        onChange={(e) => update({ ...object, name: e.target.value })}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive"
                        onClick={() => {
                          change({
                            ...project,
                            objects: project.objects.filter((o) => o.id !== selected),
                          });
                          setSelected("");
                          setMobileTab("none");
                        }}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>

                    {/* Transform controls */}
                    {(["position", "rotation", "scale"] as const).map((field) => (
                      <div key={field} className="space-y-1">
                        <span className="text-[10px] text-muted-foreground uppercase font-mono">
                          {field}
                        </span>
                        <div className="grid grid-cols-3 gap-1.5">
                          {["X", "Y", "Z"].map((axis, index) => (
                            <label
                              key={axis}
                              className="text-[10px] text-muted-foreground flex items-center gap-1 bg-secondary p-1 rounded border border-border"
                            >
                              <span>{axis}</span>
                              <input
                                type="number"
                                step={field === "rotation" ? 5 : 0.1}
                                className="w-full bg-transparent text-xs text-foreground p-0 border-0"
                                value={Number(
                                  (
                                    (object[field][index] ?? 0) *
                                    (field === "rotation" ? 180 / Math.PI : 1)
                                  ).toFixed(2),
                                )}
                                onChange={(e) => {
                                  const v = Number(e.target.value);
                                  if (!Number.isFinite(v)) return;
                                  const vec = [...object[field]] as [number, number, number];
                                  vec[index] = v * (field === "rotation" ? Math.PI / 180 : 1);
                                  update({ ...object, [field]: vec });
                                }}
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}

                    {/* Material controls */}
                    {object.kind !== "model" && (
                      <div className="space-y-2 pt-2 border-t border-border">
                        <span className="text-[10px] text-muted-foreground uppercase font-mono">
                          Color & Finish
                        </span>
                        <div className="flex items-center gap-3">
                          <input
                            type="color"
                            value={object.color}
                            onChange={(e) => update({ ...object, color: e.target.value })}
                            className="w-10 h-8 rounded border border-border bg-secondary"
                          />
                          <span className="text-xs font-mono">{object.color}</span>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    Tap an object in the 3D scene or select from the Scene tab.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile Top Actions Menu Dialog */}
      {mobileMenuOpen && (
        <div className="dialog-scrim" onClick={() => setMobileMenuOpen(false)}>
          <div className="dialog-box max-w-xs" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-border mb-3">
              <span className="font-bold text-xs">Editor Actions</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setMobileMenuOpen(false)}
              >
                <X size={15} />
              </Button>
            </div>

            <div className="space-y-1 text-xs">
              <Button
                variant="ghost"
                className="w-full justify-start gap-2 h-9"
                disabled={!past.length}
                onClick={() => {
                  undo();
                  setMobileMenuOpen(false);
                }}
              >
                <Undo2 size={14} /> Undo
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start gap-2 h-9"
                disabled={!future.length}
                onClick={() => {
                  redo();
                  setMobileMenuOpen(false);
                }}
              >
                <Redo2 size={14} /> Redo
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start gap-2 h-9"
                onClick={() => {
                  setPreview(true);
                  setMobileMenuOpen(false);
                }}
              >
                <Play size={14} /> Preview Scene
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start gap-2 h-9 text-primary font-semibold"
                onClick={() => {
                  setArMode(true);
                  setMobileMenuOpen(false);
                }}
              >
                <Camera size={14} /> Open in AR Camera
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start gap-2 h-9"
                onClick={async () => {
                  setMobileMenuOpen(false);
                  setStatus("Exporting GLB…");
                  try {
                    await exportGLB(project);
                    setStatus("GLB exported");
                  } catch (e) {
                    setStatus("Export failed");
                  }
                }}
              >
                <Download size={14} /> Export GLB (.glb)
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start gap-2 h-9"
                onClick={() => {
                  exportProject(project);
                  setMobileMenuOpen(false);
                }}
              >
                <FolderDown size={14} /> Project Backup (.addisar)
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Editor Desktop Bottom Bar */}
      <footer className="editor-bottom hidden md:flex">
        <span role="status" className={status.includes("Saved") ? "status-message" : ""}>
          {status || "Local project"}{" "}
        </span>
        <span>{project.objects.length} objects · WebGL · Addis AR</span>
      </footer>

      {/* Preview Dialog */}
      {preview && (
        <div className="dialog-scrim">
          <div className="preview-stage">
            <div className="preview-label">
              <h2 className="font-semibold text-sm">{project.name}</h2>
              <p className="text-xs text-muted-foreground mt-1">3D preview</p>
              <div className="mt-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setPreview(false);
                    setArMode(true);
                  }}
                  className="gap-1.5 text-xs font-semibold"
                >
                  <Camera size={13} />
                  Open in AR Camera
                </Button>
              </div>
            </div>
            <Button
              className="preview-close"
              size="icon"
              variant="secondary"
              aria-label="Close preview"
              onClick={() => setPreview(false)}
            >
              <X size={15} />
            </Button>
            <SceneCanvas objects={project.objects} />
          </div>
        </div>
      )}

      {/* Pending Model Preview Dialog */}
      {pending && (
        <div className="dialog-scrim">
          <div className="dialog-box">
            <h2 className="text-sm font-semibold">Model preview</h2>
            <div className="h-60">
              <SceneCanvas objects={[pending.object]} thumbnail />
            </div>
            <p className="text-xs text-muted-foreground">{pending.info}</p>
            <div className="dialog-actions">
              <Button variant="ghost" onClick={() => setPending(undefined)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  change({
                    ...project,
                    objects: [...project.objects, pending.object],
                  });
                  setSelected(pending.object.id);
                  setPending(undefined);
                }}
              >
                <Check size={14} />
                Add to scene
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* AR Mode Overlay */}
      {arMode && (
        <ARWorkspace
          project={project}
          initialSelectedId={selected}
          onUpdateProject={change}
          onReturnToEditor={() => setArMode(false)}
        />
      )}

      {/* Scanner Modal */}
      {scannerOpen && (
        <div className="fixed inset-0 z-50 bg-background">
          <ScannerWorkspace targetProject={project} onClose={() => setScannerOpen(false)} />
        </div>
      )}
    </div>
  );
}
