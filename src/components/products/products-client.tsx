"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { ProductThumb } from "@/components/product-thumb";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRODUCT_STATUSES, PRODUCT_TYPES } from "@/lib/constants";
import { formatDate, formatGrams } from "@/lib/utils";
import { useProductsList } from "@/hooks/use-products-list";
import type { ProductStatus, ProductType } from "@/types/product";

const CATEGORY_LABEL = Object.fromEntries(PRODUCT_TYPES.map((t) => [t.value, t.label])) as Record<
  ProductType,
  string
>;

function TableSkeleton() {
  return (
    <div className="flex flex-col divide-y divide-border">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-11 w-11 rounded-xl" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function ProductsClient() {
  const { data: products, isLoading, isError, error, refetch, isFetching } = useProductsList();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProductStatus | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<ProductType | "all">("all");

  const filtered = useMemo(() => {
    if (!products) return [];
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      if (statusFilter !== "all" && product.status !== statusFilter) return false;
      if (categoryFilter !== "all" && product.category !== categoryFilter) return false;
      if (!query) return true;
      return (
        product.title.toLowerCase().includes(query) ||
        product.productId.toLowerCase().includes(query)
      );
    });
  }, [products, search, statusFilter, categoryFilter]);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title or product ID"
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ProductStatus | "all")}>
          <SelectTrigger className="sm:w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {PRODUCT_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as ProductType | "all")}>
          <SelectTrigger className="sm:w-44">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {PRODUCT_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isError ? (
        <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm sm:flex-row sm:items-center">
          <span className="flex items-center gap-2 text-destructive">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            {error instanceof Error ? error.message : "Couldn't load products."}
          </span>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Retry
          </Button>
        </div>
      ) : null}

      <Card className="flex-1 overflow-hidden p-0">
        {isLoading ? (
          <TableSkeleton />
        ) : filtered.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-16 text-sm text-muted-foreground">
            {products && products.length === 0
              ? "No products yet — create one to see it here."
              : "No products match these filters."}
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {filtered.map((product) => (
              <Link
                key={product.productId}
                href={`/products/${product.productId}/review`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <ProductThumb category={product.category} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">{product.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {product.productId} · {CATEGORY_LABEL[product.category]} ·{" "}
                    {formatGrams(product.weightGrams)} · {formatDate(product.createdDate)}
                  </span>
                </div>
                <StatusBadge status={product.status} />
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
