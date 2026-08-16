"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ImageCategory } from "@/types/product";

export interface ServiceStatus {
  id: string;
  label: string;
  ok: boolean;
  message: string | null;
}

/**
 * Live connectivity check for every integration — see
 * api/settings/status/route.ts. Deliberately not kept fresh automatically
 * (no refetch on window focus, infinite staleTime): each check is a real
 * call to five different external APIs, so it should only run when the
 * Settings page is actually opened or the user explicitly hits "Recheck",
 * not every time they tab back into the browser.
 */
export function useIntegrationStatus() {
  return useQuery({
    queryKey: ["settings-status"],
    queryFn: async () => {
      const res = await fetch("/api/settings/status");
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't check integration status.");
      }
      const data = (await res.json()) as { services: ServiceStatus[] };
      return data.services;
    },
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
}

export interface AppSettings {
  generationCounts: Record<ImageCategory, number>;
}

/** Default Generation Counts and any other admin-editable settings — see services/app-settings.ts. */
export function useAppSettings() {
  return useQuery({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't load settings.");
      }
      return (await res.json()) as AppSettings;
    },
  });
}

export function useUpdateGenerationCounts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (generationCounts: Partial<Record<ImageCategory, number>>) => {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationCounts }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't save settings.");
      }
      return (await res.json()) as AppSettings;
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(["app-settings"], settings);
    },
  });
}
