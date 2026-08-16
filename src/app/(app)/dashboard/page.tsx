"use client";

import { Boxes, CheckCircle2, FileEdit, Loader2, RefreshCw } from "lucide-react";
import { PageShell } from "@/components/layout/page-shell";
import { StatCard, StatCardSkeleton } from "@/components/dashboard/stat-card";
import { SectionCard } from "@/components/dashboard/section-card";
import { ProductRow } from "@/components/dashboard/product-row";
import { ProcessingRow } from "@/components/dashboard/processing-row";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardData } from "@/hooks/use-dashboard-data";

function SectionSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6">
      <Skeleton className="h-4 w-32" />
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-11 w-11 rounded-xl" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useDashboardData();

  return (
    <PageShell
      title="Dashboard"
      description="An overview of every product moving through the studio."
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard label="Total Products" value={data?.stats.total ?? 0} icon={Boxes} tone="gold" />
            <StatCard label="Published" value={data?.stats.published ?? 0} icon={CheckCircle2} />
            <StatCard label="Draft" value={data?.stats.draft ?? 0} icon={FileEdit} />
            <StatCard label="Processing" value={data?.stats.processing ?? 0} icon={Loader2} />
          </>
        )}
      </div>

      {isError ? (
        <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm sm:flex-row sm:items-center">
          <span className="text-destructive">
            {error instanceof Error ? error.message : "Couldn't load dashboard data. Try refreshing the page."}
          </span>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Retry
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {isLoading ? (
          <>
            <SectionSkeleton />
            <SectionSkeleton />
            <SectionSkeleton />
          </>
        ) : (
          <>
            <SectionCard
              title="Recent Products"
              viewAllHref="/products"
              isEmpty={data?.recentProducts.length === 0}
            >
              {data?.recentProducts.map((product) => (
                <ProductRow key={product.productId} product={product} />
              ))}
            </SectionCard>

            <SectionCard
              title="Recently Published"
              viewAllHref="/products"
              isEmpty={data?.recentlyPublished.length === 0}
              emptyLabel="Nothing published yet."
            >
              {data?.recentlyPublished.map((product) => (
                <ProductRow key={product.productId} product={product} />
              ))}
            </SectionCard>

            <SectionCard
              title="Processing Queue"
              isEmpty={data?.processingQueue.length === 0}
              emptyLabel="Nothing in progress."
            >
              {data?.processingQueue.map((product) => (
                <ProcessingRow key={product.productId} product={product} />
              ))}
            </SectionCard>
          </>
        )}
      </div>
    </PageShell>
  );
}
