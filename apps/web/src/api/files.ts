import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiUpload } from "./client.ts";
import { projectKeys, projectUrl, type Project } from "./projects.ts";

export type FileKind = "folder" | "doc" | "binary";

/** A file or folder in a project. Files are identified by their path (`id === path`). */
export interface FileEntry {
  id: string;
  path: string;
  kind: FileKind;
  size: number | null;
  mtime: string;
}

interface ServerFile {
  path: string;
  kind: "folder" | "file";
  text: boolean;
  size: number | null;
  mtime: string;
}

export interface UploadResponse {
  file: FileEntry;
  notice: string | null;
}

const toEntry = (f: ServerFile): FileEntry => ({
  id: f.path,
  path: f.path,
  kind: f.kind === "folder" ? "folder" : f.text ? "doc" : "binary",
  size: f.size,
  mtime: f.mtime,
});

const filesUrl = (project: string) => `${projectUrl(project)}/files`;

export const fileKeys = {
  list: (project: string) => ["files", project] as const,
};

export const contentUrl = (project: string, path: string, download = false) =>
  `${filesUrl(project)}/content?path=${encodeURIComponent(path)}${download ? "&download=true" : ""}`;

export function useFiles(project: string) {
  return useQuery({
    queryKey: fileKeys.list(project),
    queryFn: async () =>
      (await api<ServerFile[]>("GET", filesUrl(project))).map(toEntry),
  });
}

function useFileMutation<TInput, TResult>(
  project: string,
  fn: (input: TInput) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: fileKeys.list(project) }),
        // Moves can change the main file.
        queryClient.invalidateQueries({
          queryKey: projectKeys.detail(project),
        }),
      ]);
    },
  });
}

export const useCreateFile = (project: string) =>
  useFileMutation(
    project,
    async (input: { path: string; kind: "doc" | "folder" }) =>
      toEntry(
        await api<ServerFile>("POST", filesUrl(project), {
          path: input.path,
          kind: input.kind === "doc" ? "file" : "folder",
        }),
      ),
  );

export const useUploadFile = (project: string) =>
  useFileMutation(
    project,
    async ({
      file,
      path,
    }: {
      file: File;
      path: string;
    }): Promise<UploadResponse> => {
      const form = new FormData();
      form.append("file", file);
      const stored = await apiUpload<ServerFile>(
        `${filesUrl(project)}/upload?path=${encodeURIComponent(path)}`,
        form,
      );
      return { file: toEntry(stored), notice: null };
    },
  );

export const useMoveFile = (project: string) =>
  useFileMutation(project, async ({ id, path }: { id: string; path: string }) =>
    toEntry(
      await api<ServerFile>("PATCH", filesUrl(project), { from: id, to: path }),
    ),
  );

export const useDeleteFile = (project: string) =>
  useFileMutation(project, (id: string) =>
    api<undefined>(
      "DELETE",
      `${filesUrl(project)}?path=${encodeURIComponent(id)}`,
    ),
  );

export const useSetMainFile = (project: string) =>
  useFileMutation(project, (mainFile: string) =>
    api<Project>("PATCH", projectUrl(project), { mainFile }),
  );
