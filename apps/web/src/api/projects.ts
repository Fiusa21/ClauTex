import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client.ts";

export type Compiler = "pdflatex" | "xelatex" | "lualatex";

/** A project is a folder in the workspace; its name is the folder name. */
export interface Project {
  name: string;
  mainFile: string | null;
  compiler: Compiler;
  updatedAt: string;
}

export interface TrashEntry {
  entry: string;
  name: string;
  deletedAt: string;
}

export const projectUrl = (name: string) =>
  `/api/projects/${encodeURIComponent(name)}`;

export const projectKeys = {
  all: ["projects"] as const,
  list: ["projects", "list"] as const,
  trash: ["projects", "trash"] as const,
  detail: (name: string) => ["projects", "detail", name] as const,
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

export function useProject(name: string) {
  return useQuery({
    queryKey: projectKeys.detail(name),
    queryFn: () => api<Project>("GET", projectUrl(name)),
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
  useProjectMutation(({ name, newName }: { name: string; newName: string }) =>
    api<Project>("PATCH", projectUrl(name), { name: newName }),
  );

export const useDeleteProject = () =>
  useProjectMutation((name: string) =>
    api<undefined>("DELETE", projectUrl(name)),
  );

export const useDuplicateProject = () =>
  useProjectMutation((name: string) =>
    api<Project>("POST", `${projectUrl(name)}/duplicate`, {}),
  );

export const useRestoreProject = () =>
  useProjectMutation((entry: string) =>
    api<Project>("POST", `/api/trash/${encodeURIComponent(entry)}/restore`),
  );
