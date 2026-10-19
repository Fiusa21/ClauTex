import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client.ts";
import { projectKeys, type Project } from "./projects.ts";

export type CompileMode = "local" | "docker";

export interface Settings {
  compileTimeoutSeconds: number;
  compileMode: CompileMode;
  workspace: string;
  /** Set on the command line; cannot be changed here. */
  workspaceLocked: boolean;
}

export interface DockerInfo {
  available: boolean;
  version: string | null;
  image: string;
  imagePresent: boolean;
  pulling: boolean;
  pullError: string | null;
  problem: string | null;
}

export interface RecentFolder {
  path: string;
  id: string | null;
  exists: boolean;
}

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Settings>("GET", "/api/settings"),
  });
}

type SettingsChanges = Partial<
  Pick<Settings, "compileTimeoutSeconds" | "compileMode">
> & {
  workspace?: string | null;
};

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: SettingsChanges) =>
      api<Settings>("PATCH", "/api/settings", changes),
    onSuccess: async (settings) => {
      queryClient.setQueryData(["settings"], settings);
      // A new workspace means a different project list.
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
      await queryClient.invalidateQueries({ queryKey: ["health"] });
    },
  });
}

/** Docker status; polls while the image downloads. */
export function useDocker() {
  return useQuery({
    queryKey: ["docker"],
    queryFn: () => api<DockerInfo>("GET", "/api/docker"),
    refetchInterval: (query) => (query.state.data?.pulling ? 3000 : false),
  });
}

export function usePullImage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<DockerInfo>("POST", "/api/docker/pull"),
    onSuccess: (info) => {
      queryClient.setQueryData(["docker"], info);
    },
  });
}

export function useRecentFolders() {
  return useQuery({
    queryKey: ["folders"],
    queryFn: () => api<RecentFolder[]>("GET", "/api/folders"),
  });
}

export function useOpenFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (path: string) =>
      api<Project>("POST", "/api/folders", { path }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["folders"] });
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}

export function useRemoveFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (path: string) =>
      api<undefined>("DELETE", `/api/folders?path=${encodeURIComponent(path)}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["folders"] });
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}
