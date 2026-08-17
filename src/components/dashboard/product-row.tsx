import { ProductThumb } from "@/components/product-thumb";
import { ProductDeleteMenu } from "@/components/product-delete-menu";
import { StatusBadge } from "@/components/status-badge";
import { PRODUCT_TYPES } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import type { ProductRecord } from "@/types/product";

const CATEGORY_LABEL = Object.fromEntries(
  PRODUCT_TYPES.map((t) => [t.value, t.label])
);

export function ProductRow({ product }: { product: ProductRecord }) {
  return (
    <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <ProductThumb category={product.category} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          {product.title}
        </span>
        <span className="text-xs text-muted-foreground">
          {CATEGORY_LABEL[product.category]} · {formatDate(product.createdDate)}
        </span>
      </div>
      <StatusBadge status={product.status} />
      <ProductDeleteMenu product={product} />
    </div>
  );
}
