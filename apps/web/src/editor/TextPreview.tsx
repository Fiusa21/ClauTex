import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "../api/client.ts";
import { contentUrl } from "../api/files.ts";

/** Read-only view of a text file (the editor replaces it in L2). */
export function TextPreview({
  project,
  path,
}: {
  project: string;
  path: string;
}) {
  const content = useQuery({
    queryKey: ["content", project, path],
    queryFn: async () => {
      const res = await fetch(contentUrl(project, path));
      if (!res.ok)
        throw new Error(`Could not load ${path} (${String(res.status)}).`);
      return res.text();
    },
  });
  if (content.isPending) return <p className="page-status">Loading…</p>;
  if (content.isError)
    return <p className="form-error">{errorMessage(content.error)}</p>;
  return (
    <pre className="text-preview" data-testid="text-preview">
      {content.data}
    </pre>
  );
}
