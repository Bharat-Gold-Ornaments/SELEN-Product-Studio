"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormField } from "@/components/form-field";
import { useInventory } from "@/hooks/use-inventory";
import { useProductsList } from "@/hooks/use-products-list";
import { INVENTORY_CATEGORIES } from "@/lib/constants";
import { formatGrams } from "@/lib/utils";
import { sameSku } from "@/lib/sku";
import type { InventoryCategory, InventoryItem } from "@/types/inventory";
import type { ProductType } from "@/types/product";

const CATEGORY_LABEL = Object.fromEntries(INVENTORY_CATEGORIES.map((c) => [c.value, c.label])) as Record<
  InventoryCategory,
  string
>;

/** The Inventory category a Studio product type corresponds to, used only to list matching SKUs first. */
const MATCHING_CATEGORY: Record<ProductType, InventoryCategory | null> = {
  earrings: "earrings",
  ring: "ring",
  pendant: "pendant",
  necklace: "chain",
  bracelet: null,
};

interface InventorySkuFieldProps {
  productType: ProductType;
  value: string;
  onSelect: (item: InventoryItem) => void;
  error?: string;
}

/**
 * Required first step of Create Product: the Inventory row this listing is
 * for. Only SKUs not already used by another product are offered; the
 * server re-checks both rules (see /api/products/generate).
 */
export function InventorySkuField({ productType, value, onSelect, error }: InventorySkuFieldProps) {
  const inventory = useInventory();
  const products = useProductsList();

  const usedSkus = (products.data ?? []).map((p) => p.sku).filter(Boolean);
  const matching = MATCHING_CATEGORY[productType];
  const available = (inventory.data ?? [])
    .filter((item) => !usedSkus.some((sku) => sameSku(sku, item.sku)))
    .sort((a, b) => {
      // Same-category SKUs first, then by SKU.
      const rank = (item: InventoryItem) => (item.category === matching ? 0 : 1);
      return rank(a) - rank(b) || a.sku.localeCompare(b.sku, undefined, { numeric: true, sensitivity: "base" });
    });

  const selected = available.find((item) => item.sku === value);
  const isLoading = inventory.isLoading || products.isLoading;
  const loadError = inventory.error ?? products.error;

  let hint: string | undefined;
  if (selected && matching && selected.category !== matching) {
    hint = `This SKU is filed under ${CATEGORY_LABEL[selected.category]} in Inventory.`;
  }

  return (
    <FormField label="Inventory SKU" htmlFor="sku" error={error} hint={hint} className="sm:col-span-2">
      {isLoading ? (
        <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading Inventory…
        </div>
      ) : loadError ? (
        <p className="text-sm text-destructive">
          {loadError instanceof Error ? loadError.message : "Couldn't load Inventory."}
        </p>
      ) : available.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Every Inventory SKU already has a product.{" "}
          <Link href="/inventory" className="font-medium text-foreground underline underline-offset-2">
            Add the piece to Inventory
          </Link>{" "}
          first, then come back here.
        </p>
      ) : (
        <Select
          value={value}
          onValueChange={(sku) => {
            const item = available.find((i) => i.sku === sku);
            if (item) onSelect(item);
          }}
        >
          <SelectTrigger id="sku">
            <SelectValue placeholder="Select the Inventory SKU this product is for" />
          </SelectTrigger>
          <SelectContent>
            {available.map((item) => (
              <SelectItem key={item.sku} value={item.sku}>
                {item.sku} · {CATEGORY_LABEL[item.category] ?? item.category} · {formatGrams(item.weightGrams)} · qty{" "}
                {item.quantity}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FormField>
  );
}
