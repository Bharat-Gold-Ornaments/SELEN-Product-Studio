"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReconciliationReport } from "@/types/reconciliation";

async function fetchReconciliation(): Promise<ReconciliationReport> {
  const res = await fetch("/api/reconciliation");
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "Couldn't run the reconciliation.");
  }
  return (await res.json()) as ReconciliationReport;
}

/**
 * Runs once when the page opens; after that only on "Run again" — each run
 * reads every Shopify product, so it isn't refetched on window focus.
 */
export function useReconciliation() {
  return useQuery({
    queryKey: ["reconciliation"],
    queryFn: fetchReconciliation,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}
