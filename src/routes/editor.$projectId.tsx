import { createFileRoute } from "@tanstack/react-router";
import { Editor } from "@/components/ar/Editor";
export const Route = createFileRoute("/editor/$projectId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Scene editor · Addis AR" },
      {
        name: "description",
        content: "Build and customize your local 3D scene in the Addis AR visual editor.",
      },
      { property: "og:title", content: "Scene editor · Addis AR" },
      {
        property: "og:description",
        content: "A local-first visual workspace for your 3D creations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});
function Page() {
  const { projectId } = Route.useParams();
  return <Editor projectId={projectId} />;
}
