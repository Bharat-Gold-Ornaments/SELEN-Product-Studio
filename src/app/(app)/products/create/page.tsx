"use client";

import { useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DynamicProductForm } from "@/components/create-product/dynamic-product-form";
import { PRODUCT_TYPES } from "@/lib/constants";
import type { ProductType } from "@/types/product";

export default function CreateProductPage() {
  const [productType, setProductType] = useState<ProductType>("earrings");

  return (
    <PageShell
      title="Create Product"
      description="Upload originals and generate a full Shopify-ready listing."
    >
      <Tabs value={productType} onValueChange={(value) => setProductType(value as ProductType)}>
        <TabsList>
          {PRODUCT_TYPES.map((type) => (
            <TabsTrigger key={type.value} value={type.value}>
              {type.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Remounting on type change keeps each product type's form state and
          validation fully isolated — the field sets don't overlap cleanly
          enough to make preserving values across a type switch meaningful. */}
      <DynamicProductForm key={productType} productType={productType} />
    </PageShell>
  );
}
