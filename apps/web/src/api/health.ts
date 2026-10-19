import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client.ts";

export interface TexInfo {
  available: boolean;
  version: string | null;
  engines: { pdflatex: boolean; xelatex: boolean; lualatex: boolean };
  problem: string | null;
}

export interface Health {
  status: "UP";
  version: string;
  workspace: string;
  tex: TexInfo;
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => api<Health>("GET", "/api/health"),
  });
}

/** Looks for TeX again (after the user installed it). */
export function useDetectTex() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<TexInfo>("POST", "/api/tex/detect"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["health"] }),
  });
}
