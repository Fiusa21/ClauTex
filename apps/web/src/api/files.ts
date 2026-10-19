import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiUpload } from "./client.ts";
import { projectKeys, type ProjectDetails } from "./projects.ts";

export type FileKind = "folder" | "doc" | "binary";

export interface FileEntry {
  id: string;
  path: string;
  kind: FileKind;
  size: number | null;
  contentType: string | null;
  updatedAt: string;
}

export interface UploadResponse {
  file: FileEntry;
  notice: string | null;
}

const base = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/files`;

export const fileKeys = {
  list: (projectId: string) => ["files", projectId] as const,
};

export const contentUrl = (
  projectId: string,
  fileId: string,
  download = false,
) =>
  `${base(projectId)}/${encodeURIComponent(fileId)}/content${download ? "?download=true" : ""}`;

export function useFiles(projectId: string) {
  return useQuery({
    queryKey: fileKeys.list(projectId),
    queryFn: () => api<FileEntry[]>("GET", base(projectId)),
  });
}

function useFileMutation<TInput, TResult>(
  projectId: string,
  fn: (input: TInput) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: fileKeys.list(projectId) }),
        // Moves can change the main file.
        queryClient.invalidateQueries({
          queryKey: projectKeys.detail(projectId),
        }),
      ]);
    },
  });
}

export const useCreateFile = (projectId: string) =>
  useFileMutation(
    projectId,
    (input: { path: string; kind: "doc" | "folder" }) =>
      api<FileEntry>("POST", base(projectId), input),
  );

export const useUploadFile = (projectId: string) =>
  useFileMutation(projectId, ({ file, path }: { file: File; path: string }) => {
    const form = new FormData();
    form.append("file", file);
    return apiUpload<UploadResponse>(
      `${base(projectId)}/upload?path=${encodeURIComponent(path)}`,
      form,
    );
  });

export const useMoveFile = (projectId: string) =>
  useFileMutation(projectId, ({ id, path }: { id: string; path: string }) =>
    api<FileEntry>("PATCH", `${base(projectId)}/${encodeURIComponent(id)}`, {
      path,
    }),
  );

export const useDeleteFile = (projectId: string) =>
  useFileMutation(projectId, (id: string) =>
    api<undefined>("DELETE", `${base(projectId)}/${encodeURIComponent(id)}`),
  );

export const useSetMainFile = (projectId: string) =>
  useFileMutation(projectId, (mainFile: string) =>
    api<ProjectDetails>(
      "PATCH",
      `/api/projects/${encodeURIComponent(projectId)}`,
      { mainFile },
    ),
  );
