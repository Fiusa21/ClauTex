import { useQuery } from "@tanstack/react-query";
import { api } from "./client.ts";

export interface Health {
  status: "UP";
  version: string;
  workspace: string;
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => api<Health>("GET", "/api/health"),
  });
}
