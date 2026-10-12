"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OnlineSyncState } from "@/types/online-orders";

export interface OnlineSyncResult extends OnlineSyncState {
  firstRun: boolean;
  imported: number;
  returned: number;
  shopifySent: number;
}

async function readError(res: Response, fallback: string): Promise<Error> {
  const data = await res.json().catch(() => null);
  return new Error(data?.error ?? fallback);
}

/** What the last online orders sync found (services/online-orders.ts); null before the first one. */
export function useOnlineSyncState() {
  return useQuery({
    queryKey: ["online-orders"],
    queryFn: async (): Promise<OnlineSyncState | null> => {
      const res = await fetch("/api/online-orders");
      if (!res.ok) throw await readError(res, "Couldn't load the online orders status.");
      const { state } = (await res.json()) as { state: OnlineSyncState | null };
      return state;
    },
  });
}

export function useSyncOnlineOrders() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<OnlineSyncResult> => {
      const res = await fetch("/api/online-orders", { method: "POST" });
      if (!res.ok) throw await readError(res, "Couldn't sync online orders.");
      return (await res.json()) as OnlineSyncResult;
    },
    onSuccess: (result) => {
      queryClient.setQueryData<OnlineSyncState>(["online-orders"], {
        trackingSince: result.trackingSince,
        lastSyncedAt: result.lastSyncedAt,
        waiting: result.waiting,
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-log"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["products-list"] });
    },
  });
}
