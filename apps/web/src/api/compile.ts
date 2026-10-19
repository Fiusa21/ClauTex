import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client.ts";
import { projectKeys, type Compiler, type Project } from "./projects.ts";

export type BuildStatus = "success" | "failure" | "timeout" | "error";

export interface CompileIssue {
  level: "error" | "warning";
  file: string | null;
  line: number | null;
  message: string;
}

export interface Build {
  buildId: string;
  status: BuildStatus;
  errors: CompileIssue[];
  logExcerpt: string;
  pdfUrl: string | null;
  durationMs: number;
  createdAt: string;
}

const buildsKey = (projectId: string) => ["builds", projectId] as const;

export const logUrl = (projectId: string, buildId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/builds/${encodeURIComponent(buildId)}/output.log`;

/** Recent builds, newest first. */
export function useBuilds(projectId: string) {
  return useQuery({
    queryKey: buildsKey(projectId),
    queryFn: () =>
      api<Build[]>(
        "GET",
        `/api/projects/${encodeURIComponent(projectId)}/builds`,
      ),
  });
}

export function useCompile(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<Build>(
        "POST",
        `/api/projects/${encodeURIComponent(projectId)}/compile`,
      ),
    onSuccess: (build) => {
      queryClient.setQueryData<Build[]>(buildsKey(projectId), (old) => [
        build,
        ...(old ?? []).filter((b) => b.buildId !== build.buildId),
      ]);
    },
  });
}

export function useSetCompiler(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (compiler: Compiler) =>
      api<Project>("PATCH", `/api/projects/${encodeURIComponent(projectId)}`, {
        compiler,
      }),
    onSuccess: (project) => {
      queryClient.setQueryData(projectKeys.detail(projectId), project);
    },
  });
}
