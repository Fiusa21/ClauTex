import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiUpload } from "./client.ts";

export type Compiler = "pdflatex" | "xelatex" | "lualatex";

/** A project is a folder: in the workspace (id = folder name) or opened from elsewhere (id = `ext:…`). */
export interface Project {
  id: string;
  /** Display name: the folder name. */
  name: string;
  /** Opened from outside the workspace: cannot be renamed or deleted from the app. */
  external: boolean;
  /** Absolute path of an opened folder. */
  path: string | null;
  mainFile: string | null;
  compiler: Compiler;
  updatedAt: string;
}

export interface TrashEntry {
  entry: string;
  name: string;
  deletedAt: string;
}

export const projectUrl = (id: string) =>
  `/api/projects/${encodeURIComponent(id)}`;
export const projectPage = (id: string) => `/project/${encodeURIComponent(id)}`;
export const exportUrl = (id: string) => `${projectUrl(id)}/export.zip`;

export const projectKeys = {
  all: ["projects"] as const,
  list: ["projects", "list"] as const,
  trash: ["projects", "trash"] as const,
  detail: (id: string) => ["projects", "detail", id] as const,
};

export function useProjects() {
  return useQuery({
    queryKey: projectKeys.list,
    queryFn: () => api<Project[]>("GET", "/api/projects"),
  });
}

export function useTrash() {
  return useQuery({
    queryKey: projectKeys.trash,
    queryFn: () => api<TrashEntry[]>("GET", "/api/trash"),
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => api<Project>("GET", projectUrl(id)),
    retry: false,
  });
}

/** Every project mutation refreshes all project queries (lists are small). */
function useProjectMutation<TInput, TResult>(
  fn: (input: TInput) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: projectKeys.all }),
  });
}

export const useCreateProject = () =>
  useProjectMutation((name: string) =>
    api<Project>("POST", "/api/projects", { name }),
  );

export const useRenameProject = () =>
  useProjectMutation(({ id, newName }: { id: string; newName: string }) =>
    api<Project>("PATCH", projectUrl(id), { name: newName }),
  );

export const useDeleteProject = () =>
  useProjectMutation((id: string) => api<undefined>("DELETE", projectUrl(id)));

export const useDuplicateProject = () =>
  useProjectMutation((id: string) =>
    api<Project>("POST", `${projectUrl(id)}/duplicate`, {}),
  );

export const useRestoreProject = () =>
  useProjectMutation((entry: string) =>
    api<Project>("POST", `/api/trash/${encodeURIComponent(entry)}/restore`),
  );

export const useImportZip = () =>
  useProjectMutation((file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiUpload<Project>("/api/projects/import", form);
  });
