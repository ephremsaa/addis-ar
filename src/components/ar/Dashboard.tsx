import { useEffect, useState, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Plus,
  Upload,
  Search,
  Grid2X2,
  List,
  MoreHorizontal,
  Box,
  ArrowUpRight,
  Sparkles,
  FolderOpen,
  Copy,
  Trash2,
  Pencil,
  Download,
  Lock,
  ChevronRight,
  Camera,
  Scan,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Workspace } from "./Workspace";
import { SceneCanvas } from "./SceneCanvas";
import { ARWorkspace } from "./ARWorkspace";
import {
  listProjects,
  saveProject,
  deleteProject,
  newProject,
  importProject,
  exportProject,
  download,
  type Project,
} from "@/lib/ar/projects";
import banner from "@/assets/studio-banner.jpg";

export const templates = ["Sculpture studio", "Geometric playground", "Material study"];

export function Dashboard({ templatesOnly = false }: { templatesOnly?: boolean }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");
  const [view, setView] = useState("grid");
  const [filter, setFilter] = useState("all");
  const [dialog, setDialog] = useState<{
    type: "new" | "rename" | "delete";
    project?: Project;
  } | null>(null);
  const [name, setName] = useState("");
  const [menu, setMenu] = useState("");
  const [error, setError] = useState("");
  const [arProject, setArProject] = useState<Project | null>(null);

  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const reload = () =>
    listProjects()
      .then(setProjects)
      .catch(() => setError("Unable to open local storage. Check your browser settings."));

  useEffect(() => {
    reload();
  }, []);

  const open = (id: string) => navigate({ to: "/editor/$projectId", params: { projectId: id } });

  const create = async (template?: string) => {
    try {
      const p = newProject(template || name || "Untitled experience", template);
      await saveProject(p);
      open(p.id);
    } catch {
      setError("Project could not be saved. Export backups and check available browser storage.");
    }
  };

  const openAr = async () => {
    const firstProject = projects[0];
    if (firstProject) {
      setArProject(firstProject);
    } else {
      try {
        const p = newProject("AR experience", "Sculpture studio");
        await saveProject(p);
        setArProject(p);
        reload();
      } catch {
        setError("Unable to initialize AR experience.");
      }
    }
  };

  const filtered = projects
    .filter(
      (p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) &&
        (filter !== "recent" || Date.now() - p.updated < 7 * 86400000),
    )
    .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : b.updated - a.updated));

  const backup = () =>
    download(
      new Blob([JSON.stringify({ format: "addis-ar-backup", projects })], {
        type: "application/json",
      }),
      "addis-ar-backup.json",
    );

  return (
    <Workspace page={templatesOnly ? "Templates" : "My projects"}>
      <main className="main-content">
        {/* Page Heading & Responsive Action Buttons */}
        <div className="page-heading">
          <div>
            <h1>{templatesOnly ? "Start with a little inspiration." : "My projects"}</h1>
            <p>
              {templatesOnly
                ? "A starting point for your next dimension."
                : "Your ideas, in a whole new dimension."}
            </p>
          </div>

          <div className="page-actions-group">
            <Button
              onClick={() => {
                setName("");
                setDialog({ type: "new" });
              }}
              className="primary-action-btn font-semibold gap-1.5"
            >
              <Plus size={16} /> New project
            </Button>

            <div className="quick-actions-row">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate({ to: "/scanner" })}
                className="gap-1.5 text-xs font-medium"
              >
                <Scan size={14} className="text-primary" /> Scan Object
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={openAr}
                className="gap-1.5 text-xs font-medium"
              >
                <Camera size={14} className="text-emerald-400" /> AR Camera
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => input.current?.click()}
                className="gap-1.5 text-xs font-medium"
              >
                <Upload size={14} /> Import
              </Button>
            </div>
          </div>
        </div>

        {/* Hidden import input */}
        <input
          ref={input}
          type="file"
          accept=".addisar,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const json = JSON.parse(await f.text());
              if (json.format === "addis-ar-backup" && Array.isArray(json.projects)) {
                for (const entry of json.projects) {
                  const p = await importProject(
                    new File([JSON.stringify(entry)], "project.addisar"),
                  );
                  await saveProject(p);
                }
                await reload();
              } else {
                const p = await importProject(f);
                await saveProject(p);
                await reload();
              }
            } catch {
              setError("This is not a valid Addis AR project or backup.");
            }
            e.target.value = "";
          }}
        />

        {error && (
          <div
            role="alert"
            className="mb-5 p-3 rounded-lg bg-destructive/15 border border-destructive/30 text-destructive text-xs flex items-center justify-between"
          >
            <span>{error}</span>
            <Button variant="ghost" size="sm" onClick={() => setError("")}>
              Dismiss
            </Button>
          </div>
        )}

        {/* Banner Section */}
        {!templatesOnly && (
          <>
            <section className="studio-banner">
              <img
                src={banner}
                alt="Glass and chrome 3D shapes in a creative studio"
                width={1536}
                height={512}
              />
              <div className="banner-content">
                <div className="eyebrow">
                  <Sparkles size={13} />
                  MAKE ROOM FOR YOUR IMAGINATION
                </div>
                <h2>
                  Small ideas.
                  <br />
                  Extraordinary dimensions.
                </h2>
                <p>Create something the world hasn’t seen before.</p>
                <div className="banner-actions-row">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setName("");
                      setDialog({ type: "new" });
                    }}
                    className="gap-1.5 font-semibold text-xs"
                  >
                    Create an experience
                    <ArrowUpRight size={14} />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate({ to: "/scanner" })}
                    className="gap-1.5 font-semibold text-xs bg-card/60 backdrop-blur-md"
                  >
                    <Scan size={14} className="text-primary" />
                    Scan Object
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={openAr}
                    className="gap-1.5 font-semibold text-xs bg-primary text-primary-foreground"
                  >
                    <Camera size={14} />
                    Open AR Camera
                  </Button>
                </div>
              </div>
            </section>

            {/* Projects Section Header */}
            <div className="section-title">
              <h2>
                Your projects
                <span className="count">{projects.length}</span>
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={backup}
                disabled={!projects.length}
                className="text-xs gap-1.5"
              >
                <Download size={13} />
                Back up all
              </Button>
            </div>

            {/* Filters Bar */}
            <div className="filters">
              <div className="filter-tabs">
                <Button
                  size="sm"
                  variant={filter === "all" ? "secondary" : "ghost"}
                  onClick={() => setFilter("all")}
                  className="text-xs h-8"
                >
                  All projects
                </Button>
                <Button
                  size="sm"
                  variant={filter === "recent" ? "secondary" : "ghost"}
                  onClick={() => setFilter("recent")}
                  className="text-xs h-8"
                >
                  Recently edited
                </Button>
              </div>

              <div className="filter-right">
                <div className="searchbox">
                  <Search size={14} />
                  <input
                    aria-label="Search projects"
                    placeholder="Search projects…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <select
                  aria-label="Sort projects"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  className="text-xs h-8"
                >
                  <option value="recent">Last modified</option>
                  <option value="name">Name A–Z</option>
                </select>
                <div className="view-toggle">
                  <Button
                    aria-label="Grid view"
                    title="Grid view"
                    variant="ghost"
                    size="icon"
                    className={view === "grid" ? "active" : ""}
                    onClick={() => setView("grid")}
                  >
                    <Grid2X2 size={14} />
                  </Button>
                  <Button
                    aria-label="List view"
                    title="List view"
                    variant="ghost"
                    size="icon"
                    className={view === "list" ? "active" : ""}
                    onClick={() => setView("list")}
                  >
                    <List size={14} />
                  </Button>
                </div>
              </div>
            </div>

            {/* Project Grid */}
            <div className={`project-grid ${view === "list" ? "list-view" : ""}`}>
              {filtered.map((p) => (
                <article className="project-card" key={p.id}>
                  <div
                    className="project-visual"
                    onClick={() => open(p.id)}
                    role="link"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") open(p.id);
                    }}
                    aria-label={`Open ${p.name}`}
                  >
                    <div className="mode-badge">
                      <Box size={10} />
                      3D experience
                    </div>
                    <SceneCanvas objects={p.objects} thumbnail />
                  </div>

                  <div className="project-meta">
                    <div>
                      <h3>{p.name}</h3>
                      <p>
                        <FolderOpen size={10} />
                        Local draft
                        <span>·</span>
                        {new Date(p.updated).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Options for ${p.name}`}
                      onClick={() => setMenu(menu === p.id ? "" : p.id)}
                      className="h-8 w-8"
                    >
                      <MoreHorizontal size={14} />
                    </Button>
                  </div>

                  {menu === p.id && (
                    <div className="card-menu">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setArProject(p);
                          setMenu("");
                        }}
                      >
                        <Camera size={14} />
                        Open in AR
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          navigate({ to: "/scanner" });
                          setMenu("");
                        }}
                      >
                        <Scan size={14} />
                        Scan 3D Object
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setName(p.name);
                          setDialog({ type: "rename", project: p });
                          setMenu("");
                        }}
                      >
                        <Pencil size={14} />
                        Rename
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          await saveProject({
                            ...p,
                            id: crypto.randomUUID(),
                            name: p.name + " copy",
                            updated: Date.now(),
                          });
                          setMenu("");
                          reload();
                        }}
                      >
                        <Copy size={14} />
                        Duplicate
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          exportProject(p);
                          setMenu("");
                        }}
                      >
                        <Download size={14} />
                        Export
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setDialog({ type: "delete", project: p });
                          setMenu("");
                        }}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 size={14} />
                        Delete
                      </Button>
                    </div>
                  )}
                </article>
              ))}

              <Button
                variant="ghost"
                className="new-card"
                onClick={() => {
                  setName("");
                  setDialog({ type: "new" });
                }}
              >
                <span className="plus-box">
                  <Plus size={22} />
                </span>
                <h3>Create a new project</h3>
                <p>A blank canvas. Endless possibilities.</p>
              </Button>
            </div>

            {!filtered.length && search && (
              <p className="project-empty">No projects match “{search}”.</p>
            )}
          </>
        )}

        {/* Templates Section */}
        <section className="template-section">
          <div className="section-title">
            <h2>{templatesOnly ? "3D starter templates" : "A head start for your next idea"}</h2>
            {!templatesOnly && (
              <Button variant="ghost" size="sm" asChild className="text-xs">
                <a href="/templates">
                  Browse templates
                  <ChevronRight size={14} />
                </a>
              </Button>
            )}
          </div>
          <div className="template-grid">
            {templates.map((t, i) => (
              <Button key={t} variant="ghost" className="template-card" onClick={() => create(t)}>
                <div className="template-preview">
                  <SceneCanvas objects={newProject(t, t).objects} thumbnail />
                </div>
                <div>
                  <h3>{t}</h3>
                  <p>
                    {
                      [
                        "A form worth exploring",
                        "Play with shape and space",
                        "Find your perfect finish",
                      ][i]
                    }
                  </p>
                </div>
                <ArrowUpRight className="ml-auto text-muted-foreground" size={14} />
              </Button>
            ))}
          </div>
        </section>

        <div className="bottom-note">
          <Lock size={11} />
          Free to create. No account. No API keys. Just your imagination.
        </div>
      </main>

      {/* Dialog for New / Rename / Delete */}
      {dialog && (
        <div className="dialog-scrim" onClick={() => setDialog(null)}>
          <form
            className="dialog-box"
            role="dialog"
            aria-modal="true"
            aria-label={
              dialog.type === "new"
                ? "New project"
                : dialog.type === "rename"
                  ? "Rename project"
                  : "Delete project"
            }
            onClick={(e) => e.stopPropagation()}
            onSubmit={async (e) => {
              e.preventDefault();
              if (dialog.type === "new") await create();
              else if (dialog.project) {
                if (dialog.type === "delete") await deleteProject(dialog.project.id);
                else
                  await saveProject({
                    ...dialog.project,
                    name: name.trim() || dialog.project.name,
                    updated: Date.now(),
                  });
                await reload();
              }
              setDialog(null);
            }}
          >
            <h2>
              {dialog.type === "new"
                ? "A new dimension starts here."
                : dialog.type === "rename"
                  ? "Rename project"
                  : "Delete this project?"}
            </h2>
            {dialog.type === "delete" ? (
              <p>
                “{dialog.project?.name}” will be removed from this device. Export a backup first if
                you want to keep it.
              </p>
            ) : (
              <>
                <label htmlFor="project-name">Project name</label>
                <input
                  id="project-name"
                  autoFocus
                  required
                  maxLength={120}
                  placeholder="Untitled experience"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <p>3D preview · Stored on this device</p>
              </>
            )}
            <div className="dialog-actions">
              <Button type="button" variant="ghost" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" variant={dialog.type === "delete" ? "destructive" : "default"}>
                {dialog.type === "new"
                  ? "Create project"
                  : dialog.type === "rename"
                    ? "Save name"
                    : "Delete project"}
                {dialog.type === "new" && <ArrowUpRight size={14} />}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* AR Camera Overlay */}
      {arProject && (
        <ARWorkspace
          project={arProject}
          onUpdateProject={async (updated) => {
            await saveProject(updated);
            reload();
          }}
          onReturnToEditor={() => setArProject(null)}
        />
      )}
    </Workspace>
  );
}
