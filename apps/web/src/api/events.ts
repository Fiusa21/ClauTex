import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent } from "react";
import { fileKeys } from "./files.ts";
import { projectKeys, projectUrl } from "./projects.ts";

/**
 * Subscribes to changes on disk (server-sent events). Refreshes the file tree and project info, and passes the
 * changed paths to `onChange` (the editor checks whether its file is among them).
 */
export function useProjectEvents(
  project: string,
  onChange: (paths: string[]) => void,
): void {
  const queryClient = useQueryClient();
  const handle = useEffectEvent((paths: string[]) => {
    void queryClient.invalidateQueries({ queryKey: fileKeys.list(project) });
    void queryClient.invalidateQueries({
      queryKey: projectKeys.detail(project),
    });
    onChange(paths);
  });

  useEffect(() => {
    const source = new EventSource(`${projectUrl(project)}/events`);
    source.addEventListener("change", (event) => {
      const { paths } = JSON.parse((event as MessageEvent<string>).data) as {
        paths: string[];
      };
      handle(paths);
    });
    return () => {
      source.close();
    };
  }, [project]);
}
