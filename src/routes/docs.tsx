import { createFileRoute } from "@tanstack/react-router";
import { Workspace } from "@/components/ar/Workspace";
export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Documentation · Addis AR" },
      {
        name: "description",
        content: "Local storage, backups, 3D formats and current AR support in Addis AR.",
      },
      { property: "og:title", content: "Documentation · Addis AR" },
      {
        property: "og:description",
        content: "Understand local project storage, supported formats and release limitations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Docs,
});
function Docs() {
  return (
    <Workspace page="Documentation">
      <main className="main-content document-content">
        <div className="page-heading">
          <div>
            <h1>Documentation</h1>
            <p>Your creations belong to you.</p>
          </div>
        </div>
        <h2>Local projects & backups</h2>
        <p>
          Projects and imported models are saved on this device in browser storage, without an
          account. Save your changes before leaving the editor. Clearing browser data or browser
          storage eviction can delete projects. Export a project backup or use “Back up all”
          regularly. Import a backup on another device to continue editing.
        </p>
        <h2>Models & scene export</h2>
        <p>
          The editor supports GLB and self-contained glTF models, including models with embedded
          textures. Multi-file glTF with external resources and compressed models requiring external
          decoders are not supported in this release. Export GLB to preserve supported geometry,
          transforms and materials. Use a project backup to preserve editable scene settings and
          model data.
        </p>
        <h2>Current release</h2>
        <p>
          This release supports a standard interactive 3D viewer, primitive creation, model import,
          precise transforms, materials, visibility, locks, undo and redo. Image-target, face and
          marker tracking, WebXR hit testing, animation timelines and interactions are not
          implemented yet. The editor does not request camera access or record footage.
        </p>
        <h2>Publishing & sharing</h2>
        <p>
          Online project publishing is not configured. Downloaded project files are portable
          backups, not public web experiences. A QR code does not host an experience. Public sharing
          will require a configured publishing service; no placeholder public links are created.
        </p>
        <h2>Privacy & resources</h2>
        <p>
          No paid AR API, AI service or API key is required for local creation. There are no
          application-level project or model count limits. Available device memory, browser storage,
          graphics support and hosting capacity still apply. Keep backups if your browser approaches
          its storage quota.
        </p>
        <h2>Open-source foundations</h2>
        <p>
          Addis AR uses Three.js, React Three Fiber, Drei, TanStack and IndexedDB. These projects
          retain their respective open-source licenses. A fully offline cached application and
          advanced AR workflows remain future work.
        </p>
      </main>
    </Workspace>
  );
}
