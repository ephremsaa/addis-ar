import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/components/ar/Dashboard";
export const Route = createFileRoute("/templates")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Templates · Addis AR" },
      {
        name: "description",
        content: "Explore editable 3D starter templates for your next Addis AR experience.",
      },
      { property: "og:title", content: "Templates · Addis AR" },
      { property: "og:description", content: "Start creating with editable 3D scene templates." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => <Dashboard templatesOnly />,
});
