import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ARWorkspace } from '@/components/ar/ARWorkspace';
import { listProjects, saveProject, newProject, type Project } from '@/lib/ar/projects';

export const Route = createFileRoute('/ar')({
  ssr: false,
  head: () => ({
    meta: [
      { title: 'Camera AR · Addis AR' },
      {
        name: 'description',
        content: 'Open your camera, track real-world targets and place 3D experiences in WebAR with Addis AR.',
      },
      { property: 'og:title', content: 'Camera AR · Addis AR' },
      {
        property: 'og:description',
        content: 'Free, local-first WebAR camera tracking workspace.',
      },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
  }),
  component: ARPage,
});

function ARPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    async function load() {
      try {
        const list = await listProjects();
        if (list.length > 0) {
          // Sort by most recently updated
          list.sort((a, b) => b.updated - a.updated);
          setProject(list[0]);
        } else {
          // Create initial starter experience
          const fresh = newProject('My AR Experience', 'Sculpture studio');
          await saveProject(fresh);
          setProject(fresh);
        }
      } catch (err) {
        console.error('Failed to load project for AR:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground text-sm">
        Initializing AR Camera…
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
        <h2>No AR project available</h2>
        <button
          onClick={() => navigate({ to: '/' })}
          className="rounded bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  return (
    <ARWorkspace
      project={project}
      onUpdateProject={async (updated) => {
        await saveProject(updated);
      }}
      onReturnToEditor={() => navigate({ to: '/' })}
    />
  );
}
