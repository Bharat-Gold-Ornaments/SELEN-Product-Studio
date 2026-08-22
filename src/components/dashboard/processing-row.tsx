"use client";

import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { ProductThumb } from "@/components/product-thumb";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { PRODUCT_TYPES } from "@/lib/constants";
import type { ProductRecord } from "@/types/product";

const CATEGORY_LABEL = Object.fromEntries(
  PRODUCT_TYPES.map((t) => [t.value, t.label])
);

export function ProcessingRow({ product }: { product: ProductRecord }) {
  const isFailed = product.status === "failed";

  return (
    <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <ProductThumb category={product.category} imageUrl={product.closeupImageLink} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          {product.title}
        </span>
        <span className="text-xs text-muted-foreground">
          {CATEGORY_LABEL[product.category]}
          {isFailed ? " · Generation failed" : " · Generating images…"}
        </span>
      </div>
      <StatusBadge status={product.status} />
      {isFailed ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            toast.info("Retry will be wired up once image generation (Milestone 5) is connected.")
          }
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      ) : null}
    </div>
  );
}
