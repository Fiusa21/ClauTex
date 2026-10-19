import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client.ts";
import {
  projectKeys,
  projectUrl,
  type Compiler,
  type Project,
} from "./projects.ts";

export type BuildStatus = "success" | "failure" | "timeout" | "error";

export interface CompileIssue {
  level: "error" | "warning";
  file: string | null;
  line: number | null;
  message: string;
}

export interface Build {
  status: BuildStatus;
  errors: CompileIssue[];
  logExcerpt: string;
  durationMs: number;
  createdAt: string;
  /** Last successful PDF (possibly from an earlier build). */
  pdfUrl: string | null;
  /** True when this build produced the PDF. */
  pdfIsFresh: boolean;
}

const buildKey = (project: string) => ["build", project] as const;

export const logUrl = (project: string) => `${projectUrl(project)}/output.log`;

/** The last build, so the PDF shows again when a project is reopened. */
export function useLastBuild(project: string) {
  return useQuery({
    queryKey: buildKey(project),
    queryFn: async () =>
      (
        await api<{ build: Build | null }>(
          "GET",
          `${projectUrl(project)}/build`,
        )
      ).build,
  });
}

export function useCompile(project: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<Build>("POST", `${projectUrl(project)}/compile`),
    onSuccess: (build) => {
      queryClient.setQueryData(buildKey(project), build);
    },
  });
}

export function useSetCompiler(project: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (compiler: Compiler) =>
      api<Project>("PATCH", projectUrl(project), { compiler }),
    onSuccess: (updated) => {
      queryClient.setQueryData(projectKeys.detail(project), updated);
    },
  });
}
