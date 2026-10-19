import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client.ts";

export type Role = "owner" | "editor" | "viewer";
export type Compiler = "pdflatex" | "xelatex" | "lualatex";

export interface ProjectSummary {
  id: string;
  name: string;
  role: Role;
  ownerId: string;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  purgeAt: string | null;
}

export interface Member {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
}

export interface ProjectDetails {
  id: string;
  name: string;
  role: Role;
  ownerId: string;
  mainFile: string;
  compiler: Compiler;
  members: Member[];
  createdAt: string;
  updatedAt: string;
}

export const projectKeys = {
  all: ["projects"] as const,
  list: (deleted: boolean) => ["projects", "list", { deleted }] as const,
  detail: (id: string) => ["projects", "detail", id] as const,
};

export function useProjects(deleted = false) {
  return useQuery({
    queryKey: projectKeys.list(deleted),
    queryFn: () =>
      api<ProjectSummary[]>(
        "GET",
        deleted ? "/api/projects?deleted=true" : "/api/projects",
      ),
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () =>
      api<ProjectDetails>("GET", `/api/projects/${encodeURIComponent(id)}`),
    retry: false,
  });
}

/** Mutations invalidate every project query; lists are small. */
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

const path = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

export const useCreateProject = () =>
  useProjectMutation((name: string) =>
    api<ProjectDetails>("POST", "/api/projects", { name }),
  );

export const useRenameProject = () =>
  useProjectMutation(({ id, name }: { id: string; name: string }) =>
    api<ProjectDetails>("PATCH", path(id), { name }),
  );

export const useDeleteProject = () =>
  useProjectMutation((id: string) => api<undefined>("DELETE", path(id)));

export const useRestoreProject = () =>
  useProjectMutation((id: string) =>
    api<ProjectDetails>("POST", `${path(id)}/restore`),
  );

export const useDuplicateProject = () =>
  useProjectMutation((id: string) =>
    api<ProjectDetails>("POST", `${path(id)}/duplicate`),
  );
