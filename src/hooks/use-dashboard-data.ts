"use client";

import { useQuery } from "@tanstack/react-query";
import type { ProductRecord } from "@/types/product";

export interface DashboardStats {
  total: number;
  published: number;
  draft: number;
  processing: number;
}

export interface DashboardData {
  stats: DashboardStats;
  recentProducts: ProductRecord[];
  recentlyPublished: ProductRecord[];
  processingQueue: ProductRecord[];
}

function computeDashboardData(products: ProductRecord[]): DashboardData {
  const stats: DashboardStats = {
    total: products.length,
    published: products.filter((p) => p.status === "published").length,
    draft: products.filter((p) => p.status === "draft").length,
    processing: products.filter((p) => p.status === "processing").length,
  };

  const byCreatedDateDesc = [...products].sort(
    (a, b) => new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime()
  );

  return {
    stats,
    recentProducts: byCreatedDateDesc.slice(0, 5),
    recentlyPublished: byCreatedDateDesc
      .filter((p) => p.status === "published")
      .slice(0, 5),
    // "Processing Queue" surfaces anything still in flight, plus anything
    // that failed and needs attention/retry — both are operationally active.
    processingQueue: byCreatedDateDesc.filter(
      (p) => p.status === "processing" || p.status === "failed"
    ),
  };
}

async function fetchDashboardData(): Promise<DashboardData> {
  // Real source of truth as of Milestone 8: GET /api/products reads
  // straight from the Google Sheet (server-only googleapis auth, so it
  // can't be called directly from this client hook).
  const res = await fetch("/api/products");
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "Couldn't load dashboard data.");
  }
  const { products } = (await res.json()) as { products: ProductRecord[] };
  return computeDashboardData(products);
}

export function useDashboardData() {
  return useQuery({
    queryKey: ["dashboard-data"],
    queryFn: fetchDashboardData,
  });
}
