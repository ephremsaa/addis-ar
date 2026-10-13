import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ScannerWorkspace } from '@/components/scanner/ScannerWorkspace';
import { listProjects, type Project } from '@/lib/ar/projects';

export const Route = createFileRoute('/scanner')({
  ssr: false,
  head: () => ({
    meta: [
      { title: '3D Object Scanner · Addis AR' },
      {
        name: 'description',
        content:
          'Scan real-world objects with your phone camera, remove backgrounds, reconstruct 3D shapes and export genuine GLB models with Addis AR.',
      },
      { property: 'og:title', content: '3D Object Scanner · Addis AR' },
      {
        property: 'og:description',
        content: 'Mobile camera to 3D model generator for Addis AR.',
      },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
  }),
  component: ScannerPage,
});

function ScannerPage() {
  const [project, setProject] = useState<Project | undefined>();
  const navigate = useNavigate();

  useEffect(() => {
    async function load() {
      try {
        const list = await listProjects();
        if (list.length > 0) {
          list.sort((a, b) => b.updated - a.updated);
          setProject(list[0]);
        }
      } catch (err) {
        console.warn('Could not load latest project for scanner:', err);
      }
    }
    load();
  }, []);

  return (
    <ScannerWorkspace
      targetProject={project}
      onClose={() => navigate({ to: '/' })}
    />
  );
}
